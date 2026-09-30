import {
  FEATURE_COUNT,
  NAV_LIMIT,
  YAW_LIMIT,
  hashValue,
  validateConfig,
  type Action,
  type Observation,
  type PolicyCheckpoint,
} from "../contracts/index.ts";

const validated = new WeakSet<object>();
const expectedShapes = [[20, 32], [32], [32, 32], [32], [32, 4], [4]];
const checkpointKeys = new Set([
  "version", "id", "createdAt", "trainingSeed", "trainingSeeds",
  "validationSeeds", "testSeeds", "evaluationConfigs", "datasetSources",
  "scenario", "config", "mean", "std", "layers", "loss",
  "validationLoss", "samples", "epochs", "parityMaxError", "hash",
]);
const configKeys = new Set([
  "scenario", "mapId", "flightFeel", "seed", "wind", "noise",
  "delaySteps", "maxSeconds", "dt",
]);
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function knownKeys(value: Record<string, unknown>, allowed: Set<string>, label: string): void {
  if (Object.keys(value).some((key) => !allowed.has(key)))
    throw new Error(`${label} contains unsupported fields`);
}
function boundedText(value: unknown, label: string, max: number): void {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(`${label} must be a non-empty string of at most ${max} characters`);
}
function seeds(value: unknown, label: string, minimum: number, maximum: number): number[] {
  if (!Array.isArray(value) || !value.length || value.length > 32 ||
      value.some((seed) => !Number.isSafeInteger(seed) || seed < minimum || seed > maximum) ||
      new Set(value).size !== value.length)
    throw new Error(`Invalid policy ${label}`);
  return value as number[];
}
function researchConfig(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Invalid policy ${label}`);
  knownKeys(value, configKeys, `Policy ${label}`);
  try { validateConfig(value); } catch { throw new Error(`Invalid policy ${label}`); }
  if (value.flightFeel === "arcade") throw new Error(`Policy ${label} requires research dynamics`);
}

/** Preprocessing is deliberately shared with the worker and has no TFJS dependency. */
export function normalizedFeatures(
  observation: Observation,
  mean: number[],
  std: number[],
): number[] {
  const raw = [
    ...observation.relativeTarget,
    ...observation.velocity,
    ...observation.quaternion,
    ...observation.angularVelocity,
    ...observation.range.slice(0, 6),
    observation.battery,
  ];
  if (
    raw.length !== FEATURE_COUNT ||
    mean.length !== FEATURE_COUNT ||
    std.length !== FEATURE_COUNT
  ) {
    throw new Error(
      `Expected ${FEATURE_COUNT} state features and normalization values`,
    );
  }
  return raw.map((value, i) =>
    Math.max(-5, Math.min(5, (value - mean[i]) / Math.max(std[i], 1e-3))),
  );
}

/** CPU-only forward pass for the exported Dense(20,32)-Dense(32,32)-Dense(32,4) policy. */
export function predict(
  checkpoint: PolicyCheckpoint,
  observation: Observation,
): Action {
  validateCheckpoint(checkpoint);
  let values = normalizedFeatures(observation, checkpoint.mean, checkpoint.std);
  for (let layer = 0; layer < 3; layer++) {
    const kernel = checkpoint.layers[layer * 2];
    const bias = checkpoint.layers[layer * 2 + 1];
    const [input, output] = kernel.shape;
    if (
      input !== values.length ||
      bias.shape.length !== 1 ||
      bias.shape[0] !== output
    )
      throw new Error("Invalid policy weights");
    const next = Array.from({ length: output }, (_, column) => {
      let total = bias.data[column] ?? 0;
      for (let row = 0; row < input; row++)
        total += values[row] * (kernel.data[row * output + column] ?? 0);
      return Math.tanh(total);
    });
    values = next;
  }
  return {
    kind: "nav",
    velocity: [
      values[0] * NAV_LIMIT,
      values[1] * NAV_LIMIT,
      values[2] * NAV_LIMIT,
    ],
    yawRate: values[3] * YAW_LIMIT,
  };
}

export function wilson(
  success: number,
  total: number,
  z = 1.96,
): { low: number; high: number } {
  if (total <= 0) return { low: 0, high: 1 };
  const p = Math.max(0, Math.min(1, success / total));
  const denom = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denom;
  const spread =
    (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total)) / denom;
  return {
    low: Math.max(0, center - spread),
    high: Math.min(1, center + spread),
  };
}

/** Hashes reproducible policy content. UI-specific id and creation time are intentionally excluded. */
export function checkpointHash(
  checkpoint: Omit<PolicyCheckpoint, "hash">,
): string {
  const {
    id: _id,
    createdAt: _createdAt,
    hash: _hash,
    ...content
  } = checkpoint as Omit<PolicyCheckpoint, "hash"> & { hash?: string };
  return hashValue(content);
}

/** Validates persisted artifacts once per object before they are used for inference. */
export function validateCheckpoint(checkpoint: PolicyCheckpoint): void {
  if (!isRecord(checkpoint)) throw new Error("Invalid policy checkpoint");
  if (validated.has(checkpoint)) return;
  knownKeys(checkpoint, checkpointKeys, "Policy checkpoint");
  if (
    checkpoint.version !== "bc-v1" ||
    !Array.isArray(checkpoint.layers) ||
    checkpoint.layers.length !== expectedShapes.length
  )
    throw new Error("Unsupported policy checkpoint");
  boundedText(checkpoint.id, "Policy id", 128);
  boundedText(checkpoint.createdAt, "Policy creation time", 64);
  if (Number.isNaN(Date.parse(checkpoint.createdAt))) throw new Error("Invalid policy creation time");
  if (!Number.isSafeInteger(checkpoint.trainingSeed) || checkpoint.trainingSeed < 0 || checkpoint.trainingSeed > 0xffffffff)
    throw new Error("Invalid policy training seed");
  const trainingSeeds = seeds(checkpoint.trainingSeeds, "training seeds", 0, 19999);
  const validationSeeds = seeds(checkpoint.validationSeeds, "validation seeds", 20000, 29999);
  const testSeeds = seeds(checkpoint.testSeeds, "test seeds", 30000, 39999);
  if (new Set([...trainingSeeds, ...validationSeeds, ...testSeeds]).size !== trainingSeeds.length + validationSeeds.length + testSeeds.length)
    throw new Error("Policy episode seeds must be disjoint");
  researchConfig(checkpoint.config, "config");
  if (checkpoint.scenario !== checkpoint.config.scenario)
    throw new Error("Policy scenario does not match its config");
  if (checkpoint.evaluationConfigs !== undefined) {
    if (!Array.isArray(checkpoint.evaluationConfigs) || checkpoint.evaluationConfigs.length !== testSeeds.length)
      throw new Error("Policy evaluation configs must match test seeds");
    checkpoint.evaluationConfigs.forEach((config, index) => {
      researchConfig(config, `evaluation config ${index}`);
      if (config.seed !== testSeeds[index] || config.scenario !== checkpoint.scenario)
        throw new Error("Policy evaluation configs must match test seeds and scenario");
    });
  }
  if (checkpoint.datasetSources !== undefined) {
    if (!Array.isArray(checkpoint.datasetSources) || !checkpoint.datasetSources.length ||
        checkpoint.datasetSources.length > trainingSeeds.length + validationSeeds.length)
      throw new Error("Invalid policy dataset sources");
    const sourceIds = new Set<string>(), sourceSeeds = new Set<number>();
    for (const item of checkpoint.datasetSources) {
      if (!isRecord(item)) throw new Error("Invalid policy dataset source");
      knownKeys(item, new Set(["runId", "seed", "split", "source"]), "Policy dataset source");
      boundedText(item.runId, "Policy source run id", 128);
      boundedText(item.source, "Policy source name", 256);
      if ((item.split !== "train" && item.split !== "validation") ||
          !Number.isSafeInteger(item.seed) ||
          !(item.split === "train" ? trainingSeeds : validationSeeds).includes(item.seed as number) ||
          sourceIds.has(item.runId as string) || sourceSeeds.has(item.seed as number))
        throw new Error("Invalid policy dataset source lineage");
      sourceIds.add(item.runId as string);
      sourceSeeds.add(item.seed as number);
    }
  }
  if (
    !Array.isArray(checkpoint.mean) || !Array.isArray(checkpoint.std) ||
    checkpoint.mean.length !== FEATURE_COUNT ||
    checkpoint.std.length !== FEATURE_COUNT
  )
    throw new Error("Invalid policy normalization");
  if (checkpoint.std.some((value) => !Number.isFinite(value) || value <= 0))
    throw new Error("Invalid policy normalization standard deviation");
  if (!Array.isArray(checkpoint.loss) || !Array.isArray(checkpoint.validationLoss))
    throw new Error("Invalid policy loss history");
  if (!Number.isSafeInteger(checkpoint.samples) || checkpoint.samples < 1 || checkpoint.samples > 20_000 ||
      !Number.isSafeInteger(checkpoint.epochs) || checkpoint.epochs < 1 || checkpoint.epochs > 24 ||
      checkpoint.loss.length > checkpoint.epochs || checkpoint.validationLoss.length > checkpoint.epochs)
    throw new Error("Invalid policy training counts");
  const numeric = [
    ...checkpoint.mean,
    ...checkpoint.std,
    ...checkpoint.loss,
    ...checkpoint.validationLoss,
  ];
  for (let i = 0; i < checkpoint.layers.length; i++) {
    const layer = checkpoint.layers[i],
      shape = expectedShapes[i];
    if (
      !isRecord(layer) || !Array.isArray(layer.shape) || !Array.isArray(layer.data) ||
      layer.shape.length !== shape.length ||
      layer.shape.some((value, index) => value !== shape[index]) ||
      layer.data.length !== shape.reduce((a, b) => a * b, 1)
    )
      throw new Error("Invalid policy weight shape");
    knownKeys(layer, new Set(["shape", "data"]), "Policy layer");
    numeric.push(...layer.data);
  }
  if (
    !numeric.every(Number.isFinite) ||
    !Number.isFinite(checkpoint.parityMaxError) ||
    checkpoint.parityMaxError < 0 || checkpoint.parityMaxError >= 1e-5
  )
    throw new Error("Policy contains invalid numeric values");
  if (checkpoint.hash !== checkpointHash(checkpoint))
    throw new Error("Policy checkpoint hash mismatch");
  validated.add(checkpoint);
}
