import { beforeAll, describe, expect, it } from "vitest";
import { DT, features, type SimConfig } from "../contracts/index.ts";
import { FREE_WORLD } from "../contracts/free-world.ts";
import {
  DroneEnvironment,
  createFreeScenario,
  enuToThreePosition,
  enuToThreeQuaternion,
  initPhysics,
} from "./index.ts";

const config = (more: Partial<SimConfig> = {}): SimConfig => ({
  scenario: "hover",
  seed: 11,
  wind: [0, 0, 0],
  noise: 0,
  delaySteps: 0,
  maxSeconds: 12,
  dt: DT,
  ...more,
});

beforeAll(async () => {
  await initPhysics();
});

describe("DroneEnvironment", () => {
  it("falls under gravity with zero manual thrust", () => {
    const env = new DroneEnvironment(config());
    env.reset();
    const start = env.state().position[2];
    for (let i = 0; i < 10; i++)
      env.step({ kind: "rate", rates: [0, 0, 0], thrust: 0 }, 1);
    expect(env.state().position[2]).toBeLessThan(start - 0.015);
    env.dispose();
  });

  it("reaches the easy hover target with observation-driven scripted control", () => {
    const env = new DroneEnvironment(config({ maxSeconds: 18 }));
    env.reset();
    let result = env.step(env.scriptedAction(), 4);
    for (
      let i = 0;
      i < 520 && !result.state.terminated && !result.state.truncated;
      i++
    )
      result = env.step(env.scriptedAction(result.observation), 4);
    expect(result.state.reason).toBe("success");
    env.dispose();
  });

  it("completes the seeded gate course with the same local controller", () => {
    const env = new DroneEnvironment(
      config({ scenario: "gates", maxSeconds: 30, seed: 6 }),
    );
    env.reset();
    let result = env.step(env.scriptedAction(), 4);
    for (
      let i = 0;
      i < 900 && !result.state.terminated && !result.state.truncated;
      i++
    )
      result = env.step(env.scriptedAction(result.observation), 4);
    expect(result.state.reason).toBe("success");
    expect(result.state.targetIndex).toBe(2);
    env.dispose();
  });

  it("keeps mixer signs and manual yaw bounded", () => {
    const env = new DroneEnvironment(config());
    env.reset();
    env.step({ kind: "rate", rates: [0, 0, 1], thrust: 0.45 }, 1);
    const motors = env.state().motors;
    expect(motors[0]).toBeGreaterThan(motors[1]!);
    expect(motors[2]).toBeGreaterThan(motors[3]!);
    expect(motors.every((m) => m >= 0 && m <= 1)).toBe(true);
    env.dispose();
  });

  it("uses the explicit ENU to Three basis conversion", () => {
    expect(enuToThreePosition([2, 3, 4])).toEqual([2, 4, -3]);
    expect(enuToThreeQuaternion([0.1, 0.2, 0.3, 0.9])).toEqual([
      0.1, 0.3, -0.2, 0.9,
    ]);
  });

  it("has deterministic seeded observations and exactly 20 features", () => {
    const a = new DroneEnvironment(
      config({ noise: 0.2, delaySteps: 2, seed: 44 }),
    );
    const b = new DroneEnvironment(
      config({ noise: 0.2, delaySteps: 2, seed: 44 }),
    );
    expect(a.reset()).toEqual(b.reset());
    expect(features(a.observe())).toHaveLength(20);
    a.dispose();
    b.dispose();
  });

  it("returns the initial available noisy sample repeatedly instead of resampling it", () => {
    const env = new DroneEnvironment(config({ noise: 0.2, delaySteps: 4 }));
    const reset = env.reset();
    expect(reset.deliveryStep).toBe(0);
    expect(env.observe()).toEqual(reset);
    expect(env.observe()).toEqual(reset);
    env.dispose();
  });

  it("restores Rapier, controller and delayed sensor state exactly", () => {
    const a = new DroneEnvironment(config({ noise: 0.1, delaySteps: 3 }));
    a.reset();
    for (let i = 0; i < 8; i++) a.step(a.scriptedAction(), 2);
    const snap = a.snapshot();
    const expected = a.step(a.scriptedAction(), 4);
    const b = new DroneEnvironment(config({ noise: 0.1, delaySteps: 3 }));
    b.restore(snap);
    const actual = b.step(b.scriptedAction(), 4);
    expect(actual.state).toEqual(expected.state);
    expect(actual.observation).toEqual(expected.observation);
    a.dispose();
    b.dispose();
  });

  it("reports tick-summed reward and stops an action repeat at terminal", () => {
    const env = new DroneEnvironment(config({ maxSeconds: DT * 2 }));
    env.reset();
    const r = env.step({ kind: "rate", rates: [0, 0, 0], thrust: 0 }, 99);
    expect(r.transition.ticks).toBe(2);
    expect(r.transition.truncated).toBe(true);
    expect(r.transition.reward).toBeCloseTo(r.transition.components.total);
    const after = env.state().step;
    env.step({ kind: "rate", rates: [0, 0, 0], thrust: 1 });
    expect(env.state().step).toBe(after);
    env.dispose();
  });

  it("uses four physical gate-frame bars and terminates once on a bar collision", () => {
    const env = new DroneEnvironment(config({ scenario: "gates" }));
    expect(env.scenario.obstacles).toHaveLength(12);
    const drone = (env as any).drone;
    drone.setTranslation({ x: 1.35, y: 5, z: 2 }, true);
    drone.setLinvel({ x: 0, y: 0, z: 0 }, true);
    const hit = env.step({ kind: "rate", rates: [0, 0, 0], thrust: 0.42 }, 2);
    expect(hit.state.reason).toBe("collision");
    expect(hit.state.collisions).toBe(1);
    env.dispose();
  });

  it("requires ordered in-opening gate-plane crossings, never gate proximity", () => {
    const env = new DroneEnvironment(config({ scenario: "gates" }));
    const drone = (env as any).drone;
    drone.setTranslation({ x: 0, y: 4.7, z: 2 }, true);
    env.step({ kind: "rate", rates: [0, 0, 0], thrust: 0.42 }, 1);
    expect(env.state().targetIndex).toBe(0);
    expect(env.state().terminated).toBe(false);
    for (const y of [5.1, 9.1, 13.1]) {
      drone.setTranslation({ x: 0, y, z: 2 }, true);
      drone.setLinvel({ x: 0, y: 0, z: 0 }, true);
      env.step({ kind: "rate", rates: [0, 0, 0], thrust: 0.42 }, 1);
    }
    expect(env.state().reason).toBe("success");
    expect(env.state().targetIndex).toBe(2);
    env.dispose();
  });

  it("requires physical pad contact for a gentle landing success", () => {
    const env = new DroneEnvironment(
      config({ scenario: "landing", maxSeconds: 3 }),
    );
    const drone = (env as any).drone;
    drone.setTranslation({ x: 0, y: 0, z: 0.11 }, true);
    drone.setLinvel({ x: 0, y: 0, z: 0 }, true);
    let result = env.step({ kind: "rate", rates: [0, 0, 0], thrust: 0.423 }, 1);
    for (let i = 0; i < 40 && !result.state.terminated; i++)
      result = env.step({ kind: "rate", rates: [0, 0, 0], thrust: 0.423 }, 1);
    expect(result.state.reason).toBe("success");
    env.dispose();
  });

  it("fails a hard landing immediately using pre-impact speed", () => {
    const env = new DroneEnvironment(
      config({ scenario: "landing", maxSeconds: 3 }),
    );
    const drone = (env as any).drone;
    drone.setTranslation({ x: 0, y: 0, z: 0.5 }, true);
    drone.setLinvel({ x: 0, y: 0, z: -5 }, true);
    let result = env.step({ kind: "rate", rates: [0, 0, 0], thrust: 0 }, 1);
    for (let i = 0; i < 30 && !result.state.terminated; i++)
      result = env.step({ kind: "rate", rates: [0, 0, 0], thrust: 0 }, 1);
    expect(result.state.reason).toBe("collision");
    expect(result.state.terminated).toBe(true);
    env.dispose();
  });

  it("mixes manual body roll in body axes after a 90-degree yaw", () => {
    const env = new DroneEnvironment(config());
    const drone = (env as any).drone;
    const s = Math.SQRT1_2;
    drone.setRotation({ x: 0, y: 0, z: s, w: s }, true);
    (env as any).yaw = Math.PI / 2;
    for (let i = 0; i < 12; i++)
      env.step({ kind: "rate", rates: [1, 0, 0], thrust: 0.42 }, 1);
    const w = env.state().angularVelocity;
    expect(Math.abs(w[1])).toBeGreaterThan(Math.abs(w[0]) * 3);
    expect(w[1]).toBeGreaterThan(0);
    env.dispose();
  });

  it("keeps navigation velocity commands in the ENU world frame after yaw", () => {
    const env = new DroneEnvironment(config());
    const drone = (env as any).drone;
    const s = Math.SQRT1_2;
    drone.setRotation({ x: 0, y: 0, z: s, w: s }, true);
    (env as any).yaw = Math.PI / 2;
    for (let i = 0; i < 100; i++)
      env.step({ kind: "nav", velocity: [1.5, 0, 0], yawRate: 0 }, 1);
    const velocity = env.state().velocity;
    expect(velocity[0]).toBeGreaterThan(0.05);
    expect(Math.abs(velocity[0])).toBeGreaterThan(Math.abs(velocity[1]) * 3);
    env.dispose();
  });

  it("terminates when leaving the arena and velocity control has no hidden target pull", () => {
    const env = new DroneEnvironment(config());
    const drone = (env as any).drone;
    drone.setTranslation({ x: 26, y: 0, z: 2 }, true);
    expect(
      env.step({ kind: "rate", rates: [0, 0, 0], thrust: 0.4 }, 1).state.reason,
    ).toBe("out_of_bounds");
    env.dispose();
    const a = new DroneEnvironment(config()),
      b = new DroneEnvironment(config());
    b.scenario.targets = [[99, -99, 99]];
    a.step({ kind: "nav", velocity: [0, 0, 0], yawRate: 0 }, 1);
    b.step({ kind: "nav", velocity: [0, 0, 0], yawRate: 0 }, 1);
    expect(a.state().motors).toEqual(b.state().motors);
    a.dispose();
    b.dispose();
  });

  it("rejects malformed actions, preserves requested commands, and rejects mismatched snapshots", () => {
    const env = new DroneEnvironment(config());
    expect(() =>
      env.step({ kind: "nav", velocity: [NaN, 0, 0], yawRate: 0 } as any),
    ).toThrow();
    const r = env.step({ kind: "nav", velocity: [9, 0, 0], yawRate: 9 }, 1);
    expect(r.transition.requestedAction).toEqual({
      kind: "nav",
      velocity: [9, 0, 0],
      yawRate: 9,
    });
    expect(r.transition.appliedAction).toEqual({
      kind: "nav",
      velocity: [3, 0, 0],
      yawRate: 1.5,
    });
    const snap = env.snapshot();
    const incompatible = new DroneEnvironment(config({ seed: 12 }));
    expect(() => incompatible.restore(snap)).toThrow("configuration");
    env.stop();
    expect(env.state().truncated).toBe(true);
    env.dispose();
    incompatible.dispose();
  });

  it("measures scripted baseline completion", () => {
    for (const scenario of ["hover", "gates"] as const) {
      const env = new DroneEnvironment(
        config({
          scenario,
          seed: scenario === "hover" ? 11 : 6,
          maxSeconds: 30,
        }),
      );
      let result = env.step(env.scriptedAction(), 4);
      for (
        let i = 0;
        i < 900 && !result.state.terminated && !result.state.truncated;
        i++
      )
        result = env.step(env.scriptedAction(result.observation), 4);
      expect(result.state.reason).toBe("success");
      expect(result.state.collisions).toBe(0);
      env.dispose();
    }
  });

  it("measures all scripted missions across 16 seeded resets", () => {
    for (const scenario of ["hover", "gates", "landing"] as const)
      for (let seed = 0; seed < 16; seed++) {
        const env = new DroneEnvironment(
          config({ scenario, seed, maxSeconds: 35 }),
        );
        let result = env.step(env.scriptedAction(), 4);
        for (
          let i = 0;
          i < 1100 && !result.state.terminated && !result.state.truncated;
          i++
        )
          result = env.step(env.scriptedAction(result.observation), 4);
        expect(result.state.reason, `${scenario} seed ${seed}`).toBe("success");
        expect(result.state.collisions).toBe(0);
        env.dispose();
      }
  });

  it("keeps free flight open until its time budget instead of awarding hover success", () => {
    const env = new DroneEnvironment(
      config({ scenario: "free", maxSeconds: 20 }),
    );
    let result = env.step(env.scriptedAction(), 4);
    while (!result.state.terminated && !result.state.truncated)
      result = env.step(env.scriptedAction(), 4);
    expect(result.state.reason).toBe("timeout");
    expect(result.state.time).toBe(20);
    expect(result.state.terminated).toBe(false);
    env.dispose();
  });

  it("keeps omitted free-flight configs research-limited and makes arcade response materially faster", () => {
    const research = new DroneEnvironment(config({ scenario: "free", maxSeconds: 10 }));
    const arcade = new DroneEnvironment(
      config({ scenario: "free", flightFeel: "arcade", maxSeconds: 10 }),
    );
    const command = { kind: "nav" as const, velocity: [18, 0, 2] as [number, number, number], yawRate: 0 };
    let researchResult = research.step(command, 1);
    let arcadeResult = arcade.step(command, 1);
    for (let i = 0; i < 119; i++) {
      researchResult = research.step(command, 1);
      arcadeResult = arcade.step(command, 1);
    }
    expect(research.config.flightFeel).toBe("research");
    expect(researchResult.transition.appliedAction).toMatchObject({ velocity: [3, 0, 2] });
    expect(arcadeResult.transition.appliedAction).toMatchObject({ velocity: [18, 0, 2] });
    expect(arcade.state().velocity[0]).toBeGreaterThan(research.state().velocity[0] * 2.5);
    for (let i = 0; i < 240; i++) arcadeResult = arcade.step(command, 1);
    expect(arcade.state().velocity[0]).toBeGreaterThan(18);
    const beforeBrake = arcade.state().velocity[0];
    for (let i = 0; i < 120; i++)
      arcadeResult = arcade.step(
        { kind: "nav", velocity: [0, 0, 2], yawRate: 0 },
        1,
      );
    expect(Math.abs(arcade.state().velocity[0])).toBeLessThan(beforeBrake * 0.5);
    expect(arcade.state().velocity.every(Number.isFinite)).toBe(true);
    expect(Math.hypot(...arcade.state().velocity)).toBeLessThanOrEqual(36.0001);
    research.dispose();
    arcade.dispose();
  });

  it("bounces an energetic arcade wall impact once and keeps flying", () => {
    const env = new DroneEnvironment(
      config({ scenario: "free", flightFeel: "arcade", maxSeconds: 10 }),
    );
    const hangar = FREE_WORLD.obstacles.find((o) => o.id === "home-hangar")!;
    const drone = (env as any).drone;
    drone.setTranslation(
      {
        x: hangar.position[0] - hangar.size[0] / 2 - 0.4,
        y: hangar.position[1],
        z: hangar.position[2],
      },
      true,
    );
    drone.setLinvel({ x: 18, y: 0, z: 0 }, true);
    const hit = env.step({ kind: "rate", rates: [0, 0, 0], thrust: 0.42 }, 12);
    expect(hit.state.collisions).toBe(1);
    expect(hit.state.terminated).toBe(false);
    expect(hit.state.reason).toBe("");
    expect(hit.state.velocity[0]).toBeLessThan(-0.5);
    expect(hit.state.velocity.every(Number.isFinite)).toBe(true);
    expect(Math.hypot(...hit.state.velocity)).toBeLessThanOrEqual(36.0001);
    env.dispose();
  });

  it("settles a zero-thrust arcade drone on the ground without relaunching it", () => {
    const env = new DroneEnvironment(
      config({ scenario: "free", flightFeel: "arcade", maxSeconds: 10 }),
    );
    const drone = (env as any).drone;
    drone.setTranslation({ x: 0, y: 0, z: 0.061 }, true);
    drone.setLinvel({ x: 0, y: 0, z: 0 }, true);
    let maxAltitude = env.state().position[2];
    let result = env.step({ kind: "rate", rates: [0, 0, 0], thrust: 0 }, 1);
    for (let i = 0; i < 719; i++) {
      result = env.step({ kind: "rate", rates: [0, 0, 0], thrust: 0 }, 1);
      maxAltitude = Math.max(maxAltitude, result.state.position[2]);
    }
    expect(result.state.terminated).toBe(false);
    expect(result.state.collisions).toBe(0);
    expect(maxAltitude).toBeLessThan(0.12);
    expect(Math.abs(result.state.velocity[2])).toBeLessThan(0.2);
    env.dispose();
  });

  it("builds Aster Valley from the shared spawn, bounds, and obstacle boxes", () => {
    const scenario = createFreeScenario(FREE_WORLD);
    expect(scenario.spawn).toEqual([0, 0, 2]);
    expect(scenario.obstacles).toBe(FREE_WORLD.obstacles);
    expect(FREE_WORLD.bounds).toBe(200);
    expect(FREE_WORLD.ceiling).toBe(100);
    expect(scenario.obstacles.every((o) => o.size.every((v) => v > 0))).toBe(
      true,
    );
  });

  it("uses Aster Valley's documented horizontal and altitude limits", () => {
    const env = new DroneEnvironment(config({ scenario: "free" }));
    const drone = (env as any).drone;
    drone.setTranslation({ x: 201, y: 0, z: 10 }, true);
    expect(
      env.step({ kind: "rate", rates: [0, 0, 0], thrust: 0.42 }, 1).state
        .reason,
    ).toBe("out_of_bounds");
    env.dispose();

    const ceiling = new DroneEnvironment(config({ scenario: "free" }));
    const ceilingDrone = (ceiling as any).drone;
    ceilingDrone.setTranslation({ x: 0, y: 0, z: 101 }, true);
    expect(
      ceiling.step({ kind: "rate", rates: [0, 0, 0], thrust: 0.42 }, 1).state
        .reason,
    ).toBe("out_of_bounds");
    ceiling.dispose();
  });

  it("turns each shared Aster Valley structure into a physical collision box", () => {
    const env = new DroneEnvironment(config({ scenario: "free" }));
    const hangar = FREE_WORLD.obstacles.find((o) => o.id === "home-hangar");
    expect(hangar).toBeDefined();
    const drone = (env as any).drone;
    drone.setTranslation(
      { x: hangar!.position[0], y: hangar!.position[1], z: hangar!.position[2] },
      true,
    );
    drone.setLinvel({ x: 0, y: 0, z: 0 }, true);
    const hit = env.step({ kind: "rate", rates: [0, 0, 0], thrust: 0.42 }, 2);
    expect(hit.state.reason).toBe("collision");
    expect(hit.state.collisions).toBe(1);
    env.dispose();
  });

  it("switches to the indoor map and flies its clear center aisle before hitting the stage bear", () => {
    const env = new DroneEnvironment(config({ scenario: "free", mapId: "pizzeria", maxSeconds: 30 }));
    expect(env.scenario.mapId).toBe("pizzeria");
    expect(env.scenario.spawn).toEqual([-15, 0, 1.45]);
    const action = { kind: "nav" as const, velocity: [2, 0, 0] as [number, number, number], yawRate: 0 };
    let result = env.step(action, 4);
    for (let i = 0; i < 900 && !result.state.terminated && !result.state.truncated; i++) result = env.step(action, 4);
    expect(result.state.reason).toBe("collision");
    expect(result.state.position[0]).toBeGreaterThan(13);
    expect(result.state.collisions).toBe(1);
    env.dispose();
  });

  it("uses the pizzeria ceiling rather than the outdoor ceiling", () => {
    const env = new DroneEnvironment(config({ scenario: "free", mapId: "pizzeria" }));
    (env as any).drone.setTranslation({ x: 0, y: 0, z: 6.4 }, true);
    expect(env.step({ kind: "nav", velocity: [0, 0, 0], yawRate: 0 }, 1).state.reason).toBe("out_of_bounds");
    env.dispose();
  });

  it("keeps scripted pizzeria guidance inside the room and clear of furniture", () => {
    const env = new DroneEnvironment(config({ scenario: "free", mapId: "pizzeria", maxSeconds: 30 }));
    let result = env.step(env.scriptedAction(), 4);
    while (!result.state.terminated && !result.state.truncated)
      result = env.step(env.scriptedAction(), 4);
    expect(result.state.reason).toBe("timeout");
    expect(result.state.collisions).toBe(0);
    expect(Math.hypot(...result.state.position.map((v, i) => v - env.scenario.targets[0][i]))).toBeLessThan(2);
    env.dispose();
  });
});
