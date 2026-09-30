import {
  hashValue,
  NAV_LIMIT,
  YAW_LIMIT,
  validateAction,
  validateConfig,
  type Action,
  type Observation,
  type PhysicalState,
  type RunRecord,
  type SimConfig,
  type Transition,
  type V3,
} from "../contracts/index.ts";
import { strToU8, zipSync } from "fflate";

/** Dataset seed ranges are intentionally disjoint so a whole episode has one role. */
export type DatasetSplit = "train" | "validation" | "test";
export type CurriculumCounts = Record<DatasetSplit, number>;
export type ResearchSimConfig = Omit<SimConfig, "flightFeel"> & {
  flightFeel: "research";
};

export interface CurriculumEpisode {
  split: DatasetSplit;
  config: ResearchSimConfig;
}

export interface BehaviorCloningEligibility {
  eligible: boolean;
  reasons: string[];
}

export interface DatasetSource {
  id: string;
  createdAt: string;
  split: DatasetSplit;
  seed: number;
  scenario: SimConfig["scenario"];
  controller: RunRecord["controller"];
  transitionCount: number;
  configHash: string;
  randomization: Pick<SimConfig, "wind" | "noise" | "delaySteps">;
  runSchema: unknown;
  batchId?: string;
  importedFrom?: { sourceRunId: string; name: string; url: string; license: string };
}

export interface DatasetManifest {
  schema: "dronelab-dataset-v1";
  batchId: string;
  exportedAt: string;
  splitPolicy: "whole-episode seed ranges: train 1-19999, validation 20000-29999, test 30000-39999";
  splits: Record<DatasetSplit, { episodes: number; transitions: number; seeds: number[] }>;
  sources: DatasetSource[];
}

export interface DatasetExport {
  fileName: string;
  zip: Uint8Array;
  manifest: DatasetManifest;
}

export const DATASET_IMPORT_LIMITS = {
  maxFileBytes: 25 * 1024 * 1024,
  maxEpisodes: 32,
  maxTransitions: 100_000,
} as const;

export interface DroneLabDatasetExchange {
  schema: "dronelab-exchange-v1";
  source: { name: string; url: string; license: string };
  units: {
    position: "m";
    velocity: "m/s";
    angularVelocity: "rad/s";
    time: "s";
    yawRate: "rad/s";
  };
  frame: "ENU";
  observation: "state-v1";
  action: "nav-v1";
  episodes: RunRecord[];
}

const DEFAULT_COUNTS: CurriculumCounts = { train: 12, validation: 4, test: 8 };
const SEED_START: Record<DatasetSplit, number> = {
  train: 1000,
  validation: 20000,
  test: 30000,
};

export function splitForSeed(seed: number): DatasetSplit | undefined {
  if (!Number.isInteger(seed)) return undefined;
  if (seed >= 1 && seed < 20000) return "train";
  if (seed >= 20000 && seed < 30000) return "validation";
  if (seed >= 30000 && seed < 40000) return "test";
  return undefined;
}

function assertResearchConfig(base: SimConfig): void {
  if (base.flightFeel === "arcade")
    throw new Error("Autonomous curriculum requires research flight dynamics");
  if (!Number.isFinite(base.dt) || base.dt <= 0)
    throw new Error("Curriculum requires a positive simulation timestep");
}

function normaliseCounts(counts?: Partial<CurriculumCounts>): CurriculumCounts {
  const result = { ...DEFAULT_COUNTS, ...counts };
  for (const [split, value] of Object.entries(result)) {
    if (!Number.isInteger(value) || value < 1 || value > 32)
      throw new Error(`${split} curriculum count must be an integer from 1 to 32`);
  }
  return result;
}
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** A deterministic curriculum with gentle-to-challenging research perturbations. */
export function generateCurriculum(
  base: SimConfig,
  counts?: Partial<CurriculumCounts>,
): CurriculumEpisode[] {
  assertResearchConfig(base);
  const requested = normaliseCounts(counts);
  const output: CurriculumEpisode[] = [];
  for (const split of ["train", "validation", "test"] as const) {
    const count = requested[split];
    for (let index = 0; index < count; index++) {
      const progress = count === 1 ? 1 : index / (count - 1);
      const direction = index % 4;
      const cross = direction === 0 || direction === 3 ? 1 : -1;
      const gust = 0.12 + progress * 0.88;
      const wind: V3 = [
        base.wind[0] + cross * gust * (0.12 + (index % 3) * 0.04),
        base.wind[1] + (direction < 2 ? 1 : -1) * gust * 0.1,
        base.wind[2] + (index % 2 ? 1 : -1) * gust * 0.025,
      ];
      output.push({
        split,
        config: {
          ...base,
          flightFeel: "research",
          seed: SEED_START[split] + index,
          wind: wind.map((value) => clamp(value, -10, 10)) as V3,
          noise: clamp(base.noise + progress * 0.035, 0, 2),
          delaySteps: clamp(Math.round(base.delaySteps + progress * 3), 0, 120),
        } as ResearchSimConfig,
      });
    }
  }
  return output;
}

/** Checks that a run is a complete, research-mode navigation demonstration. */
export function assessBehaviorCloningEligibility(
  run: RunRecord,
): BehaviorCloningEligibility {
  const reasons: string[] = [];
  if (run.status !== "completed") reasons.push(`run status is ${run.status}`);
  if (run.config.flightFeel === "arcade") reasons.push("arcade dynamics are excluded");
  if (run.controller === "rate") reasons.push("rate-controller actions are excluded");
  const split = splitForSeed(run.config.seed);
  if (!split) reasons.push("seed is outside the dataset split ranges");
  const last = run.transitions.at(-1);
  if (!last || (!last.terminated && !last.truncated))
    reasons.push("episode has no terminal transition");
  if (last && /user_stop|cancelled|interrupted/i.test(last.reason))
    reasons.push(`episode ended as ${last.reason}`);
  if (!run.transitions.length) reasons.push("episode has no transitions");
  if (run.transitions.some((transition) => transition.appliedAction.kind !== "nav"))
    reasons.push("episode contains non-navigation actions");
  return { eligible: reasons.length === 0, reasons };
}

export function assertDatasetEligible(runs: RunRecord[]): void {
  if (!runs.length) throw new Error("Select at least one complete episode");
  const seeds = new Set<number>();
  for (const run of runs) {
    const eligibility = assessBehaviorCloningEligibility(run);
    if (!eligibility.eligible)
      throw new Error(`Run ${run.id} is not BC-eligible: ${eligibility.reasons.join("; ")}`);
    if (seeds.has(run.config.seed))
      throw new Error(`Duplicate episode seed prevents a leakage-safe dataset: ${run.config.seed}`);
    seeds.add(run.config.seed);
  }
  const present = new Set(runs.map((run) => splitForSeed(run.config.seed)));
  if (!present.has("train") || !present.has("validation"))
    throw new Error("Dataset requires whole train and validation episodes");
  const first = runs[0]!.config;
  if (runs.some((run) => run.config.scenario !== first.scenario || run.config.mapId !== first.mapId || run.config.dt !== first.dt))
    throw new Error("Dataset episodes must use one scenario, map, and timestep");
}

export function buildDatasetExport(
  runs: RunRecord[],
  options: { batchId?: string; exportedAt?: string } = {},
): DatasetExport {
  assertDatasetEligible(runs);
  const batchId = options.batchId ?? crypto.randomUUID();
  const exportedAt = options.exportedAt ?? new Date().toISOString();
  const groups: Record<DatasetSplit, RunRecord[]> = {
    train: [],
    validation: [],
    test: [],
  };
  for (const run of runs) groups[splitForSeed(run.config.seed)!].push(run);
  const sources = runs.map((run) => ({
    id: run.id,
    createdAt: run.createdAt,
    split: splitForSeed(run.config.seed)!,
    seed: run.config.seed,
    scenario: run.config.scenario,
    controller: run.controller,
    transitionCount: run.transitions.length,
    configHash: hashValue(run.config),
    randomization: {
      wind: [...run.config.wind] as V3,
      noise: run.config.noise,
      delaySteps: run.config.delaySteps,
    },
    runSchema: run.manifest.schema,
    batchId: typeof run.manifest.batchId === "string" ? run.manifest.batchId : undefined,
    importedFrom: importedProvenance(run.manifest.importedFrom),
  }));
  const splits = Object.fromEntries(
    (Object.keys(groups) as DatasetSplit[]).map((split) => [
      split,
      {
        episodes: groups[split].length,
        transitions: groups[split].reduce((sum, run) => sum + run.transitions.length, 0),
        seeds: groups[split].map((run) => run.config.seed),
      },
    ]),
  ) as DatasetManifest["splits"];
  const manifest: DatasetManifest = {
    schema: "dronelab-dataset-v1",
    batchId,
    exportedAt,
    splitPolicy:
      "whole-episode seed ranges: train 1-19999, validation 20000-29999, test 30000-39999",
    splits,
    sources,
  };
  const zip = zipSync({
    "manifest.json": strToU8(JSON.stringify(manifest, null, 2)),
    "exchange.json": strToU8(JSON.stringify(buildDatasetExchange(runs), null, 2)),
    ...Object.fromEntries(
      (Object.keys(groups) as DatasetSplit[]).map((split) => [
        `transitions/${split}.jsonl`,
        strToU8(
          groups[split]
            .flatMap((run) =>
              run.transitions.map((transition) =>
                JSON.stringify({ runId: run.id, seed: run.config.seed, transition }),
              ),
            )
            .join("\n"),
        ),
      ]),
    ),
  });
  return { fileName: `dronelab-dataset-${batchId.slice(0, 8)}.zip`, zip, manifest };
}

function importedProvenance(value: unknown): DatasetSource["importedFrom"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  return typeof source.sourceRunId === "string" && typeof source.name === "string" && typeof source.url === "string" && typeof source.license === "string"
    ? { sourceRunId: source.sourceRunId, name: source.name, url: source.url, license: source.license }
    : undefined;
}

/** Creates the portable JSON exchange embedded in every dataset ZIP. */
export function buildDatasetExchange(runs: RunRecord[]): DroneLabDatasetExchange {
  assertDatasetEligible(runs);
  return {
    schema: "dronelab-exchange-v1",
    source: { name: "DroneLab Flight Journal", url: "https://github.com/iecclodd/dronelab", license: "user-provided" },
    units: { position: "m", velocity: "m/s", angularVelocity: "rad/s", time: "s", yawRate: "rad/s" },
    frame: "ENU", observation: "state-v1", action: "nav-v1",
    episodes: runs.map((run) => ({
      id: run.id, createdAt: run.createdAt, status: "completed", config: safeConfig(run.config), controller: run.controller,
      manifest: { schema: "run-v1", ...(importedProvenance(run.manifest.importedFrom) ? { importedFrom: importedProvenance(run.manifest.importedFrom) } : {}) },
      transitions: structuredClone(run.transitions), metrics: structuredClone(run.metrics),
    })),
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string, maxLength = 256): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  if (value.length > maxLength) throw new Error(`${label} exceeds ${maxLength} characters`);
  return value;
}
function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}
function vector(value: unknown, size: number, label: string): number[] {
  if (!Array.isArray(value) || value.length !== size) throw new Error(`${label} must contain ${size} values`);
  return value.map((number, index) => finite(number, `${label}[${index}]`));
}
function navAction(value: unknown, label: string): Action {
  const action = validateAction(value);
  if (action.kind !== "nav" || action.impulse !== undefined)
    throw new Error(`${label} must be a plain nav-v1 action`);
  if (action.velocity.some((number) => Math.abs(number) > NAV_LIMIT) || Math.abs(action.yawRate) > YAW_LIMIT)
    throw new Error(`${label} exceeds nav-v1 action limits`);
  return { kind: "nav", velocity: [...action.velocity] as V3, yawRate: action.yawRate };
}
function safeConfig(value: unknown): SimConfig {
  const config = validateConfig(value);
  return { scenario: config.scenario, ...(config.mapId ? { mapId: config.mapId } : {}), ...(config.flightFeel ? { flightFeel: config.flightFeel } : {}), seed: config.seed, wind: [...config.wind] as V3, noise: config.noise, delaySteps: config.delaySteps, maxSeconds: config.maxSeconds, dt: config.dt };
}
function observation(value: unknown, label: string): Observation {
  const source = record(value, label);
  if (source.version !== "state-v1") throw new Error(`${label}.version must be state-v1`);
  return {
    version: "state-v1",
    sourceStep: integer(source.sourceStep, `${label}.sourceStep`),
    deliveryStep: integer(source.deliveryStep, `${label}.deliveryStep`),
    sampleTime: finite(source.sampleTime, `${label}.sampleTime`),
    deliveryTime: finite(source.deliveryTime, `${label}.deliveryTime`),
    position: vector(source.position, 3, `${label}.position`) as V3,
    velocity: vector(source.velocity, 3, `${label}.velocity`) as V3,
    quaternion: vector(source.quaternion, 4, `${label}.quaternion`) as Observation["quaternion"],
    angularVelocity: vector(source.angularVelocity, 3, `${label}.angularVelocity`) as V3,
    relativeTarget: vector(source.relativeTarget, 3, `${label}.relativeTarget`) as V3,
    range: vector(source.range, 6, `${label}.range`),
    battery: finite(source.battery, `${label}.battery`),
    priorAction: navAction(source.priorAction, `${label}.priorAction`),
    elapsed: finite(source.elapsed, `${label}.elapsed`),
  };
}
function integer(value: unknown, label: string): number {
  const number = finite(value, label);
  if (!Number.isInteger(number)) throw new Error(`${label} must be an integer`);
  return number;
}
function state(value: unknown, label: string): PhysicalState {
  const source = record(value, label);
  if (typeof source.reason !== "string") throw new Error(`${label}.reason must be a string`);
  if (typeof source.terminated !== "boolean" || typeof source.truncated !== "boolean")
    throw new Error(`${label} terminal flags must be boolean`);
  return {
    step: integer(source.step, `${label}.step`), time: finite(source.time, `${label}.time`),
    position: vector(source.position, 3, `${label}.position`) as V3,
    velocity: vector(source.velocity, 3, `${label}.velocity`) as V3,
    quaternion: vector(source.quaternion, 4, `${label}.quaternion`) as PhysicalState["quaternion"],
    angularVelocity: vector(source.angularVelocity, 3, `${label}.angularVelocity`) as V3,
    motors: vector(source.motors, 4, `${label}.motors`), battery: finite(source.battery, `${label}.battery`),
    energy: finite(source.energy, `${label}.energy`), target: vector(source.target, 3, `${label}.target`) as V3,
    targetIndex: integer(source.targetIndex, `${label}.targetIndex`), collisions: integer(source.collisions, `${label}.collisions`),
    terminated: source.terminated, truncated: source.truncated, reason: source.reason,
  };
}
function transition(value: unknown, label: string): Transition {
  const source = record(value, label), components = record(source.components, `${label}.components`);
  const startStep = integer(source.startStep, `${label}.startStep`), endStep = integer(source.endStep, `${label}.endStep`);
  const ticks = integer(source.ticks, `${label}.ticks`);
  if (endStep <= startStep || ticks <= 0 || ticks !== endStep - startStep) throw new Error(`${label} has invalid timing`);
  if (typeof source.terminated !== "boolean" || typeof source.truncated !== "boolean" || typeof source.reason !== "string")
    throw new Error(`${label} has invalid terminal metadata`);
  const total = finite(components.total, `${label}.components.total`);
  const reward = finite(source.reward, `${label}.reward`);
  if (Math.abs(reward - total) > 1e-7) throw new Error(`${label} reward must equal component total`);
  const result: Transition = {
    observation: observation(source.observation, `${label}.observation`),
    requestedAction: navAction(source.requestedAction, `${label}.requestedAction`),
    appliedAction: navAction(source.appliedAction, `${label}.appliedAction`),
    nextObservation: observation(source.nextObservation, `${label}.nextObservation`), reward,
    components: { tracking: finite(components.tracking, `${label}.components.tracking`), progress: finite(components.progress, `${label}.components.progress`), energy: finite(components.energy, `${label}.components.energy`), collision: finite(components.collision, `${label}.components.collision`), success: finite(components.success, `${label}.components.success`), total },
    state: state(source.state, `${label}.state`), startStep, endStep, ticks,
    decision: integer(source.decision, `${label}.decision`), terminated: source.terminated,
    truncated: source.truncated, reason: source.reason, wallTime: finite(source.wallTime, `${label}.wallTime`),
    validThroughStep: integer(source.validThroughStep, `${label}.validThroughStep`),
  };
  if (result.observation.sourceStep > result.observation.deliveryStep)
    throw new Error(`${label} has invalid sensor timing`);
  if (result.observation.deliveryStep !== startStep || result.nextObservation.deliveryStep !== endStep)
    throw new Error(`${label} observations must align with transition steps`);
  if (result.state.step !== endStep || result.state.terminated !== result.terminated || result.state.truncated !== result.truncated || result.state.reason !== result.reason)
    throw new Error(`${label} state terminal metadata disagrees with transition`);
  return result;
}

/**
 * Validates and sanitizes the explicit, portable DroneLab exchange JSON format.
 * Foreign layouts must be converted before import; this function never guesses units
 * or coordinate axes and intentionally drops arbitrary source manifests.
 */
export function validateDatasetExchange(
  value: unknown,
  options: { byteLength?: number } = {},
): DroneLabDatasetExchange {
  let byteLength = options.byteLength;
  if (byteLength === undefined) {
    try { byteLength = new TextEncoder().encode(JSON.stringify(value)).byteLength; }
    catch { throw new Error("Dataset must be JSON-serializable"); }
  }
  if (!Number.isSafeInteger(byteLength) || byteLength > DATASET_IMPORT_LIMITS.maxFileBytes)
    throw new Error(`Dataset exceeds the ${DATASET_IMPORT_LIMITS.maxFileBytes} byte import limit`);
  const input = record(value, "dataset");
  if (input.schema !== "dronelab-exchange-v1") throw new Error("Unsupported dataset schema");
  const source = record(input.source, "dataset.source");
  const name = string(source.name, "dataset.source.name"), url = string(source.url, "dataset.source.url", 2048), license = string(source.license, "dataset.source.license");
  try { const parsed = new URL(url); if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error(); } catch { throw new Error("dataset.source.url must be a credential-, query-, and fragment-free http(s) URL"); }
  if (input.frame !== "ENU" || input.observation !== "state-v1" || input.action !== "nav-v1")
    throw new Error("Dataset must use ENU, state-v1 observations, and nav-v1 actions");
  const units = record(input.units, "dataset.units");
  if (units.position !== "m" || units.velocity !== "m/s" || units.angularVelocity !== "rad/s" || units.time !== "s" || units.yawRate !== "rad/s")
    throw new Error("Dataset units must be meters, m/s, rad/s, and seconds");
  if (!Array.isArray(input.episodes) || input.episodes.length < 1 || input.episodes.length > DATASET_IMPORT_LIMITS.maxEpisodes)
    throw new Error(`Dataset episodes must contain 1–${DATASET_IMPORT_LIMITS.maxEpisodes} complete runs`);
  let totalTransitions = 0;
  const episodes = input.episodes.map((episode, index) => {
    const raw = record(episode, `dataset.episodes[${index}]`);
    const transitionsRaw = raw.transitions;
    if (!Array.isArray(transitionsRaw)) throw new Error(`dataset.episodes[${index}].transitions must be an array`);
    totalTransitions += transitionsRaw.length;
    if (totalTransitions > DATASET_IMPORT_LIMITS.maxTransitions) throw new Error(`Dataset exceeds ${DATASET_IMPORT_LIMITS.maxTransitions} transitions`);
    if (raw.status !== "completed") throw new Error(`dataset.episodes[${index}] status must be completed`);
    if (raw.controller === "rate") throw new Error(`dataset.episodes[${index}] uses rate-controller actions`);
    if (!(["manual", "scripted", "random", "learned"] as const).includes(raw.controller as never)) throw new Error(`dataset.episodes[${index}] has an unsupported controller`);
    if (transitionsRaw.length > 14_400) throw new Error(`dataset.episodes[${index}] exceeds the 14400 transition journal limit`);
    const transitions = transitionsRaw.map((item, transitionIndex) => transition(item, `dataset.episodes[${index}].transitions[${transitionIndex}]`));
    for (let step = 0; step < transitions.length; step++) {
      const current = transitions[step]!;
      if (current.startStep !== (step ? transitions[step - 1]!.endStep : 0)) throw new Error(`dataset.episodes[${index}] transitions must be contiguous from step 0`);
      if (step < transitions.length - 1 && (current.terminated || current.truncated)) throw new Error(`dataset.episodes[${index}] terminates before its last transition`);
    }
    const last = transitions.at(-1);
    if (!last || (!last.terminated && !last.truncated)) throw new Error(`dataset.episodes[${index}] is not complete`);
    const config = safeConfig(raw.config);
    if (config.flightFeel === "arcade") throw new Error(`dataset.episodes[${index}] uses arcade dynamics`);
    if (/user_stop|cancelled|interrupted/i.test(last.reason)) throw new Error(`dataset.episodes[${index}] ended as ${last.reason}`);
    const id = string(raw.id, `dataset.episodes[${index}].id`, 128), createdAt = string(raw.createdAt, `dataset.episodes[${index}].createdAt`, 64);
    if (Number.isNaN(Date.parse(createdAt))) throw new Error(`dataset.episodes[${index}].createdAt must be ISO time`);
    return {
      // Foreign IDs are provenance only. New IDs prevent an import overwriting journal data.
      id: crypto.randomUUID(), createdAt, status: "completed" as const, config, controller: raw.controller as RunRecord["controller"],
      manifest: { schema: "run-v1", source: `${name} (${license})`, importedFrom: { sourceRunId: id, name, url, license } }, transitions,
      metrics: {
        success: last.reason === "success", reason: last.reason, seconds: last.state.time,
        collisions: last.state.collisions, trackingError: transitions.reduce((sum, item) => sum + Math.hypot(...item.state.target.map((number, axis) => number - item.state.position[axis]!)), 0) / transitions.length, energy: last.state.energy,
        reward: transitions.reduce((sum, item) => sum + item.reward, 0), steps: last.endStep,
        wallSeconds: 0, throughput: 0,
      },
    } satisfies RunRecord;
  });
  return { schema: "dronelab-exchange-v1", source: { name, url, license }, units: { position: "m", velocity: "m/s", angularVelocity: "rad/s", time: "s", yawRate: "rad/s" }, frame: "ENU", observation: "state-v1", action: "nav-v1", episodes };
}

/** UI-facing import API: validated, sanitized runs with fresh local journal IDs. */
export function validateDatasetImport(value: unknown, options?: { byteLength?: number }): RunRecord[] {
  return validateDatasetExchange(value, options).episodes;
}
