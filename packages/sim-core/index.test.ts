import { beforeAll, describe, expect, it } from 'vitest';
import { DT, features, type SimConfig } from '../contracts/index.ts';
import { DroneEnvironment, enuToThreePosition, enuToThreeQuaternion, initPhysics } from './index.ts';

const config = (more: Partial<SimConfig> = {}): SimConfig => ({ scenario: 'hover', seed: 11, wind: [0, 0, 0], noise: 0, delaySteps: 0, maxSeconds: 12, dt: DT, ...more });

beforeAll(async () => { await initPhysics(); });

describe('DroneEnvironment', () => {
  it('falls under gravity with zero manual thrust', () => {
    const env = new DroneEnvironment(config()); env.reset(); const start = env.state().position[2];
    for (let i = 0; i < 10; i++) env.step({ kind: 'rate', rates: [0, 0, 0], thrust: 0 }, 1);
    expect(env.state().position[2]).toBeLessThan(start - .015); env.dispose();
  });

  it('reaches the easy hover target with observation-driven scripted control', () => {
    const env = new DroneEnvironment(config({ maxSeconds: 18 })); env.reset();
    let result = env.step(env.scriptedAction(), 4);
    for (let i = 0; i < 520 && !result.state.terminated && !result.state.truncated; i++) result = env.step(env.scriptedAction(result.observation), 4);
    expect(result.state.reason).toBe('success'); env.dispose();
  });

  it('completes the seeded gate course with the same local controller', () => {
    const env = new DroneEnvironment(config({ scenario: 'gates', maxSeconds: 30, seed: 6 })); env.reset();
    let result = env.step(env.scriptedAction(), 4);
    for (let i = 0; i < 900 && !result.state.terminated && !result.state.truncated; i++) result = env.step(env.scriptedAction(result.observation), 4);
    expect(result.state.reason).toBe('success'); env.dispose();
  });

  it('keeps mixer signs and manual yaw bounded', () => {
    const env = new DroneEnvironment(config()); env.reset();
    env.step({ kind: 'rate', rates: [0, 0, 1], thrust: .45 }, 1);
    const motors = env.state().motors;
    expect(motors[0]).toBeGreaterThan(motors[1]!); expect(motors[2]).toBeGreaterThan(motors[3]!);
    expect(motors.every(m => m >= 0 && m <= 1)).toBe(true); env.dispose();
  });

  it('uses the explicit ENU to Three basis conversion', () => {
    expect(enuToThreePosition([2, 3, 4])).toEqual([2, 4, -3]);
    expect(enuToThreeQuaternion([.1, .2, .3, .9])).toEqual([.1, .3, -.2, .9]);
  });

  it('has deterministic seeded observations and exactly 20 features', () => {
    const a = new DroneEnvironment(config({ noise: .2, delaySteps: 2, seed: 44 })); const b = new DroneEnvironment(config({ noise: .2, delaySteps: 2, seed: 44 }));
    expect(a.reset()).toEqual(b.reset()); expect(features(a.observe())).toHaveLength(20); a.dispose(); b.dispose();
  });

  it('returns the initial available noisy sample repeatedly instead of resampling it', () => {
    const env = new DroneEnvironment(config({ noise: .2, delaySteps: 4 })); const reset = env.reset();
    expect(reset.deliveryStep).toBe(0); expect(env.observe()).toEqual(reset); expect(env.observe()).toEqual(reset); env.dispose();
  });

  it('restores Rapier, controller and delayed sensor state exactly', () => {
    const a = new DroneEnvironment(config({ noise: .1, delaySteps: 3 })); a.reset();
    for (let i = 0; i < 8; i++) a.step(a.scriptedAction(), 2);
    const snap = a.snapshot(); const expected = a.step(a.scriptedAction(), 4);
    const b = new DroneEnvironment(config({ noise: .1, delaySteps: 3 })); b.restore(snap); const actual = b.step(b.scriptedAction(), 4);
    expect(actual.state).toEqual(expected.state); expect(actual.observation).toEqual(expected.observation); a.dispose(); b.dispose();
  });

  it('reports tick-summed reward and stops an action repeat at terminal', () => {
    const env = new DroneEnvironment(config({ maxSeconds: DT * 2 })); env.reset(); const r = env.step({ kind: 'rate', rates: [0, 0, 0], thrust: 0 }, 99);
    expect(r.transition.ticks).toBe(2); expect(r.transition.truncated).toBe(true);
    expect(r.transition.reward).toBeCloseTo(r.transition.components.total); const after = env.state().step; env.step({ kind: 'rate', rates: [0, 0, 0], thrust: 1 }); expect(env.state().step).toBe(after); env.dispose();
  });

  it('uses four physical gate-frame bars and terminates once on a bar collision', () => {
    const env = new DroneEnvironment(config({ scenario: 'gates' })); expect(env.scenario.obstacles).toHaveLength(12);
    const drone = (env as any).drone; drone.setTranslation({ x: 1.35, y: 5, z: 2 }, true); drone.setLinvel({ x: 0, y: 0, z: 0 }, true);
    const hit = env.step({ kind: 'rate', rates: [0, 0, 0], thrust: .42 }, 2);
    expect(hit.state.reason).toBe('collision'); expect(hit.state.collisions).toBe(1); env.dispose();
  });

  it('requires physical pad contact for a gentle landing success', () => {
    const env = new DroneEnvironment(config({ scenario: 'landing', maxSeconds: 3 })); const drone = (env as any).drone;
    drone.setTranslation({ x: 0, y: 0, z: .11 }, true); drone.setLinvel({ x: 0, y: 0, z: 0 }, true);
    let result = env.step({ kind: 'rate', rates: [0, 0, 0], thrust: .423 }, 1);
    for (let i = 0; i < 40 && !result.state.terminated; i++) result = env.step({ kind: 'rate', rates: [0, 0, 0], thrust: .423 }, 1);
    expect(result.state.reason).toBe('success'); env.dispose();
  });

  it('terminates when leaving the arena and velocity control has no hidden target pull', () => {
    const env = new DroneEnvironment(config()); const drone = (env as any).drone; drone.setTranslation({ x: 26, y: 0, z: 2 }, true);
    expect(env.step({ kind: 'rate', rates: [0, 0, 0], thrust: .4 }, 1).state.reason).toBe('out_of_bounds'); env.dispose();
    const a = new DroneEnvironment(config()), b = new DroneEnvironment(config()); b.scenario.targets = [[99, -99, 99]];
    a.step({ kind: 'nav', velocity: [0, 0, 0], yawRate: 0 }, 1); b.step({ kind: 'nav', velocity: [0, 0, 0], yawRate: 0 }, 1);
    expect(a.state().motors).toEqual(b.state().motors); a.dispose(); b.dispose();
  });

  it('rejects malformed actions, preserves requested commands, and rejects mismatched snapshots', () => {
    const env = new DroneEnvironment(config()); expect(() => env.step({ kind: 'nav', velocity: [NaN, 0, 0], yawRate: 0 } as any)).toThrow();
    const r = env.step({ kind: 'nav', velocity: [9, 0, 0], yawRate: 9 }, 1); expect(r.transition.requestedAction).toEqual({ kind: 'nav', velocity: [9, 0, 0], yawRate: 9 }); expect(r.transition.appliedAction).toEqual({ kind: 'nav', velocity: [3, 0, 0], yawRate: 1.5 });
    const snap = env.snapshot(); const incompatible = new DroneEnvironment(config({ seed: 12 })); expect(() => incompatible.restore(snap)).toThrow('configuration'); env.stop(); expect(env.state().truncated).toBe(true); env.dispose(); incompatible.dispose();
  });

  it('measures scripted baseline completion', () => {
    for (const scenario of ['hover', 'gates'] as const) {
      const env = new DroneEnvironment(config({ scenario, seed: scenario === 'hover' ? 11 : 6, maxSeconds: 30 })); let result = env.step(env.scriptedAction(), 4);
      for (let i = 0; i < 900 && !result.state.terminated && !result.state.truncated; i++) result = env.step(env.scriptedAction(result.observation), 4);
      expect(result.state.reason).toBe('success'); expect(result.state.collisions).toBe(0); env.dispose();
    }
  });
});
