import * as tf from '@tensorflow/tfjs';
import { actionVector, type PolicyCheckpoint, type SimConfig, type Transition } from '../../../packages/contracts/index.ts';
import { checkpointHash, normalizedFeatures, predict, validateCheckpoint } from '../../../packages/learning/index.ts';

type TrainData = { episodes: { seed: number; transitions: Transition[] }[]; config: SimConfig; trainingSeed: number; epochs: number };
type Incoming = { type: 'train'; jobId: number; data: TrainData } | { type: 'cancel'; jobId: number };
const cancelled = new Set<number>();
let activeJob: number | undefined;

self.onmessage = ({ data }: MessageEvent<Incoming>) => {
  if (data.type === 'cancel') { cancelled.add(data.jobId); return; }
  if (activeJob !== undefined) { postMessage({ type: 'error', jobId: data.jobId, error: 'Another training job is already running' }); return; }
  activeJob = data.jobId;
  void train(data.jobId, data.data)
    .catch(error => postMessage({ type: 'error', jobId: data.jobId, error: error instanceof Error ? error.message : String(error) }))
    .finally(() => { if (activeJob === data.jobId) activeJob = undefined; });
};

function postMessage(message: unknown): void { (self as DedicatedWorkerGlobalScope).postMessage(message); }
function seeded(seed: number): () => number { let state = seed >>> 0 || 1; return () => ((state = Math.imul(1664525, state) + 1013904223 >>> 0) / 0x100000000); }
function split(data: TrainData) {
  const seeds = new Set<number>();
  for (const episode of data.episodes) {
    if (seeds.has(episode.seed)) throw new Error(`Duplicate episode seed: ${episode.seed}`);
    seeds.add(episode.seed);
    const final = episode.transitions.at(-1);
    if (!final || (!final.terminated && !final.truncated) || /user_stop|cancelled/i.test(final.reason)) throw new Error(`Episode ${episode.seed} is incomplete or stopped`);
  }
  const train = data.episodes.filter(e => e.seed < 20000);
  const validation = data.episodes.filter(e => e.seed >= 20000 && e.seed < 30000);
  if (!train.length || !validation.length) throw new Error('Training needs whole train episodes (seed < 20000) and validation episodes (20000–29999)');
  return { train, validation };
}
function flatten(episodes: { transitions: Transition[] }[]) { return episodes.flatMap(e => e.transitions.filter(t => t.appliedAction.kind === 'nav')); }
function normalization(transitions: Transition[]) {
  const n = transitions.length;
  if (!n) throw new Error('No navigation demonstrations');
  const raw = transitions.map(t => [...t.observation.relativeTarget, ...t.observation.velocity, ...t.observation.quaternion, ...t.observation.angularVelocity, ...t.observation.range.slice(0, 6), t.observation.battery]);
  const mean = raw[0].map((_, i) => raw.reduce((sum, row) => sum + row[i], 0) / n);
  const std = raw[0].map((_, i) => Math.max(1e-3, Math.sqrt(raw.reduce((sum, row) => sum + (row[i] - mean[i]) ** 2, 0) / n)));
  return { mean, std, raw };
}
function tensors(transitions: Transition[], mean: number[], std: number[]) {
  return {
    x: tf.tensor2d(transitions.map(t => normalizedFeatures(t.observation, mean, std)), [transitions.length, 20]),
    y: tf.tensor2d(transitions.map(t => actionVector(t.appliedAction)), [transitions.length, 4]),
  };
}
function shuffledIndices(length: number, random: () => number): number[] {
  const indices = Array.from({ length }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [indices[i], indices[j]] = [indices[j], indices[i]]; }
  return indices;
}
async function train(jobId: number, data: TrainData): Promise<void> {
  await tf.setBackend('cpu'); await tf.ready();
  if (tf.getBackend() !== 'cpu') throw new Error(`CPU backend unavailable: ${tf.getBackend()}`);
  const { train: trainEpisodes, validation: validationEpisodes } = split(data);
  const random = seeded(data.trainingSeed);
  const trainTransitions = flatten(trainEpisodes), validationTransitions = flatten(validationEpisodes);
  if (!trainTransitions.length) throw new Error('Training episodes contain no applied navigation transitions');
  if (!validationTransitions.length) throw new Error('Validation episodes contain no navigation transitions');
  const cappedTrain = shuffledIndices(trainTransitions.length, random).slice(0, 20000).map(index => trainTransitions[index]);
  const cappedValidation = shuffledIndices(validationTransitions.length, random).slice(0, 20000).map(index => validationTransitions[index]);
  const { mean, std } = normalization(cappedTrain);
  const trainSet = tensors(cappedTrain, mean, std), validationSet = tensors(cappedValidation, mean, std);
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
      let totalLoss = 0;
      const indices = shuffledIndices(cappedTrain.length, random);
      for (let start = 0; start < indices.length; start += 128) {
        if (cancelled.delete(jobId)) { postMessage({ type: 'cancelled', jobId }); return; }
        const batch = indices.slice(start, start + 128);
        const loss = tf.tidy(() => {
          const batchIndices = tf.tensor1d(batch, 'int32');
          const x = tf.gather(trainSet.x, batchIndices), y = tf.gather(trainSet.y, batchIndices);
          const value = optimizer.minimize(() => tf.losses.meanSquaredError(y, model.apply(x, { training: true }) as tf.Tensor) as tf.Scalar, true)!;
          return value.dataSync()[0];
        });
        totalLoss += loss * batch.length;
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      const loss = totalLoss / cappedTrain.length;
      const validationLoss = tf.tidy(() => tf.losses.meanSquaredError(validationSet.y, model.predict(validationSet.x) as tf.Tensor).mean().dataSync()[0]);
      losses.push(loss); validationLosses.push(validationLoss);
      if (validationLoss < best) { best = validationLoss; bestWeights?.forEach(w => w.dispose()); bestWeights = model.getWeights().map(w => w.clone()); }
      postMessage({ type: 'progress', jobId, epoch, loss, validationLoss });
    }
    if (cancelled.delete(jobId)) { postMessage({ type: 'cancelled', jobId }); return; }
    if (!bestWeights) throw new Error('No trainable weights');
    model.setWeights(bestWeights);
    const layers = model.getWeights().map(weight => ({ shape: weight.shape.slice(), data: Array.from(weight.dataSync()) }));
    const base = { version: 'bc-v1' as const, id: `bc-${data.trainingSeed}-${Date.now()}`, createdAt: new Date().toISOString(), trainingSeed: data.trainingSeed,
      trainingSeeds: trainEpisodes.map(e => e.seed), validationSeeds: validationEpisodes.map(e => e.seed), testSeeds: [30001,30002,30003,30004,30005,30006,30007,30008], scenario: data.config.scenario, config: data.config,
      mean, std, layers, loss: losses, validationLoss: validationLosses, samples: cappedTrain.length, epochs: losses.length, parityMaxError: 0 };
    const probes = cappedValidation.slice(0, Math.min(32, cappedValidation.length)).map(transition => transition.observation);
    const expected = tf.tidy(() => Array.from((model.predict(tf.tensor2d(probes.map(probe => normalizedFeatures(probe, mean, std)), [probes.length, 20])) as tf.Tensor).dataSync()));
    const actual = probes.flatMap(probe => actionVector(predict({ ...base, hash: '' }, probe)));
    const parityMaxError = Math.max(...expected.map((value, i) => Math.abs(value - actual[i])));
    if (parityMaxError >= 1e-5) throw new Error(`Pure predictor parity failed: ${parityMaxError}`);
    const complete = { ...base, parityMaxError };
    const checkpoint: PolicyCheckpoint = { ...complete, hash: checkpointHash(complete) };
    validateCheckpoint(checkpoint);
    postMessage({ type: 'complete', jobId, checkpoint });
  } finally {
    bestWeights?.forEach(w => w.dispose()); optimizer.dispose(); model.dispose(); trainSet.x.dispose(); trainSet.y.dispose(); validationSet.x.dispose(); validationSet.y.dispose();
  }
}
