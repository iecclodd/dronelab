/**
 * Renderer-free DroneLab dynamics.  Coordinates are right handed ENU: x east,
 * y north, z up.  The airframe uses the FLU body convention: x forward, y
 * left, z up.  Quaternions are [x, y, z, w].
 */
import RAPIER from '@dimforge/rapier3d-compat';
import {
  ACTION_REPEAT, DEFAULT_CONFIG, NAV_LIMIT, YAW_LIMIT, ZERO_ACTION,
  type Action, type Observation, type PhysicalState, type RewardComponents,
  type Scenario, type SimConfig, type StepResult, type Transition, type V3,
} from '../contracts/index.ts';

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
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a: V3) => Math.hypot(...a);
const unit = (a: V3): V3 => { const n = length(a); return n > 1e-9 ? mul(a, 1 / n) : [0, 0, 0]; };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const clampV = (v: V3, max: number): V3 => { const n = length(v); return n > max ? mul(v, max / n) : v; };

/** Converts ENU coordinates to the conventional Three.js visual coordinates. */
export const enuToThreePosition = ([x, y, z]: V3): V3 => [x, z, -y];
/** Applies the same basis conversion to an ENU quaternion (x,y,z,w). */
export const enuToThreeQuaternion = ([x, y, z, w]: Quat): Quat => [x, z, -y, w];

class Rng {
  constructor(private state: number) { this.state ||= 0x6d2b79f5; }
  next(): number { let x = this.state | 0; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.state = x | 0; return (x >>> 0) / 4294967296; }
  signed(): number { return this.next() * 2 - 1; }
  snapshot(): number { return this.state; }
  restore(state: number): void { this.state = state | 0; }
}

function scenarioFor(config: SimConfig, rng: Rng): Scenario {
  const jitter = (): number => rng.signed() * 0.25;
  if (config.scenario === 'gates') return {
    id: 'gates', name: 'Gate course', description: 'Follow the safe, ordered gates.', spawn: [jitter(), jitter(), 1.5],
    targets: [[0, 5, 2], [2.5, 9, 2.4], [-1.5, 13, 1.8]], pad: [-1.5, 13, 0],
    obstacles: [[0, 5, 2], [2.5, 9, 2.4], [-1.5, 13, 1.8]].map((p, i) => ({ id: `gate-${i}`, position: p as V3, size: [2.6, .22, 2.6] as V3, kind: 'gate' })),
  };
  if (config.scenario === 'landing') return { id: 'landing', name: 'Landing pad', description: 'Descend gently onto the pad.', spawn: [jitter(), -3 + jitter(), 2.2], targets: [[0, 0, .16]], pad: [0, 0, 0], obstacles: [] };
  if (config.scenario === 'free') return { id: 'free', name: 'Free flight', description: 'Fly freely inside the test range.', spawn: [jitter(), jitter(), 1.5], targets: [[0, 8, 2]], pad: [0, 0, 0], obstacles: [] };
  return { id: 'hover', name: 'Hover target', description: 'Reach and hold the illuminated target.', spawn: [jitter(), jitter(), 1.2], targets: [[0, 0, 2]], pad: [0, 0, 0], obstacles: [] };
}

export function makeScenario(config: SimConfig): Scenario { return scenarioFor({ ...DEFAULT_CONFIG, ...config }, new Rng(config.seed)); }

const ARMS: V3[] = [[.19, .19, 0], [.19, -.19, 0], [-.19, -.19, 0], [-.19, .19, 0]];
const SPIN = [1, -1, 1, -1];
const MASS = 1;
const MAX_THRUST = 5.8;
const MOTOR_TAU = .045;
const YAW_COEFF = .04;

function rotate(q: Quat, v: V3): V3 {
  const [x, y, z, w] = q; const uv = cross([x, y, z], v); const uuv = cross([x, y, z], uv);
  return add(v, add(mul(uv, 2 * w), mul(uuv, 2)));
}
function qFromBodyAxes(x: V3, y: V3, z: V3): Quat {
  const m00 = x[0], m01 = y[0], m02 = z[0], m10 = x[1], m11 = y[1], m12 = z[1], m20 = x[2], m21 = y[2], m22 = z[2];
  const trace = m00 + m11 + m22;
  let q: Quat;
  if (trace > 0) { const s = Math.sqrt(trace + 1) * 2; q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, .25 * s]; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; q = [.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; q = [(m01 + m10) / s, .25 * s, (m12 + m21) / s, (m02 - m20) / s]; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; q = [(m02 + m20) / s, (m12 + m21) / s, .25 * s, (m10 - m01) / s]; }
  return q;
}
function qErrorVector(current: Quat, wanted: Quat): V3 {
  const [x, y, z, w] = current; const [X, Y, Z, W] = wanted;
  // wanted * inverse(current), choosing shortest representation.
  const q: Quat = [X * w - W * x - Y * z + Z * y, Y * w - W * y - Z * x + X * z, Z * w - W * z - X * y, W * w + X * x + Y * y + Z * z];
  const sign = q[3] < 0 ? -1 : 1; return [2 * sign * q[0], 2 * sign * q[1], 2 * sign * q[2]];
}

function copyAction(a: Action): Action { return a.kind === 'nav' ? { kind: 'nav', velocity: [...a.velocity] as V3, yawRate: a.yawRate } : { kind: 'rate', rates: [...a.rates] as V3, thrust: a.thrust }; }

export class DroneEnvironment {
  readonly config: SimConfig;
  scenario: Scenario;
  private world!: RAPIER.World;
  private drone!: RAPIER.RigidBody;
  private rng: Rng;
  private motor = [0, 0, 0, 0];
  private prior: Action = copyAction(ZERO_ACTION);
  private queue: Observation[] = [];
  private tick = 0; private decision = 0; private targetIndex = 0; private collisions = 0;
  private stopped = false; private terminated = false; private truncated = false; private reason = '';
  private energy = 0; private yaw = 0; private lastDistance = 0; private settledTicks = 0;
  private initialized = false;

  constructor(config: SimConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config, wind: [...(config.wind ?? DEFAULT_CONFIG.wind)] as V3 };
    this.rng = new Rng(this.config.seed); this.scenario = scenarioFor(this.config, this.rng);
  }

  private ensure(): void {
    if (this.initialized) return;
    if (!rapierReady) throw new Error('Call and await initPhysics() before constructing a simulation world.');
    this.buildWorld(); this.initialized = true;
  }
  private buildWorld(): void {
    this.world?.free();
    this.world = new RAPIER.World({ x: 0, y: 0, z: -9.81 });
    const ground = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, -.15));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(30, 30, .15).setFriction(.9), ground);
    for (const obstacle of this.scenario.obstacles.filter(o => o.kind === 'box')) {
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(...obstacle.position));
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(...obstacle.size.map(x => x / 2) as [number, number, number]), body);
    }
    this.drone = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(...this.scenario.spawn).setLinearDamping(.42).setAngularDamping(1.1));
    this.drone.setAdditionalMass(MASS - .02, true);
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(.16, .16, .06).setDensity(.02).setRestitution(.05).setFriction(.45), this.drone);
  }
  reset(seed = this.config.seed): Observation {
    this.rng = new Rng(seed); this.scenario = scenarioFor({ ...this.config, seed }, this.rng);
    this.tick = this.decision = this.targetIndex = this.collisions = this.energy = this.yaw = this.settledTicks = 0;
    this.motor = [0, 0, 0, 0]; this.prior = copyAction(ZERO_ACTION); this.queue = []; this.stopped = this.terminated = this.truncated = false; this.reason = '';
    this.lastDistance = length(sub(this.target(), this.scenario.spawn)); this.initialized = false; this.ensure();
    const observation = this.sampleObservation(); this.queue.push(observation); return observation;
  }
  private target(): V3 { return this.scenario.targets[Math.min(this.targetIndex, this.scenario.targets.length - 1)]!; }
  private rawState(): PhysicalState {
    this.ensure(); const p = this.drone.translation(), v = this.drone.linvel(), q = this.drone.rotation(), w = this.drone.angvel();
    return { step: this.tick, time: this.tick * this.config.dt, position: [p.x, p.y, p.z], velocity: [v.x, v.y, v.z], quaternion: [q.x, q.y, q.z, q.w], angularVelocity: [w.x, w.y, w.z], motors: [...this.motor], battery: clamp(1 - this.energy / 1200, 0, 1), energy: this.energy, target: [...this.target()], targetIndex: this.targetIndex, collisions: this.collisions, terminated: this.terminated, truncated: this.truncated, reason: this.reason };
  }
  state(): PhysicalState { return this.rawState(); }
  private ranges(p: V3): number[] {
    const max = 10; const dirs: V3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    return dirs.map(d => {
      let hit = d[2] < 0 ? p[2] : max;
      for (const o of this.scenario.obstacles) {
        const rel = sub(o.position, p); const forward = dot(rel, d);
        if (forward <= 0 || forward >= hit) continue;
        const lateral = length(sub(rel, mul(d, forward))); if (lateral < Math.max(o.size[0], o.size[1], o.size[2]) / 2) hit = forward;
      }
      return clamp(hit, 0, max) / max;
    });
  }
  private sampleObservation(): Observation {
    const s = this.rawState(); const n = this.config.noise;
    const noisy = (v: number, scale: number) => v + this.rng.signed() * n * scale;
    const relative = sub(s.target, s.position).map(v => noisy(v, .04)) as V3;
    return { version: 'state-v1', sourceStep: s.step, deliveryStep: s.step + this.config.delaySteps, sampleTime: s.time, deliveryTime: (s.step + this.config.delaySteps) * this.config.dt, position: s.position.map(v => noisy(v, .02)) as V3, velocity: s.velocity.map(v => noisy(v, .025)) as V3, quaternion: [...s.quaternion], angularVelocity: s.angularVelocity.map(v => noisy(v, .02)) as V3, relativeTarget: relative, range: this.ranges(s.position).map(v => clamp(noisy(v, .01), 0, 1)), battery: s.battery, priorAction: copyAction(this.prior), elapsed: s.time };
  }
  observe(): Observation {
    this.ensure(); const due = this.queue.filter(o => o.deliveryStep <= this.tick); return copyObservation(due.length ? due[due.length - 1]! : this.queue[0] ?? this.sampleObservation());
  }
  private controller(action: Action): number[] {
    const s = this.rawState(); const q = s.quaternion as Quat; const bodyZ = rotate(q, [0, 0, 1]); const rates = s.angularVelocity;
    let thrust = 0; let wantedRates: V3 = [0, 0, 0];
    if (action.kind === 'rate') { thrust = clamp(action.thrust, 0, 1) * 4 * MAX_THRUST; wantedRates = action.rates.map(v => clamp(v, -1, 1) * 4) as V3; }
    else {
      const desiredVelocity = clampV(action.velocity, NAV_LIMIT); const velError = sub(desiredVelocity, s.velocity);
      const desiredAccel = clampV(add(mul(velError, 4.2), mul(sub(s.target, s.position), .16)), 6);
      const force = add([this.config.wind[0] * .14, this.config.wind[1] * .14, MASS * 9.81], mul(desiredAccel, MASS));
      const wantedZ = unit(force); const yaw = this.yaw; const heading: V3 = [Math.cos(yaw), Math.sin(yaw), 0];
      const wantedY = unit(cross(wantedZ, heading)); const wantedX = unit(cross(wantedY, wantedZ));
      const wanted = qFromBodyAxes(wantedX, wantedY, wantedZ); const attitude = qErrorVector(q, wanted);
      wantedRates = clampV(add(mul(attitude, 1.7), [0, 0, clamp(action.yawRate, -YAW_LIMIT, YAW_LIMIT)]) as V3, 2.5);
      thrust = clamp(dot(force, bodyZ), 0, 4 * MAX_THRUST);
    }
    // The chassis has a deliberately small inertia. Conservative rate gains
    // keep motor saturation from turning an attitude correction into a flip.
    const rateError = sub(wantedRates, rates); const torque = [rateError[0] * .004, rateError[1] * .004, rateError[2] * .0008] as V3;
    const a = ARMS[0]![0], c = YAW_COEFF;
    const f = [thrust / 4 + torque[0] / (4 * a) - torque[1] / (4 * a) + torque[2] / (4 * c), thrust / 4 - torque[0] / (4 * a) - torque[1] / (4 * a) - torque[2] / (4 * c), thrust / 4 - torque[0] / (4 * a) + torque[1] / (4 * a) + torque[2] / (4 * c), thrust / 4 + torque[0] / (4 * a) + torque[1] / (4 * a) - torque[2] / (4 * c)];
    // Preserve the requested collective as far as possible when saturation occurs.
    const peak = Math.max(...f); const floor = Math.min(...f); const offset = peak > MAX_THRUST ? MAX_THRUST - peak : floor < 0 ? -floor : 0;
    return f.map(v => clamp((v + offset) / MAX_THRUST, 0, 1));
  }
  private tickOnce(requested: Action): RewardComponents {
    const dt = this.config.dt; const targetMotor = this.controller(requested);
    this.motor = this.motor.map((m, i) => m + (targetMotor[i]! - m) * clamp(dt / MOTOR_TAU, 0, 1));
    const s = this.rawState(); const q = s.quaternion as Quat;
    // External forces persist in Rapier until explicitly cleared. Evaluate
    // rotor lift, drag and wind anew every fixed tick.
    this.drone.resetForces(true); this.drone.resetTorques(true);
    let yawTorque = 0;
    ARMS.forEach((arm, i) => { const force = this.motor[i]! * MAX_THRUST; const point = add(s.position, rotate(q, arm)); const lift = mul(rotate(q, [0, 0, 1]), force); this.drone.addForceAtPoint({ x: lift[0], y: lift[1], z: lift[2] }, { x: point[0], y: point[1], z: point[2] }, true); yawTorque += SPIN[i]! * force * YAW_COEFF; });
    this.drone.addForce({ x: -s.velocity[0] * .16 + this.config.wind[0] * .10, y: -s.velocity[1] * .16 + this.config.wind[1] * .10, z: -s.velocity[2] * .10 }, true);
    this.drone.addTorque({ x: -s.angularVelocity[0] * .015, y: -s.angularVelocity[1] * .015, z: yawTorque - s.angularVelocity[2] * .018 }, true);
    this.world.timestep = dt; this.world.step(); this.tick++; this.yaw += (requested.kind === 'nav' ? requested.yawRate : requested.rates[2] * 1.5) * dt;
    this.energy += this.motor.reduce((sum, m) => sum + m * m, 0) * dt;
    const next = this.rawState(); const d = length(sub(next.target, next.position)); const progress = clamp((this.lastDistance - d) * .7, -1, 1); this.lastDistance = d;
    let collision = 0; if (next.position[2] < .09) { this.collisions++; collision = -1; if (length(next.velocity) > 2.5) { this.terminated = true; this.reason = 'collision'; } }
    let success = 0;
    const gate = this.config.scenario === 'gates'; const gentle = length(next.velocity) < (gate ? 1.4 : 1.1); const arrivalRadius = this.config.scenario === 'landing' ? .32 : gate ? 1.2 : .48;
    if (this.config.scenario === 'free') { /* free flight is only time bounded */ }
    else if (d < arrivalRadius && gentle) { this.settledTicks++; if (this.settledTicks >= 20) { if (this.targetIndex + 1 < this.scenario.targets.length) { this.targetIndex++; this.settledTicks = 0; this.lastDistance = length(sub(this.target(), next.position)); } else { this.terminated = true; this.reason = 'success'; success = 10; } } }
    else this.settledTicks = 0;
    if (this.tick * dt >= this.config.maxSeconds) { this.truncated = true; this.reason ||= 'timeout'; }
    const tracking = -Math.min(d, 8) * .04, energy = -this.motor.reduce((x, m) => x + m * m, 0) * .003;
    const total = tracking + progress + energy + collision + success;
    this.prior = copyAction(requested); this.queue.push(this.sampleObservation()); if (this.queue.length > Math.max(32, this.config.delaySteps + 4)) this.queue.shift();
    return { tracking, progress, energy, collision, success, total };
  }
  step(action: Action, ticks = ACTION_REPEAT): StepResult {
    this.ensure(); const requested = sanitize(action); const start = this.tick; const observation = this.observe(); const total: RewardComponents = { tracking: 0, progress: 0, energy: 0, collision: 0, success: 0, total: 0 };
    const applied = copyAction(requested); let actual = 0;
    if (!this.terminated && !this.truncated && !this.stopped) for (let i = 0; i < Math.max(1, Math.floor(ticks)); i++) { const c = this.tickOnce(requested); (Object.keys(total) as (keyof RewardComponents)[]).forEach(k => { total[k] += c[k]; }); actual++; if (this.terminated || this.truncated) break; }
    const next = this.observe(); const state = this.rawState(); const transition: Transition = { observation, requestedAction: requested, appliedAction: applied, nextObservation: next, reward: total.total, components: total, state, startStep: start, endStep: this.tick, ticks: actual, decision: this.decision++, terminated: state.terminated, truncated: state.truncated, reason: state.reason, wallTime: 0, validThroughStep: this.tick };
    return { observation: next, state, transition };
  }
  scriptedAction(observation: Observation = this.observe()): Action {
    // This intentionally consumes the policy-visible observation, not ground truth.
    const vel = clampV(add(mul(observation.relativeTarget, .7), mul(observation.velocity, -.9)), NAV_LIMIT);
    return { kind: 'nav', velocity: vel, yawRate: 0 };
  }
  randomAction(): Action { return { kind: 'nav', velocity: [this.rng.signed() * NAV_LIMIT, this.rng.signed() * NAV_LIMIT, this.rng.signed() * NAV_LIMIT], yawRate: this.rng.signed() * YAW_LIMIT }; }
  snapshot(): any {
    this.ensure(); return { version: 'sim-v1', config: this.config, scenario: this.scenario, rapier: Array.from(this.world.takeSnapshot()), rng: this.rng.snapshot(), motor: [...this.motor], prior: copyAction(this.prior), queue: this.queue.map(copyObservation), tick: this.tick, decision: this.decision, targetIndex: this.targetIndex, collisions: this.collisions, stopped: this.stopped, terminated: this.terminated, truncated: this.truncated, reason: this.reason, energy: this.energy, yaw: this.yaw, lastDistance: this.lastDistance, settledTicks: this.settledTicks };
  }
  restore(snapshot: any): void {
    if (!snapshot || snapshot.version !== 'sim-v1') throw new Error('Unsupported simulation snapshot.');
    this.world?.free(); this.world = RAPIER.World.restoreSnapshot(new Uint8Array(snapshot.rapier)); const bodies = this.world.bodies; let found: RAPIER.RigidBody | undefined;
    bodies.forEach(b => { if (b.isDynamic()) found ??= b; }); if (!found) throw new Error('Snapshot has no drone body.'); this.drone = found; this.initialized = true;
    this.scenario = snapshot.scenario; this.rng.restore(snapshot.rng); this.motor = [...snapshot.motor]; this.prior = copyAction(snapshot.prior); this.queue = snapshot.queue.map(copyObservation); this.tick = snapshot.tick; this.decision = snapshot.decision; this.targetIndex = snapshot.targetIndex; this.collisions = snapshot.collisions; this.stopped = snapshot.stopped; this.terminated = snapshot.terminated; this.truncated = snapshot.truncated; this.reason = snapshot.reason; this.energy = snapshot.energy; this.yaw = snapshot.yaw; this.lastDistance = snapshot.lastDistance; this.settledTicks = snapshot.settledTicks;
  }
  stop(reason = 'stopped'): void { this.stopped = true; this.reason = reason; }
  dispose(): void { if (this.initialized) this.world.free(); this.initialized = false; }
}

function sanitize(a: Action): Action {
  if (a.kind === 'rate') return { kind: 'rate', rates: a.rates.map(v => clamp(Number.isFinite(v) ? v : 0, -1, 1)) as V3, thrust: clamp(Number.isFinite(a.thrust) ? a.thrust : 0, 0, 1) };
  return { kind: 'nav', velocity: a.velocity.map(v => clamp(Number.isFinite(v) ? v : 0, -NAV_LIMIT, NAV_LIMIT)) as V3, yawRate: clamp(Number.isFinite(a.yawRate) ? a.yawRate : 0, -YAW_LIMIT, YAW_LIMIT) };
}
function copyObservation(o: Observation): Observation { return { ...o, position: [...o.position] as V3, velocity: [...o.velocity] as V3, quaternion: [...o.quaternion] as Quat, angularVelocity: [...o.angularVelocity] as V3, relativeTarget: [...o.relativeTarget] as V3, range: [...o.range], priorAction: copyAction(o.priorAction) }; }
