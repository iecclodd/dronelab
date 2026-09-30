/**
 * Renderer-free DroneLab dynamics.  Coordinates are right handed ENU: x east,
 * y north, z up.  The airframe uses the FLU body convention: x forward, y
 * left, z up.  Quaternions are [x, y, z, w].
 */
import RAPIER from "@dimforge/rapier3d-compat";
import {
  ACTION_REPEAT,
  DEFAULT_CONFIG,
  NAV_LIMIT,
  YAW_LIMIT,
  ZERO_ACTION,
  type Action,
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
> = { valley: FREE_WORLD, pizzeria: PIZZERIA_WORLD };

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
    targets: [mapId === "pizzeria" ? [8, 0, 2] : [70, 0, 8]],
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
const ARCADE_OUTDOOR_NAV_LIMIT = 30;
const ARCADE_INDOOR_NAV_LIMIT = 16;
const ARCADE_VELOCITY_LIMIT = 36;
const ARCADE_BOUNCE_MIN_SPEED_MS = 2.25;
const ARCADE_BOUNCE_COOLDOWN_TICKS = 30;

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

function copyAction(a: Action): Action {
  return a.kind === "nav"
    ? { kind: "nav", velocity: [...a.velocity] as V3, yawRate: a.yawRate }
    : { kind: "rate", rates: [...a.rates] as V3, thrust: a.thrust };
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
    }
    this.drone = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(...this.scenario.spawn)
        .setLinearDamping(this.arcadeFreeFlight() ? 0.18 : 0.42)
        .setAngularDamping(this.arcadeFreeFlight() ? 0.62 : 1.1)
        // CCD protects the fast arcade profile from passing through thin map
        // geometry between fixed simulation steps.
        .setCcdEnabled(this.arcadeFreeFlight())
        .setAdditionalMassProperties(
          MASS,
          { x: 0, y: 0, z: 0 },
          { x: 0.025, y: 0.025, z: 0.045 },
          { x: 0, y: 0, z: 0, w: 1 },
        ),
    );
    this.droneCollider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.16, 0.16, 0.06)
        .setDensity(0)
        .setRestitution(this.arcadeFreeFlight() ? 0.58 : 0.05)
        .setFriction(0.45),
      this.drone,
    );
  }
  private rebuildContactMetadata(): void {
    this.contactTags.clear();
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
      } else this.contactTags.set(collider.handle, "obstacle");
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
  private tickOnce(requested: Action): RewardComponents {
    const dt = this.config.dt;
    const targetMotor = this.controller(requested);
    this.motor = this.motor.map(
      (m, i) =>
        m +
        (targetMotor[i]! - m) *
          clamp(dt / (this.arcadeFreeFlight() ? 0.025 : MOTOR_TAU), 0, 1),
    );
    const s = this.rawState();
    const q = s.quaternion as Quat;
    const bodyZ = rotate(q, [0, 0, 1]);
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
    this.world.timestep = dt;
    this.world.step();
    if (this.arcadeFreeFlight()) {
      const v = this.drone.linvel();
      const limited = clampV([v.x, v.y, v.z], ARCADE_VELOCITY_LIMIT);
      this.drone.setLinvel({ x: limited[0], y: limited[1], z: limited[2] }, true);
    }
    this.tick++;
    if (requested.kind === "nav") this.yaw += requested.yawRate * dt;
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
    const crash = this.arcadeFreeFlight()
      ? energeticArcadeImpact && arcadeImpactReady
      : collisionContact;
    if (crash) {
      this.collisions++;
      collision = -1;
      if (this.arcadeFreeFlight()) {
        this.lastArcadeImpactTick = this.tick;
        // The wall kick is intentionally playful. Ground rebounds only retain
        // a fraction of the incoming vertical speed, so a zero-thrust drone
        // settles instead of receiving a perpetual minimum upward launch.
        const rebound = hitGround && !hitObstacle
          ? [s.velocity[0] * 0.7, s.velocity[1] * 0.7, Math.abs(s.velocity[2]) * 0.45] as V3
          : clampV(
              [
                -s.velocity[0] * 0.38,
                -s.velocity[1] * 0.38,
                Math.max(1.5, Math.abs(s.velocity[2]) * 0.45, impactSpeed * 0.18),
              ],
              15,
            );
        this.drone.setLinvel(
          { x: rebound[0], y: rebound[1], z: rebound[2] },
          true,
        );
        next = this.rawState();
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
    if (outOfBounds && !this.wasOutOfBounds) {
      this.collisions++;
      collision = -1;
      this.terminated = true;
      this.reason = "out_of_bounds";
    }
    this.wasOutOfBounds = outOfBounds;
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
    const applied = boundedAction(action, this.navigationLimit());
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
function boundedAction(a: Action, navigationLimit = NAV_LIMIT): Action {
  if (a.kind === "rate")
    return {
      kind: "rate",
      rates: a.rates.map((v) => clamp(v, -1, 1)) as V3,
      thrust: clamp(a.thrust, 0, 1),
    };
  return {
    kind: "nav",
    velocity: a.velocity.map((v) => clamp(v, -navigationLimit, navigationLimit)) as V3,
    yawRate: clamp(a.yawRate, -YAW_LIMIT, YAW_LIMIT),
  };
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
