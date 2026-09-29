import * as tf from '@tensorflow/tfjs';
import { actionVector, type PolicyCheckpoint, type SimConfig, type Transition } from '../../../packages/contracts/index.ts';
import { checkpointHash, normalizedFeatures, predict } from '../../../packages/learning/index.ts';

type TrainData = { episodes: { seed: number; transitions: Transition[] }[]; config: SimConfig; trainingSeed: number; epochs: number };
type Incoming = { type: 'train'; jobId: number; data: TrainData } | { type: 'cancel'; jobId: number };
const cancelled = new Set<number>();

self.onmessage = ({ data }: MessageEvent<Incoming>) => {
  if (data.type === 'cancel') { cancelled.add(data.jobId); return; }
  void train(data.jobId, data.data).catch(error => postMessage({ type: 'error', jobId: data.jobId, error: error instanceof Error ? error.message : String(error) }));
};

function postMessage(message: unknown): void { (self as DedicatedWorkerGlobalScope).postMessage(message); }
function seeded(seed: number): () => number { let state = seed >>> 0 || 1; return () => ((state = Math.imul(1664525, state) + 1013904223 >>> 0) / 0x100000000); }
function split(data: TrainData) {
  const train = data.episodes.filter(e => e.seed < 20000);
  const validation = data.episodes.filter(e => e.seed >= 20000 && e.seed < 30000);
  if (!train.length || !validation.length) throw new Error('Training needs whole train episodes (seed < 20000) and validation episodes (20000–29999)');
  return { train, validation };
}
function flatten(episodes: { transitions: Transition[] }[]) { return episodes.flatMap(e => e.transitions.filter(t => t.requestedAction.kind === 'nav')); }
function normalization(transitions: Transition[]) {
  const n = transitions.length;
  if (!n) throw new Error('No navigation demonstrations');
  const raw = transitions.map(t => [...t.observation.relativeTarget, ...t.observation.velocity, ...t.observation.quaternion, ...t.observation.angularVelocity, ...t.observation.range.slice(0, 6), t.observation.battery]);
  const mean = raw[0].map((_, i) => raw.reduce((sum, row) => sum + row[i], 0) / n);
  const std = raw[0].map((_, i) => Math.sqrt(raw.reduce((sum, row) => sum + (row[i] - mean[i]) ** 2, 0) / n) || 1);
  return { mean, std, raw };
}
function tensors(transitions: Transition[], mean: number[], std: number[]) {
  return {
    x: tf.tensor2d(transitions.map(t => normalizedFeatures(t.observation, mean, std)), [transitions.length, 20]),
    y: tf.tensor2d(transitions.map(t => actionVector(t.requestedAction)), [transitions.length, 4]),
  };
}
async function train(jobId: number, data: TrainData): Promise<void> {
  await tf.setBackend('cpu'); await tf.ready();
  if (tf.getBackend() !== 'cpu') throw new Error(`CPU backend unavailable: ${tf.getBackend()}`);
  const { train: trainEpisodes, validation: validationEpisodes } = split(data);
  const trainTransitions = flatten(trainEpisodes), validationTransitions = flatten(validationEpisodes);
  if (!validationTransitions.length) throw new Error('Validation episodes contain no navigation transitions');
  const { mean, std } = normalization(trainTransitions);
  const trainSet = tensors(trainTransitions, mean, std), validationSet = tensors(validationTransitions, mean, std);
  const random = seeded(data.trainingSeed);
  const initializer = tf.initializers.glorotUniform({ seed: Math.floor(random() * 0x7fffffff) });
  const model = tf.sequential();
  model.add(tf.layers.dense({ inputShape: [20], units: 32, activation: 'tanh', kernelInitializer: initializer, biasInitializer: 'zeros' }));
  model.add(tf.layers.dense({ units: 32, activation: 'tanh', kernelInitializer: tf.initializers.glorotUniform({ seed: Math.floor(random() * 0x7fffffff) }), biasInitializer: 'zeros' }));
  model.add(tf.layers.dense({ units: 4, activation: 'tanh', kernelInitializer: tf.initializers.glorotUniform({ seed: Math.floor(random() * 0x7fffffff) }), biasInitializer: 'zeros' }));
  const optimizer = tf.train.adam(0.001);
  let best = Infinity, bestWeights: tf.Tensor[] | undefined;
  const losses: number[] = [], validationLosses: number[] = [];
  try {
    for (let epoch = 1; epoch <= Math.min(Math.max(1, data.epochs), 24); epoch++) {
      if (cancelled.delete(jobId)) { postMessage({ type: 'cancelled', jobId }); return; }
      const loss = tf.tidy(() => optimizer.minimize(() => tf.losses.meanSquaredError(trainSet.y, model.apply(trainSet.x, { training: true }) as tf.Tensor) as tf.Scalar, true)!.dataSync()[0]);
      const validationLoss = tf.tidy(() => tf.losses.meanSquaredError(validationSet.y, model.predict(validationSet.x) as tf.Tensor).mean().dataSync()[0]);
      losses.push(loss); validationLosses.push(validationLoss);
      if (validationLoss < best) { best = validationLoss; bestWeights?.forEach(w => w.dispose()); bestWeights = model.getWeights().map(w => w.clone()); }
      postMessage({ type: 'progress', jobId, epoch, loss, validationLoss });
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    if (cancelled.delete(jobId)) { postMessage({ type: 'cancelled', jobId }); return; }
    if (!bestWeights) throw new Error('No trainable weights');
    model.setWeights(bestWeights);
    const layers = model.getWeights().map(weight => ({ shape: weight.shape.slice(), data: Array.from(weight.dataSync()) }));
    const base = { version: 'bc-v1' as const, id: `bc-${data.trainingSeed}-${Date.now()}`, createdAt: new Date().toISOString(), trainingSeed: data.trainingSeed,
      trainingSeeds: trainEpisodes.map(e => e.seed), validationSeeds: validationEpisodes.map(e => e.seed), testSeeds: [30001,30002,30003,30004,30005,30006,30007,30008], scenario: data.config.scenario, config: data.config,
      mean, std, layers, loss: losses, validationLoss: validationLosses, samples: trainTransitions.length, epochs: losses.length, parityMaxError: 0, hash: '' };
    const probe = trainTransitions[0].observation;
    const expected = tf.tidy(() => Array.from((model.predict(tf.tensor2d([normalizedFeatures(probe, mean, std)], [1, 20])) as tf.Tensor).dataSync()));
    const actual = actionVector(predict(base, probe));
    const parityMaxError = Math.max(...expected.map((value, i) => Math.abs(value - actual[i])));
    if (parityMaxError >= 1e-5) throw new Error(`Pure predictor parity failed: ${parityMaxError}`);
    const checkpoint: PolicyCheckpoint = { ...base, parityMaxError, hash: checkpointHash(base) };
    postMessage({ type: 'complete', jobId, checkpoint });
  } finally {
    bestWeights?.forEach(w => w.dispose()); optimizer.dispose(); model.dispose(); trainSet.x.dispose(); trainSet.y.dispose(); validationSet.x.dispose(); validationSet.y.dispose();
  }
}
