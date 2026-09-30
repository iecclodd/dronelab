export const VERSION = "dronelab-0.1.0";
export const DT = 1 / 120;
export const ACTION_REPEAT = 4;
export type V3 = [number, number, number];
export type Q4 = [number, number, number, number];
export type ScenarioId = "hover" | "gates" | "landing" | "free";
/**
 * Research keeps the reproducible mission dynamics. Arcade is opt-in and is
 * only interpreted by the free-flight simulator.
 */
export type FlightFeel = "research" | "arcade";
export type ControllerId =
  | "manual"
  | "rate"
  | "scripted"
  | "random"
  | "learned";
/**
 * Optional one-shot velocity kick (m/s) for the arcade profile: dashes,
 * explosion knockback and recoil. `pulse` identifies it so a held command
 * applies the kick exactly once. Research dynamics ignore both fields.
 */
export interface ActionImpulse { impulse?: V3; pulse?: number }
export type Action =
  | ({ kind: "nav"; velocity: V3; yawRate: number } & ActionImpulse)
  | ({ kind: "rate"; rates: V3; thrust: number } & ActionImpulse);
export const MAX_ACTION_IMPULSE = 40;
export const ZERO_ACTION: Action = {
  kind: "nav",
  velocity: [0, 0, 0],
  yawRate: 0,
};
export interface SimConfig {
  scenario: ScenarioId;
  /** Free-flight map selection. Omitted configurations use Aster Valley. */
  mapId?: "valley" | "pizzeria" | "city";
  /** Omitted historical configs retain the reproducible research dynamics. */
  flightFeel?: FlightFeel;
  seed: number;
  wind: V3;
  noise: number;
  delaySteps: number;
  maxSeconds: number;
  dt: number;
}
export const DEFAULT_CONFIG: SimConfig = {
  scenario: "hover",
  flightFeel: "research",
  seed: 42,
  wind: [0, 0, 0],
  noise: 0,
  delaySteps: 0,
  maxSeconds: 30,
  dt: DT,
};
export interface Obstacle {
  id: string;
  position: V3;
  size: V3;
  kind: "box" | "gate";
}
export interface Scenario {
  id: ScenarioId;
  /** Free-flight map selection, preserved in snapshots and consumed by the UI. */
  mapId?: "valley" | "pizzeria" | "city";
  name: string;
  description: string;
  spawn: V3;
  targets: V3[];
  obstacles: Obstacle[];
  pad: V3;
}
export interface PhysicalState {
  step: number;
  time: number;
  position: V3;
  velocity: V3;
  quaternion: Q4;
  angularVelocity: V3;
  motors: number[];
  battery: number;
  energy: number;
  target: V3;
  targetIndex: number;
  collisions: number;
  terminated: boolean;
  truncated: boolean;
  reason: string;
  /** Arcade only: the latest energetic bounce, for presentation effects. */
  impact?: { step: number; speed: number; normal: V3 };
}
export interface Observation {
  version: "state-v1";
  sourceStep: number;
  deliveryStep: number;
  sampleTime: number;
  deliveryTime: number;
  position: V3;
  velocity: V3;
  quaternion: Q4;
  angularVelocity: V3;
  relativeTarget: V3;
  range: number[];
  battery: number;
  priorAction: Action;
  elapsed: number;
}
export interface RewardComponents {
  tracking: number;
  progress: number;
  energy: number;
  collision: number;
  success: number;
  total: number;
}
export interface Transition {
  observation: Observation;
  requestedAction: Action;
  appliedAction: Action;
  nextObservation: Observation;
  reward: number;
  components: RewardComponents;
  state: PhysicalState;
  startStep: number;
  endStep: number;
  ticks: number;
  decision: number;
  terminated: boolean;
  truncated: boolean;
  reason: string;
  wallTime: number;
  validThroughStep: number;
}
export interface StepResult {
  observation: Observation;
  state: PhysicalState;
  transition: Transition;
}
export interface PolicyCheckpoint {
  version: "bc-v1";
  id: string;
  createdAt: string;
  trainingSeed: number;
  trainingSeeds: number[];
  validationSeeds: number[];
  testSeeds: number[];
  /** Exact held-out configurations and source lineage for imported/autonomous training. */
  evaluationConfigs?: SimConfig[];
  datasetSources?: { runId: string; seed: number; split: string; source: string }[];
  scenario: ScenarioId;
  config: SimConfig;
  mean: number[];
  std: number[];
  layers: { shape: number[]; data: number[] }[];
  loss: number[];
  validationLoss: number[];
  samples: number;
  epochs: number;
  parityMaxError: number;
  hash: string;
}
export interface RunMetrics {
  success: boolean;
  reason: string;
  seconds: number;
  collisions: number;
  trackingError: number;
  energy: number;
  reward: number;
  steps: number;
  wallSeconds: number;
  throughput: number;
}
export interface RunRecord {
  id: string;
  createdAt: string;
  status: "recording" | "completed" | "stopped" | "failed" | "interrupted";
  config: SimConfig;
  controller: ControllerId;
  policyId?: string;
  manifest: Record<string, unknown>;
  transitions: Transition[];
  metrics: RunMetrics;
}
export interface WorkerIdentity {
  generation: number;
  epoch: number;
  requestId: number;
  expectedStep?: number;
}
export interface WorkerRequest extends WorkerIdentity {
  type: string;
  payload?: any;
}
export interface WorkerResponse {
  type: string;
  requestId?: number;
  generation: number;
  epoch: number;
  payload?: any;
  error?: string;
}
export type ClockMode =
  | "paused"
  | "realtime"
  | "lockstep"
  | "replay"
  | "closing";
export function features(o: Observation): number[] {
  return [
    ...o.relativeTarget,
    ...o.velocity,
    ...o.quaternion,
    ...o.angularVelocity,
    ...o.range,
    o.battery,
  ];
}
export const FEATURE_COUNT = 20;
export const NAV_LIMIT = 3;
export const YAW_LIMIT = 1.5;
export function actionVector(a: Action): number[] {
  return a.kind === "nav"
    ? [...a.velocity.map((v) => v / NAV_LIMIT), a.yawRate / YAW_LIMIT]
    : [0, 0, 0, 0];
}
export function vectorAction(v: number[]): Action {
  return {
    kind: "nav",
    velocity: [0, 1, 2].map(
      (i) => Math.max(-1, Math.min(1, v[i] ?? 0)) * NAV_LIMIT,
    ) as V3,
    yawRate: Math.max(-1, Math.min(1, v[3] ?? 0)) * YAW_LIMIT,
  };
}
export function hashValue(v: unknown): string {
  const s = JSON.stringify(v);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
export function validateConfig(value: unknown): SimConfig {
  const c = value as SimConfig;
  if (
    !c ||
    !["hover", "gates", "landing", "free"].includes(c.scenario) ||
    (c.mapId !== undefined && !["valley", "pizzeria", "city"].includes(c.mapId)) ||
    (c.flightFeel !== undefined && !["research", "arcade"].includes(c.flightFeel)) ||
    !Number.isInteger(c.seed) ||
    c.seed < 0 ||
    c.seed > 0xffffffff
  )
    throw new Error("Invalid scenario or seed");
  if (
    !Array.isArray(c.wind) ||
    c.wind.length !== 3 ||
    c.wind.some((v) => !Number.isFinite(v) || Math.abs(v) > 10)
  )
    throw new Error("Wind must be three finite values within ±10 m/s");
  if (
    !Number.isFinite(c.noise) ||
    c.noise < 0 ||
    c.noise > 2 ||
    !Number.isInteger(c.delaySteps) ||
    c.delaySteps < 0 ||
    c.delaySteps > 120
  )
    throw new Error("Invalid sensor settings");
  if (
    !Number.isFinite(c.dt) ||
    c.dt < 1 / 240 ||
    c.dt > 1 / 60 ||
    !Number.isFinite(c.maxSeconds) ||
    c.maxSeconds < 0.001 ||
    c.maxSeconds > 120
  )
    throw new Error("Invalid time budget");
  return structuredClone(c);
}
export function validateAction(value: unknown): Action {
  const a = value as Action;
  if (!a || !["nav", "rate"].includes(a.kind))
    throw new Error("Invalid action contract");
  const values = a.kind === "nav" ? a.velocity : a.rates;
  if (
    !Array.isArray(values) ||
    values.length !== 3 ||
    values.some((v) => !Number.isFinite(v))
  )
    throw new Error("Action vector must contain three finite values");
  if (!Number.isFinite(a.kind === "nav" ? a.yawRate : a.thrust))
    throw new Error("Invalid action scalar");
  if (a.impulse !== undefined) {
    if (
      !Array.isArray(a.impulse) ||
      a.impulse.length !== 3 ||
      a.impulse.some((v) => !Number.isFinite(v)) ||
      Math.hypot(...a.impulse) > MAX_ACTION_IMPULSE + 1e-6
    )
      throw new Error("Invalid action impulse");
    if (!Number.isInteger(a.pulse)) throw new Error("Impulse requires an integer pulse");
  }
  return structuredClone(a);
}
