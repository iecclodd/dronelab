/**
 * Renderer-free DroneLab dynamics.  Coordinates are right handed ENU: x east,
 * y north, z up.  The airframe uses the FLU body convention: x forward, y
 * left, z up.  Quaternions are [x, y, z, w].
 */
import RAPIER from "@dimforge/rapier3d-compat";
import {
  ACTION_REPEAT,
  DEFAULT_CONFIG,
  MAX_ACTION_IMPULSE,
  NAV_LIMIT,
  YAW_LIMIT,
  ZERO_ACTION,
  type Action,
  type Obstacle,
  type Observation,
  type PhysicalState,
  type RewardComponents,
  type Scenario,
  type SimConfig,
  type StepResult,
  type Transition,
  type V3,
} from "../contracts/index.ts";
import {
  FREE_WORLD,
  type FreeWorldDefinition,
  type FreeWorldMapId,
} from "../contracts/free-world.ts";
import { PIZZERIA_WORLD } from "../contracts/pizzeria-world.ts";
import { CITY_WORLD } from "../contracts/city-world.ts";

export type Vec3 = V3;
type Quat = [number, number, number, number];

let rapierReady: Promise<void> | undefined;
export async function initPhysics(): Promise<void> {
  rapierReady ??= RAPIER.init();
  await rapierReady;
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (a: V3) => Math.hypot(...a);
const unit = (a: V3): V3 => {
  const n = length(a);
  return n > 1e-9 ? mul(a, 1 / n) : [0, 0, 0];
};
const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
const clampV = (v: V3, max: number): V3 => {
  const n = length(v);
  return n > max ? mul(v, max / n) : v;
};

/** Converts ENU coordinates to the conventional Three.js visual coordinates. */
export const enuToThreePosition = ([x, y, z]: V3): V3 => [x, z, -y];
/** Applies the same basis conversion to an ENU quaternion (x,y,z,w). */
export const enuToThreeQuaternion = ([x, y, z, w]: Quat): Quat => [x, z, -y, w];

class Rng {
  constructor(private state: number) {
    this.state ||= 0x6d2b79f5;
  }
  next(): number {
    let x = this.state | 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x | 0;
    return (x >>> 0) / 4294967296;
  }
  signed(): number {
    return this.next() * 2 - 1;
  }
  snapshot(): number {
    return this.state;
  }
  restore(state: number): void {
    this.state = state | 0;
  }
}

/**
 * The simulator and renderer consume the same obstacle boxes for each map.
 */
export const FREE_WORLD_MAPS: Partial<
  Record<FreeWorldMapId, FreeWorldDefinition>
> = { valley: FREE_WORLD, pizzeria: PIZZERIA_WORLD, city: CITY_WORLD };

export function freeWorldForMap(
  mapId: FreeWorldMapId | undefined,
): FreeWorldDefinition {
  return FREE_WORLD_MAPS[mapId ?? "valley"] ?? FREE_WORLD;
}

export function createFreeScenario(
  world: FreeWorldDefinition,
  mapId: FreeWorldMapId = "valley",
): Scenario {
  return {
    id: "free",
    mapId,
    name: world.name,
    description: `Explore ${world.name} inside its documented flight bounds.`,
    spawn: [...world.spawn] as V3,
    targets: [mapId === "pizzeria" ? [8, 0, 2] : mapId === "city" ? [0, 0, 30] : [70, 0, 8]],
    pad: [0, 0, 0],
    obstacles: world.obstacles,
  };
}

function scenarioFor(config: SimConfig, rng: Rng): Scenario {
  const jitter = (): number => rng.signed() * 0.25;
  if (config.scenario === "gates")
    return {
      id: "gates",
      name: "Gate course",
      description: "Follow the safe, ordered gates.",
      spawn: [jitter(), jitter(), 1.5],
      // Guidance points sit beyond the physical planes so the scripted policy
      // crosses each gate rather than stopping at its centre.
      targets: [
        [0, 6.2, 2],
        [0, 10.2, 2],
        [0, 14.2, 2],
      ],
      pad: [0, 13, 0],
      // Gates are four real collision bars, never a solid invisible wall.
      obstacles: [
        [0, 5, 2],
        [0, 9, 2],
        [0, 13, 2],
      ].flatMap((p, i) => gateFrame(`gate-${i}`, p as V3)),
    };
  if (config.scenario === "landing")
    return {
      id: "landing",
      name: "Landing pad",
      description: "Descend gently onto the pad.",
      spawn: [jitter(), -3 + jitter(), 2.2],
      targets: [[0, 0, 0.16]],
      pad: [0, 0, 0],
      obstacles: [],
    };
  if (config.scenario === "free")
    return createFreeScenario(
      freeWorldForMap(config.mapId),
      config.mapId ?? "valley",
    );
  return {
    id: "hover",
    name: "Hover target",
    description: "Reach and hold the illuminated target.",
    spawn: [jitter(), jitter(), 1.2],
    targets: [[0, 0, 2]],
    pad: [0, 0, 0],
    obstacles: [],
  };
}

function gateFrame(id: string, [x, y, z]: V3): Scenario["obstacles"] {
  const depth = 0.16,
    thickness = 0.16,
    halfWidth = 1.35,
    halfHeight = 1.35;
  return [
    {
      id: `${id}-left`,
      position: [x - halfWidth, y, z],
      size: [thickness, depth, halfHeight * 2 + thickness] as V3,
      kind: "gate",
    },
    {
      id: `${id}-right`,
      position: [x + halfWidth, y, z],
      size: [thickness, depth, halfHeight * 2 + thickness] as V3,
      kind: "gate",
    },
    {
      id: `${id}-top`,
      position: [x, y, z + halfHeight],
      size: [halfWidth * 2, depth, thickness] as V3,
      kind: "gate",
    },
    {
      id: `${id}-bottom`,
      position: [x, y, z - halfHeight],
      size: [halfWidth * 2, depth, thickness] as V3,
      kind: "gate",
    },
  ];
}

export function makeScenario(config: SimConfig): Scenario {
  return scenarioFor({ ...DEFAULT_CONFIG, ...config }, new Rng(config.seed));
}

const ARMS: V3[] = [
  [0.19, 0.19, 0],
  [0.19, -0.19, 0],
  [-0.19, -0.19, 0],
  [-0.19, 0.19, 0],
];
const SPIN = [1, -1, 1, -1];
const MASS = 1;
const MAX_THRUST = 5.8;
const MOTOR_TAU = 0.045;
const YAW_COEFF = 0.04;
const ARENA_HALF_EXTENT = 25;
const ARCADE_OUTDOOR_NAV_LIMIT = 34;
const ARCADE_INDOOR_NAV_LIMIT = 18;
/** Sustained arcade speed cap; kicks (dash, blasts) may briefly exceed it. */
const ARCADE_VELOCITY_LIMIT = 40;
const ARCADE_BURST_LIMIT = 58;
const ARCADE_BURST_TICKS = 42;
const ARCADE_BOUNCE_MIN_SPEED_MS = 2.25;
/** Collision *counting* cooldown; every energetic contact still bounces. */
const ARCADE_BOUNCE_COOLDOWN_TICKS = 12;
/** Arcade restitution: rebounds keep most of their energy, plus a small pop. */
const ARCADE_RESTITUTION = 0.9;
const ARCADE_BOUNCE_POP = 2.4;
const ARCADE_BALL_RADIUS = 0.24;
/** Arcade heading chases the camera, so it may turn much faster than research. */
const ARCADE_YAW_LIMIT = 9;

function rotate(q: Quat, v: V3): V3 {
  const [x, y, z, w] = q;
  const uv = cross([x, y, z], v);
  const uuv = cross([x, y, z], uv);
  return add(v, add(mul(uv, 2 * w), mul(uuv, 2)));
}
function unrotate(q: Quat, v: V3): V3 {
  return rotate([-q[0], -q[1], -q[2], q[3]], v);
}
function qFromBodyAxes(x: V3, y: V3, z: V3): Quat {
  const m00 = x[0],
    m01 = y[0],
    m02 = z[0],
    m10 = x[1],
    m11 = y[1],
    m12 = z[1],
    m20 = x[2],
    m21 = y[2],
    m22 = z[2];
  const trace = m00 + m11 + m22;
  let q: Quat;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  return q;
}
function qErrorVector(current: Quat, wanted: Quat): V3 {
  const [x, y, z, w] = current;
  const [X, Y, Z, W] = wanted;
  // wanted * inverse(current), choosing shortest representation.
  const q: Quat = [
    X * w - W * x - Y * z + Z * y,
    Y * w - W * y - Z * x + X * z,
    Z * w - W * z - X * y,
    W * w + X * x + Y * y + Z * z,
  ];
  const sign = q[3] < 0 ? -1 : 1;
  return [2 * sign * q[0], 2 * sign * q[1], 2 * sign * q[2]];
}

function copyImpulse(a: Action): Pick<Action, "impulse" | "pulse"> {
  return a.impulse ? { impulse: [...a.impulse] as V3, pulse: a.pulse } : {};
}
function copyAction(a: Action): Action {
  return a.kind === "nav"
    ? { kind: "nav", velocity: [...a.velocity] as V3, yawRate: a.yawRate, ...copyImpulse(a) }
    : { kind: "rate", rates: [...a.rates] as V3, thrust: a.thrust, ...copyImpulse(a) };
}
function qMul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
/** Axis-angle vector (radians) to quaternion. */
function qFromRotationVector(v: V3): Quat {
  const angle = length(v);
  if (angle < 1e-9) return [0, 0, 0, 1];
  const s = Math.sin(angle / 2) / angle;
  return [v[0] * s, v[1] * s, v[2] * s, Math.cos(angle / 2)];
}
function qNormalize(q: Quat): Quat {
  const n = Math.hypot(...q) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}
/** Outward face normal of an axis-aligned box nearest to point p. */
function boxFaceNormal(box: Obstacle, p: V3): V3 {
  let best = 0, axis = 0;
  for (let i = 0; i < 3; i++) {
    const d = (p[i]! - box.position[i]!) / Math.max(box.size[i]! / 2, 1e-6);
    if (Math.abs(d) > Math.abs(best)) { best = d; axis = i; }
  }
  const n: V3 = [0, 0, 0];
  n[axis] = best < 0 ? -1 : 1;
  return n;
}
function sameConfig(a: SimConfig, b: SimConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export class DroneEnvironment {
  readonly config: SimConfig;
  scenario: Scenario;
  private world!: RAPIER.World;
  private drone!: RAPIER.RigidBody;
  private droneCollider!: RAPIER.Collider;
  private padCollider?: RAPIER.Collider;
  private contactTags = new Map<number, "ground" | "pad" | "obstacle">();
  private obstacleByHandle = new Map<number, Obstacle>();
  private activeContacts = new Set<number>();
  private rng: Rng;
  private motor = [0, 0, 0, 0];
  private prior: Action = copyAction(ZERO_ACTION);
  private queue: Observation[] = [];
  private delivered!: Observation;
  private tick = 0;
  private decision = 0;
  private targetIndex = 0;
  private collisions = 0;
  private stopped = false;
  private terminated = false;
  private truncated = false;
  private reason = "";
  private wasOutOfBounds = false;
  private energy = 0;
  private yaw = 0;
  private lastDistance = 0;
  private settledTicks = 0;
  private previousPosition: V3 = [0, 0, 0];
  private lastArcadeImpactTick = -Infinity;
  // Arcade presentation state: heading tilt, damped tumble and one-shot kicks.
  private lastPulse: number | undefined = undefined;
  private burstTicks = 0;
  private tilt: V3 = [0, 0, 0];
  private tumble: V3 = [0, 0, 0];
  private tumbleRate: V3 = [0, 0, 0];
  private acroAttitude: Quat = [0, 0, 0, 1];
  private lastImpact: PhysicalState["impact"] = undefined;
  private initialized = false;

  constructor(config: SimConfig) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      wind: [...(config.wind ?? DEFAULT_CONFIG.wind)] as V3,
    };
    this.rng = new Rng(this.config.seed);
    this.scenario = scenarioFor(this.config, this.rng);
    this.reset();
  }

  private ensure(): void {
    if (this.initialized) return;
    if (!rapierReady)
      throw new Error(
        "Call and await initPhysics() before constructing a simulation world.",
      );
    this.buildWorld();
    this.initialized = true;
  }
  private freeWorld(): FreeWorldDefinition | undefined {
    return this.config.scenario === "free"
      ? freeWorldForMap(this.config.mapId)
      : undefined;
  }
  /** Arcade is deliberately isolated to player free flight, never missions. */
  private arcadeFreeFlight(): boolean {
    return this.config.scenario === "free" && this.config.flightFeel === "arcade";
  }
  private navigationLimit(): number {
    if (!this.arcadeFreeFlight()) return NAV_LIMIT;
    return this.config.mapId === "pizzeria"
      ? ARCADE_INDOOR_NAV_LIMIT
      : ARCADE_OUTDOOR_NAV_LIMIT;
  }
  private buildWorld(): void {
    this.world?.free();
    this.world = new RAPIER.World({ x: 0, y: 0, z: -9.81 });
    const ground = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, -0.15),
    );
    const groundHalfExtent = this.freeWorld()?.bounds ?? 30;
    const groundCollider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(
        groundHalfExtent,
        groundHalfExtent,
        0.15,
      ).setFriction(0.9),
      ground,
    );
    this.contactTags.set(groundCollider.handle, "ground");
    if (this.config.scenario === "landing") {
      const pad = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(...this.scenario.pad),
      );
      this.padCollider = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.7, 0.7, 0.04)
          .setTranslation(0, 0, 0.04)
          .setFriction(0.9),
        pad,
      );
      this.contactTags.set(this.padCollider.handle, "pad");
    }
    for (const obstacle of this.scenario.obstacles) {
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(...obstacle.position),
      );
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(
          ...(obstacle.size.map((x) => x / 2) as [number, number, number]),
        ),
        body,
      );
      this.contactTags.set(collider.handle, "obstacle");
      this.obstacleByHandle.set(collider.handle, obstacle);
    }
    const arcade = this.arcadeFreeFlight();
    const droneDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(...this.scenario.spawn)
      .setLinearDamping(arcade ? 0 : 0.42)
      .setAngularDamping(arcade ? 0 : 1.1)
      // CCD protects the fast arcade profile from passing through thin map
      // geometry between fixed simulation steps.
      .setCcdEnabled(arcade)
      .setAdditionalMassProperties(
        MASS,
        { x: 0, y: 0, z: 0 },
        { x: 0.025, y: 0.025, z: 0.045 },
        { x: 0, y: 0, z: 0, w: 1 },
      );
    // Arcade drives a rotation-locked ball: orientation is purely expressive
    // (bank, tumble) and set each tick, so it can never snag the collider.
    if (arcade) droneDesc.lockRotations();
    this.drone = this.world.createRigidBody(droneDesc);
    this.droneCollider = this.world.createCollider(
      (arcade
        ? RAPIER.ColliderDesc.ball(ARCADE_BALL_RADIUS)
        : RAPIER.ColliderDesc.cuboid(0.16, 0.16, 0.06))
        .setDensity(0)
        .setRestitution(arcade ? 0.2 : 0.05)
        .setFriction(arcade ? 0.15 : 0.45),
      this.drone,
    );
  }
  private rebuildContactMetadata(): void {
    this.contactTags.clear();
    this.obstacleByHandle.clear();
    this.padCollider = undefined;
    this.world.colliders.forEach((collider) => {
      const parent = collider.parent();
      if (parent?.isDynamic()) {
        this.droneCollider = collider;
        return;
      }
      const p = collider.translation();
      if (Math.abs(p.z + 0.15) < 0.001)
        this.contactTags.set(collider.handle, "ground");
      else if (
        this.config.scenario === "landing" &&
        Math.hypot(
          p.x - this.scenario.pad[0],
          p.y - this.scenario.pad[1],
          p.z - 0.04,
        ) < 0.001
      ) {
        this.padCollider = collider;
        this.contactTags.set(collider.handle, "pad");
      } else {
        this.contactTags.set(collider.handle, "obstacle");
        const match = this.scenario.obstacles.find((o) =>
          Math.hypot(o.position[0] - p.x, o.position[1] - p.y, o.position[2] - p.z) < 0.001,
        );
        if (match) this.obstacleByHandle.set(collider.handle, match);
      }
    });
  }
  reset(seed = this.config.seed): Observation {
    this.rng = new Rng(seed);
    this.scenario = scenarioFor({ ...this.config, seed }, this.rng);
    this.tick =
      this.decision =
      this.targetIndex =
      this.collisions =
      this.energy =
      this.yaw =
      this.settledTicks =
        0;
    this.motor = [0, 0, 0, 0];
    this.prior = copyAction(ZERO_ACTION);
    this.queue = [];
    this.activeContacts.clear();
    this.contactTags.clear();
    this.padCollider = undefined;
    this.stopped =
      this.terminated =
      this.truncated =
      this.wasOutOfBounds =
        false;
    this.reason = "";
    this.lastArcadeImpactTick = -Infinity;
    this.lastPulse = undefined;
    this.burstTicks = 0;
    this.tilt = [0, 0, 0];
    this.tumble = [0, 0, 0];
    this.tumbleRate = [0, 0, 0];
    this.acroAttitude = [0, 0, 0, 1];
    this.lastImpact = undefined;
    this.obstacleByHandle.clear();
    this.initialized = false;
    this.ensure();
    this.previousPosition = this.rawState().position;
    this.lastDistance = length(sub(this.target(), this.previousPosition));
    this.delivered = this.sampleObservation(this.tick);
    return copyObservation(this.delivered);
  }
  private target(): V3 {
    return this.scenario.targets[
      Math.min(this.targetIndex, this.scenario.targets.length - 1)
    ]!;
  }
  private gateCenter(index: number): V3 {
    const gate = this.scenario.obstacles.find(
      (obstacle) => obstacle.id === `gate-${index}-top`,
    );
    if (!gate) throw new Error(`Missing gate ${index}.`);
    return [gate.position[0], gate.position[1], gate.position[2] - 1.35];
  }
  private rawState(): PhysicalState {
    this.ensure();
    const p = this.drone.translation(),
      v = this.drone.linvel(),
      q = this.drone.rotation(),
      w = this.drone.angvel();
    return {
      step: this.tick,
      time: this.tick * this.config.dt,
      position: [p.x, p.y, p.z],
      velocity: [v.x, v.y, v.z],
      quaternion: [q.x, q.y, q.z, q.w],
      angularVelocity: [w.x, w.y, w.z],
      motors: [...this.motor],
      battery: clamp(1 - this.energy / 1200, 0, 1),
      energy: this.energy,
      target: [...this.target()],
      targetIndex: this.targetIndex,
      collisions: this.collisions,
      terminated: this.terminated,
      truncated: this.truncated,
      reason: this.reason,
      ...(this.lastImpact ? { impact: { ...this.lastImpact, normal: [...this.lastImpact.normal] as V3 } } : {}),
    };
  }
  state(): PhysicalState {
    return this.rawState();
  }
  private ranges(p: V3): number[] {
    const max = 10;
    const dirs: V3[] = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
    return dirs.map((d) => {
      let hit = d[2] < 0 ? p[2] : max;
      for (const o of this.scenario.obstacles) {
        const rel = sub(o.position, p);
        const forward = dot(rel, d);
        if (forward <= 0 || forward >= hit) continue;
        const lateral = length(sub(rel, mul(d, forward)));
        if (lateral < Math.max(o.size[0], o.size[1], o.size[2]) / 2)
          hit = forward;
      }
      return clamp(hit, 0, max) / max;
    });
  }
  private sampleObservation(
    deliveryStep = this.tick + this.config.delaySteps,
  ): Observation {
    const s = this.rawState();
    const n = this.config.noise;
    const noisy = (v: number, scale: number) =>
      v + this.rng.signed() * n * scale;
    const relative = sub(s.target, s.position).map((v) => noisy(v, 0.04)) as V3;
    return {
      version: "state-v1",
      sourceStep: s.step,
      deliveryStep,
      sampleTime: s.time,
      deliveryTime: deliveryStep * this.config.dt,
      position: s.position.map((v) => noisy(v, 0.02)) as V3,
      velocity: s.velocity.map((v) => noisy(v, 0.025)) as V3,
      quaternion: [...s.quaternion],
      angularVelocity: s.angularVelocity.map((v) => noisy(v, 0.02)) as V3,
      relativeTarget: relative,
      range: this.ranges(s.position).map((v) => clamp(noisy(v, 0.01), 0, 1)),
      battery: s.battery,
      priorAction: copyAction(this.prior),
      elapsed: s.time,
    };
  }
  observe(): Observation {
    this.ensure();
    while (this.queue.length && this.queue[0]!.deliveryStep <= this.tick)
      this.delivered = this.queue.shift()!;
    return copyObservation(this.delivered);
  }
  private controller(action: Action): number[] {
    const s = this.rawState();
    const q = s.quaternion as Quat;
    const bodyZ = rotate(q, [0, 0, 1]);
    const bodyRates = unrotate(q, s.angularVelocity);
    let thrust = 0;
    let wantedRates: V3 = [0, 0, 0];
    const arcade = this.arcadeFreeFlight();
    if (action.kind === "rate") {
      thrust = action.thrust * 4 * MAX_THRUST;
      wantedRates = mul(action.rates, arcade ? 7 : 4);
    } else {
      const velError = sub(action.velocity, s.velocity);
      // Navigation is strictly velocity/yaw input. Mission position guidance is
      // owned by scriptedAction (or a future planner), never this stabilizer.
      const desiredAccel = clampV(mul(velError, arcade ? 8.5 : 4.2), arcade ? 32 : 6);
      const force = add(
        [this.config.wind[0] * 0.14, this.config.wind[1] * 0.14, MASS * 9.81],
        mul(desiredAccel, MASS),
      );
      const wantedZ = unit(force);
      const yaw = this.yaw;
      const heading: V3 = [Math.cos(yaw), Math.sin(yaw), 0];
      const wantedY = unit(cross(wantedZ, heading));
      const wantedX = unit(cross(wantedY, wantedZ));
      const wanted = qFromBodyAxes(wantedX, wantedY, wantedZ);
      const attitudeBody = unrotate(q, qErrorVector(q, wanted));
      const yawRateBody = unrotate(q, [
        0,
        0,
        clamp(action.yawRate, -YAW_LIMIT, YAW_LIMIT),
      ]);
      wantedRates = clampV(
        add(mul(attitudeBody, arcade ? 5.8 : 1.7), yawRateBody),
        arcade ? 7 : 2.5,
      );
      thrust = clamp(dot(force, bodyZ), 0, 4 * MAX_THRUST);
    }
    // Gains match the explicit quadrotor inertia and avoid mixer saturation.
    const rateError = sub(wantedRates, bodyRates);
    const torque = [
      rateError[0] * (arcade ? 0.011 : 0.004),
      rateError[1] * (arcade ? 0.011 : 0.004),
      rateError[2] * (arcade ? 0.0023 : 0.0008),
    ] as V3;
    const a = ARMS[0]![0],
      c = YAW_COEFF;
    const f = [
      thrust / 4 +
        torque[0] / (4 * a) -
        torque[1] / (4 * a) +
        torque[2] / (4 * c),
      thrust / 4 -
        torque[0] / (4 * a) -
        torque[1] / (4 * a) -
        torque[2] / (4 * c),
      thrust / 4 -
        torque[0] / (4 * a) +
        torque[1] / (4 * a) +
        torque[2] / (4 * c),
      thrust / 4 +
        torque[0] / (4 * a) +
        torque[1] / (4 * a) -
        torque[2] / (4 * c),
    ];
    // Preserve the requested collective as far as possible when saturation occurs.
    const peak = Math.max(...f);
    const floor = Math.min(...f);
    const offset =
      peak > MAX_THRUST ? MAX_THRUST - peak : floor < 0 ? -floor : 0;
    return f.map((v) => clamp((v + offset) / MAX_THRUST, 0, 1));
  }
  /**
   * Arcade drive: hovering, gravity-compensated velocity chase with a hard
   * acceleration cap, plus one-shot kicks. No rotor model, deliberately.
   */
  private arcadeDrive(requested: Action, s: PhysicalState, dt: number): void {
    this.drone.resetForces(true);
    this.drone.resetTorques(true);
    if (requested.impulse && requested.pulse !== undefined && requested.pulse !== this.lastPulse) {
      this.lastPulse = requested.pulse;
      const kick = clampV(requested.impulse, MAX_ACTION_IMPULSE);
      // Kicks are velocity changes (m/s); set directly so they never depend on
      // Rapier's lazily computed mass properties.
      const v = this.drone.linvel();
      this.drone.setLinvel({ x: v.x + kick[0], y: v.y + kick[1], z: v.z + kick[2] }, true);
      s = { ...s, velocity: [v.x + kick[0], v.y + kick[1], v.z + kick[2]] };
      if (length(kick) > 4) this.burstTicks = ARCADE_BURST_TICKS;
    }
    let accel: V3;
    if (requested.kind === "nav") {
      const moving = length(requested.velocity) > 0.1;
      accel = clampV(mul(sub(requested.velocity, s.velocity), moving ? 6.5 : 4.2), moving ? 60 : 38);
      // While a kick is live, let momentum carry instead of braking it away.
      if (this.burstTicks > 0) accel = mul(accel, 0.35);
      this.drone.addForce({ x: accel[0] * MASS, y: accel[1] * MASS, z: (accel[2] + 9.81) * MASS }, true);
    } else {
      this.acroAttitude = qNormalize(qMul(this.acroAttitude, qFromRotationVector(mul(requested.rates, 5.5 * dt))));
      const up = rotate(this.acroAttitude, [0, 0, 1]);
      const thrust = requested.thrust * 4 * MAX_THRUST * 1.35;
      accel = sub(mul(up, thrust / MASS), mul(s.velocity, 0.22));
      this.drone.addForce({ x: accel[0] * MASS, y: accel[1] * MASS, z: accel[2] * MASS }, true);
      accel = add(accel, [0, 0, -9.81]);
    }
    const effort = clamp(0.32 + length(accel) / 70, 0, 1);
    this.motor = this.motor.map((m) => m + (effort - m) * clamp(dt / 0.05, 0, 1));
    // Bank into horizontal acceleration like a racing kart, not a real quad.
    const horizontal: V3 = [accel[0], accel[1], 0];
    const wantedTilt = mul(unit(cross([0, 0, 1], horizontal)), Math.min(length(horizontal) / 60, 1) * 0.5);
    this.tilt = add(this.tilt, mul(sub(length(horizontal) > 1e-6 ? wantedTilt : [0, 0, 0], this.tilt), clamp(dt * 10, 0, 1)));
    // Tumble is a damped spring: big hits spin the drone, it rights itself.
    this.tumbleRate = add(this.tumbleRate, mul(add(mul(this.tumble, -38), mul(this.tumbleRate, -7.5)), dt));
    this.tumble = add(this.tumble, mul(this.tumbleRate, dt));
  }
  private arcadeOrientation(): Quat {
    const base: Quat = this.prior.kind === "rate" || this.config.flightFeel !== "arcade"
      ? this.acroAttitude
      : [0, 0, Math.sin(this.yaw / 2), Math.cos(this.yaw / 2)];
    return qNormalize(qMul(qFromRotationVector(this.tumble), qMul(qFromRotationVector(this.tilt), base)));
  }
  private tickOnce(requested: Action): RewardComponents {
    const dt = this.config.dt;
    const arcade = this.arcadeFreeFlight();
    let s: PhysicalState;
    let q: Quat;
    let bodyZ: V3;
    if (arcade) {
      s = this.rawState();
      q = s.quaternion as Quat;
      bodyZ = rotate(q, [0, 0, 1]);
      this.arcadeDrive(requested, s, dt);
    } else {
      const targetMotor = this.controller(requested);
      this.motor = this.motor.map(
        (m, i) => m + (targetMotor[i]! - m) * clamp(dt / MOTOR_TAU, 0, 1),
      );
      s = this.rawState();
      q = s.quaternion as Quat;
      bodyZ = rotate(q, [0, 0, 1]);
      // External forces persist in Rapier until explicitly cleared. Evaluate
      // rotor lift, drag and wind anew every fixed tick.
      this.drone.resetForces(true);
      this.drone.resetTorques(true);
      let yawTorque = 0;
      ARMS.forEach((arm, i) => {
        const force = this.motor[i]! * MAX_THRUST;
        const point = add(s.position, rotate(q, arm));
        const lift = mul(rotate(q, [0, 0, 1]), force);
        this.drone.addForceAtPoint(
          { x: lift[0], y: lift[1], z: lift[2] },
          { x: point[0], y: point[1], z: point[2] },
          true,
        );
        yawTorque += SPIN[i]! * force * YAW_COEFF;
      });
      this.drone.addForce(
        {
          x: -s.velocity[0] * 0.16 + this.config.wind[0] * 0.1,
          y: -s.velocity[1] * 0.16 + this.config.wind[1] * 0.1,
          z: -s.velocity[2] * 0.1,
        },
        true,
      );
      const reactionTorque = rotate(q, [0, 0, yawTorque]);
      this.drone.addTorque(
        {
          x: reactionTorque[0] - s.angularVelocity[0] * 0.015,
          y: reactionTorque[1] - s.angularVelocity[1] * 0.015,
          z: reactionTorque[2] - s.angularVelocity[2] * 0.018,
        },
        true,
      );
    }
    this.world.timestep = dt;
    this.world.step();
    if (requested.kind === "nav") this.yaw += requested.yawRate * dt;
    if (arcade) {
      const v = this.drone.linvel();
      const limited = clampV([v.x, v.y, v.z], this.burstTicks > 0 ? ARCADE_BURST_LIMIT : ARCADE_VELOCITY_LIMIT);
      this.drone.setLinvel({ x: limited[0], y: limited[1], z: limited[2] }, true);
      this.burstTicks = Math.max(0, this.burstTicks - 1);
      this.prior = copyAction(requested);
      const o = this.arcadeOrientation();
      this.drone.setRotation({ x: o[0], y: o[1], z: o[2], w: o[3] }, true);
    }
    this.tick++;
    this.energy += this.motor.reduce((sum, m) => sum + m * m, 0) * dt;
    let next = this.rawState();
    const d = length(sub(next.target, next.position));
    const progress = clamp((this.lastDistance - d) * 0.7, -1, 1);
    this.lastDistance = d;
    const contacts = new Set<number>();
    this.world.contactPairsWith(this.droneCollider, (other) => {
      contacts.add(other.handle);
    });
    const entered = [...contacts].filter(
      (handle) => !this.activeContacts.has(handle),
    );
    this.activeContacts = contacts;
    const tags = entered.map((handle) => this.contactTags.get(handle));
    const onPad =
      this.padCollider !== undefined && contacts.has(this.padCollider.handle);
    let collision = 0;
    const hitObstacle = tags.some((tag) => tag === "obstacle");
    const hitGround = tags.some((tag) => tag === "ground");
    const impactSpeed = length(s.velocity);
    const energeticArcadeImpact =
      (hitObstacle && impactSpeed >= ARCADE_BOUNCE_MIN_SPEED_MS) ||
      (hitGround && s.velocity[2] <= -ARCADE_BOUNCE_MIN_SPEED_MS);
    const arcadeImpactReady =
      this.tick - this.lastArcadeImpactTick >= ARCADE_BOUNCE_COOLDOWN_TICKS;
    const collisionContact =
      hitObstacle || (hitGround && this.config.scenario !== "landing");
    const crash = arcade
      ? energeticArcadeImpact && arcadeImpactReady
      : collisionContact;
    if (arcade && energeticArcadeImpact) {
      // Reflect the pre-impact velocity about the contact normal: bouncy,
      // readable and energetic, with a spin kick that the tumble spring rights.
      let normal: V3 = [0, 0, 0];
      for (const handle of entered) {
        const tag = this.contactTags.get(handle);
        const obstacle = this.obstacleByHandle.get(handle);
        if (tag === "ground") normal = add(normal, [0, 0, 1]);
        else if (obstacle) normal = add(normal, boxFaceNormal(obstacle, s.position));
      }
      normal = length(normal) > 1e-6 ? unit(normal) : [0, 0, 1];
      const into = dot(s.velocity, normal);
      if (into < 0) {
        const reflected = sub(s.velocity, mul(normal, (1 + ARCADE_RESTITUTION) * into));
        const rebound = clampV(add(reflected, mul(normal, ARCADE_BOUNCE_POP)), ARCADE_BURST_LIMIT);
        this.drone.setLinvel({ x: rebound[0], y: rebound[1], z: rebound[2] }, true);
        this.burstTicks = Math.max(this.burstTicks, 18);
        this.tumbleRate = clampV(add(this.tumbleRate, mul(cross(normal, s.velocity), 0.55)), 16);
        this.lastImpact = { step: this.tick, speed: impactSpeed, normal };
        next = this.rawState();
      }
    }
    if (crash) {
      this.collisions++;
      collision = -1;
      if (arcade) {
        this.lastArcadeImpactTick = this.tick;
      } else {
        this.terminated = true;
        this.reason = "collision";
      }
    }
    const touchedSurface = tags.some(
      (tag) => tag === "ground" || tag === "pad",
    );
    const preHorizontal = Math.hypot(s.velocity[0], s.velocity[1]);
    const preTilt = dot(bodyZ, [0, 0, 1]);
    if (
      this.config.scenario === "landing" &&
      touchedSurface &&
      (s.velocity[2] < -1.2 || preHorizontal > 1.2 || preTilt < 0.82)
    ) {
      this.collisions++;
      collision = -1;
      this.terminated = true;
      this.reason = "collision";
    }
    const freeWorld = this.freeWorld();
    const outOfBounds = freeWorld
      ? Math.abs(next.position[0]) > freeWorld.bounds ||
        Math.abs(next.position[1]) > freeWorld.bounds ||
        next.position[2] > freeWorld.ceiling
      : Math.abs(next.position[0]) > ARENA_HALF_EXTENT ||
        Math.abs(next.position[1]) > ARENA_HALF_EXTENT ||
        next.position[2] > ARENA_HALF_EXTENT;
    if (outOfBounds && arcade && freeWorld) {
      // Arcade map edges are a springy force field, not a run-ending wall.
      const p = [...next.position] as V3;
      const v = [...next.velocity] as V3;
      const normal: V3 = [0, 0, 0];
      for (const axis of [0, 1] as const) {
        if (Math.abs(p[axis]) > freeWorld.bounds) {
          normal[axis] = -Math.sign(p[axis]);
          p[axis] = Math.sign(p[axis]) * (freeWorld.bounds - 0.05);
          v[axis] = -v[axis] * ARCADE_RESTITUTION + normal[axis] * ARCADE_BOUNCE_POP;
        }
      }
      if (p[2] > freeWorld.ceiling) {
        normal[2] = -1;
        p[2] = freeWorld.ceiling - 0.05;
        v[2] = -Math.abs(v[2]) * ARCADE_RESTITUTION - ARCADE_BOUNCE_POP;
      }
      this.drone.setTranslation({ x: p[0], y: p[1], z: p[2] }, true);
      this.drone.setLinvel({ x: v[0], y: v[1], z: v[2] }, true);
      this.lastImpact = { step: this.tick, speed: length(next.velocity), normal: unit(normal) };
      next = this.rawState();
    } else if (outOfBounds && !this.wasOutOfBounds) {
      this.collisions++;
      collision = -1;
      this.terminated = true;
      this.reason = "out_of_bounds";
    }
    this.wasOutOfBounds = outOfBounds && !arcade;
    let success = 0;
    const gate = this.config.scenario === "gates";
    const gentle = length(next.velocity) < (gate ? 1.4 : 1.1);
    const arrivalRadius = gate ? 1.2 : 0.48;
    if (this.config.scenario === "free") {
      /* free flight is only time bounded */
    } else if (gate) {
      const center = this.gateCenter(this.targetIndex);
      const crossed =
        this.previousPosition[1] < center[1] && next.position[1] >= center[1];
      const fraction = crossed
        ? clamp(
            (center[1] - this.previousPosition[1]) /
              Math.max(next.position[1] - this.previousPosition[1], 1e-9),
            0,
            1,
          )
        : 0;
      const crossing: V3 = add(
        this.previousPosition,
        mul(sub(next.position, this.previousPosition), fraction),
      );
      const insideOpening =
        Math.abs(crossing[0] - center[0]) < 1.1 &&
        Math.abs(crossing[2] - center[2]) < 1.1;
      if (crossed && insideOpening) {
        if (this.targetIndex < 2) {
          this.targetIndex++;
          this.lastDistance = length(sub(this.target(), next.position));
        } else {
          this.terminated = true;
          this.reason = "success";
          success = 10;
        }
      }
    } else if (this.config.scenario === "landing") {
      const horizontal = Math.hypot(next.velocity[0], next.velocity[1]);
      const overPad =
        Math.hypot(
          next.position[0] - this.scenario.pad[0],
          next.position[1] - this.scenario.pad[1],
        ) < 0.52;
      if (
        onPad &&
        overPad &&
        horizontal < 0.45 &&
        Math.abs(next.velocity[2]) < 0.35
      )
        this.settledTicks++;
      else this.settledTicks = 0;
      if (this.settledTicks >= 12) {
        this.terminated = true;
        this.reason = "success";
        success = 10;
      }
    } else if (
      this.config.scenario === "hover" &&
      d < arrivalRadius &&
      gentle
    ) {
      this.settledTicks++;
      if (this.settledTicks >= 20) {
        this.terminated = true;
        this.reason = "success";
        success = 10;
      }
    } else this.settledTicks = 0;
    this.previousPosition = next.position;
    if (this.tick * dt >= this.config.maxSeconds) {
      this.truncated = true;
      this.reason ||= "timeout";
    }
    const tracking = -Math.min(d, 8) * 0.04 * dt,
      energy = -this.motor.reduce((x, m) => x + m * m, 0) * 0.003 * dt;
    const total = tracking + progress + energy + collision + success;
    this.prior = copyAction(requested);
    this.queue.push(this.sampleObservation());
    if (this.queue.length > Math.max(32, this.config.delaySteps + 4))
      this.queue.shift();
    return { tracking, progress, energy, collision, success, total };
  }
  step(action: Action, ticks = ACTION_REPEAT): StepResult {
    this.ensure();
    assertAction(action);
    const requested = copyAction(action);
    const applied = boundedAction(action, this.navigationLimit(), this.arcadeFreeFlight() ? ARCADE_YAW_LIMIT : YAW_LIMIT);
    const start = this.tick;
    const observation = this.observe();
    const total: RewardComponents = {
      tracking: 0,
      progress: 0,
      energy: 0,
      collision: 0,
      success: 0,
      total: 0,
    };
    let actual = 0;
    if (!this.terminated && !this.truncated && !this.stopped)
      for (let i = 0; i < Math.max(1, Math.floor(ticks)); i++) {
        const c = this.tickOnce(applied);
        (Object.keys(total) as (keyof RewardComponents)[]).forEach((k) => {
          total[k] += c[k];
        });
        actual++;
        if (this.terminated || this.truncated) break;
      }
    const next = this.observe();
    const state = this.rawState();
    const transition: Transition = {
      observation,
      requestedAction: requested,
      appliedAction: applied,
      nextObservation: next,
      reward: total.total,
      components: total,
      state,
      startStep: start,
      endStep: this.tick,
      ticks: actual,
      decision: this.decision++,
      terminated: state.terminated,
      truncated: state.truncated,
      reason: state.reason,
      wallTime: 0,
      validThroughStep: this.tick,
    };
    return { observation: next, state, transition };
  }
  scriptedAction(observation: Observation = this.observe()): Action {
    // This intentionally consumes the policy-visible observation, not ground truth.
    // The velocity stabilizer already damps measured velocity.  This planner
    // contributes only a position-derived velocity setpoint from policy input.
    const vel = clampV(
      add(
        mul(observation.relativeTarget, 0.55),
        mul(observation.velocity, -0.35),
      ),
      NAV_LIMIT,
    );
    // The landing baseline first centres laterally at a safe 1.2 m approach
    // height, then descends at a bounded rate. Inputs remain observation-only.
    if (this.config.scenario === "landing") {
      const lateral = Math.hypot(
        observation.relativeTarget[0],
        observation.relativeTarget[1],
      );
      if (lateral > 0.5)
        vel[2] = clamp((1.2 - observation.position[2]) * 0.7, -0.35, 0.45);
      else
        vel[2] = clamp(
          observation.relativeTarget[2] * 0.45 - observation.velocity[2] * 0.15,
          -0.18,
          0.35,
        );
      vel[0] = clamp(
        observation.relativeTarget[0] * 0.4 - observation.velocity[0] * 0.6,
        -0.4,
        0.4,
      );
      vel[1] = clamp(
        observation.relativeTarget[1] * 0.4 - observation.velocity[1] * 0.6,
        -0.4,
        0.4,
      );
    }
    return { kind: "nav", velocity: vel, yawRate: 0 };
  }
  randomAction(): Action {
    return {
      kind: "nav",
      velocity: [
        this.rng.signed() * NAV_LIMIT,
        this.rng.signed() * NAV_LIMIT,
        this.rng.signed() * NAV_LIMIT,
      ],
      yawRate: this.rng.signed() * YAW_LIMIT,
    };
  }
  snapshot(): any {
    this.ensure();
    return {
      version: "sim-v1",
      config: this.config,
      scenario: this.scenario,
      rapier: Array.from(this.world.takeSnapshot()),
      rng: this.rng.snapshot(),
      motor: [...this.motor],
      prior: copyAction(this.prior),
      queue: this.queue.map(copyObservation),
      delivered: copyObservation(this.delivered),
      activeContacts: [...this.activeContacts],
      previousPosition: [...this.previousPosition],
      tick: this.tick,
      decision: this.decision,
      targetIndex: this.targetIndex,
      collisions: this.collisions,
      stopped: this.stopped,
      terminated: this.terminated,
      truncated: this.truncated,
      reason: this.reason,
      wasOutOfBounds: this.wasOutOfBounds,
      energy: this.energy,
      yaw: this.yaw,
      lastDistance: this.lastDistance,
      settledTicks: this.settledTicks,
      lastArcadeImpactTick: this.lastArcadeImpactTick,
      arcade: {
        lastPulse: this.lastPulse,
        burstTicks: this.burstTicks,
        tilt: [...this.tilt],
        tumble: [...this.tumble],
        tumbleRate: [...this.tumbleRate],
        acroAttitude: [...this.acroAttitude],
        lastImpact: this.lastImpact,
      },
    };
  }
  restore(snapshot: any): void {
    if (!snapshot || snapshot.version !== "sim-v1")
      throw new Error("Unsupported simulation snapshot.");
    if (!sameConfig(snapshot.config, this.config))
      throw new Error(
        "Snapshot configuration does not match this environment.",
      );
    this.world?.free();
    this.world = RAPIER.World.restoreSnapshot(new Uint8Array(snapshot.rapier));
    const bodies = this.world.bodies;
    let found: RAPIER.RigidBody | undefined;
    bodies.forEach((b) => {
      if (b.isDynamic()) found ??= b;
    });
    if (!found) throw new Error("Snapshot has no drone body.");
    this.drone = found;
    this.initialized = true;
    this.scenario = snapshot.scenario;
    this.rebuildContactMetadata();
    this.rng.restore(snapshot.rng);
    this.motor = [...snapshot.motor];
    this.prior = copyAction(snapshot.prior);
    this.queue = snapshot.queue.map(copyObservation);
    this.delivered = copyObservation(snapshot.delivered);
    this.activeContacts = new Set(snapshot.activeContacts);
    this.previousPosition = [...snapshot.previousPosition] as V3;
    this.tick = snapshot.tick;
    this.decision = snapshot.decision;
    this.targetIndex = snapshot.targetIndex;
    this.collisions = snapshot.collisions;
    this.stopped = snapshot.stopped;
    this.terminated = snapshot.terminated;
    this.truncated = snapshot.truncated;
    this.reason = snapshot.reason;
    this.wasOutOfBounds = snapshot.wasOutOfBounds;
    this.energy = snapshot.energy;
    this.yaw = snapshot.yaw;
    this.lastDistance = snapshot.lastDistance;
    this.settledTicks = snapshot.settledTicks;
    this.lastArcadeImpactTick = snapshot.lastArcadeImpactTick ?? -Infinity;
    const a = snapshot.arcade ?? {};
    this.lastPulse = a.lastPulse;
    this.burstTicks = a.burstTicks ?? 0;
    this.tilt = [...(a.tilt ?? [0, 0, 0])] as V3;
    this.tumble = [...(a.tumble ?? [0, 0, 0])] as V3;
    this.tumbleRate = [...(a.tumbleRate ?? [0, 0, 0])] as V3;
    this.acroAttitude = [...(a.acroAttitude ?? [0, 0, 0, 1])] as Quat;
    this.lastImpact = a.lastImpact;
  }
  stop(reason = "stopped"): void {
    this.stopped = true;
    this.truncated = true;
    this.reason = reason;
  }
  dispose(): void {
    if (this.initialized) this.world.free();
    this.initialized = false;
  }
}

function assertAction(a: Action): void {
  const vector =
    a && (a as Action).kind === "nav"
      ? (a as Action & { velocity: unknown }).velocity
      : a && (a as Action).kind === "rate"
        ? (a as Action & { rates: unknown }).rates
        : undefined;
  if (
    !a ||
    (a.kind !== "nav" && a.kind !== "rate") ||
    !Array.isArray(vector) ||
    vector.length !== 3 ||
    !vector.every(Number.isFinite)
  )
    throw new Error("Action must contain three finite values.");
  const scalar = a.kind === "nav" ? a.yawRate : a.thrust;
  if (!Number.isFinite(scalar))
    throw new Error("Action scalar must be finite.");
}
function boundedAction(a: Action, navigationLimit = NAV_LIMIT, yawLimit = YAW_LIMIT): Action {
  if (a.kind === "rate")
    return {
      kind: "rate",
      rates: a.rates.map((v) => clamp(v, -1, 1)) as V3,
      thrust: clamp(a.thrust, 0, 1),
      ...boundedImpulse(a),
    };
  return {
    kind: "nav",
    velocity: a.velocity.map((v) => clamp(v, -navigationLimit, navigationLimit)) as V3,
    yawRate: clamp(a.yawRate, -yawLimit, yawLimit),
    ...boundedImpulse(a),
  };
}
function boundedImpulse(a: Action): Pick<Action, "impulse" | "pulse"> {
  return a.impulse && a.pulse !== undefined
    ? { impulse: clampV(a.impulse, MAX_ACTION_IMPULSE), pulse: a.pulse }
    : {};
}
function copyObservation(o: Observation): Observation {
  return {
    ...o,
    position: [...o.position] as V3,
    velocity: [...o.velocity] as V3,
    quaternion: [...o.quaternion] as Quat,
    angularVelocity: [...o.angularVelocity] as V3,
    relativeTarget: [...o.relativeTarget] as V3,
    range: [...o.range],
    priorAction: copyAction(o.priorAction),
  };
}
