import { describe, expect, it } from 'vitest';
import type { Observation, PolicyCheckpoint } from '../contracts/index.ts';
import { checkpointHash, normalizedFeatures, predict, validateCheckpoint, wilson } from './index.ts';

const observation: Observation = { version: 'state-v1', sourceStep: 0, deliveryStep: 0, sampleTime: 0, deliveryTime: 0,
  position: [0, 0, 0], velocity: [1, 2, 3], quaternion: [0, 0, 0, 1], angularVelocity: [4, 5, 6], relativeTarget: [7, 8, 9], range: [10, 11, 12, 13, 14, 15], battery: 0.5,
  priorAction: { kind: 'nav', velocity: [0, 0, 0], yawRate: 0 }, elapsed: 0 };
const zeros = (shape: number[]) => ({ shape, data: Array.from({ length: shape.reduce((a, b) => a * b, 1) }, () => 0) });
const checkpoint: PolicyCheckpoint = { version: 'bc-v1', id: 'test', createdAt: '', trainingSeed: 1, trainingSeeds: [1], validationSeeds: [20000], testSeeds: [30001], scenario: 'hover',
  config: { scenario: 'hover', seed: 1, wind: [0,0,0], noise: 0, delaySteps: 0, maxSeconds: 1, dt: 1/120 }, mean: Array(20).fill(0), std: Array(20).fill(1),
  layers: [zeros([20,32]), zeros([32]), zeros([32,32]), zeros([32]), zeros([32,4]), { shape: [4], data: [0.1, -0.2, 0.3, -0.4] }], loss: [], validationLoss: [], samples: 1, epochs: 1, parityMaxError: 0, hash: '' };
checkpoint.hash = checkpointHash(checkpoint);

describe('learning runtime', () => {
  it('uses contract ordering, std floor, and clipped normalization', () => expect(normalizedFeatures(observation, Array(20).fill(0), Array(20).fill(0))).toEqual([5,5,5,5,5,5,0,0,0,5,5,5,5,5,5,5,5,5,5,5]));
  it('runs flattened tanh weights without TensorFlow', () => {
    const action = predict(checkpoint, observation);
    expect(action.kind).toBe('nav');
    if (action.kind === 'nav') expect(action.velocity).toEqual([Math.tanh(.1) * 3, Math.tanh(-.2) * 3, Math.tanh(.3) * 3]);
  });
  it('returns a bounded Wilson interval', () => { const interval = wilson(7, 10); expect(interval.low).toBeLessThan(.7); expect(interval.high).toBeGreaterThan(.7); });
  it('rejects tampered or malformed checkpoints before inference', () => {
    expect(() => validateCheckpoint({ ...checkpoint, hash: 'tampered' })).toThrow('hash mismatch');
    expect(() => validateCheckpoint({ ...checkpoint, layers: [...checkpoint.layers.slice(0, 5), { shape: [4], data: [0] }] })).toThrow('weight shape');
  });
});
