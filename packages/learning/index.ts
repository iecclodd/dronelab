import {
  FEATURE_COUNT,
  NAV_LIMIT,
  YAW_LIMIT,
  hashValue,
  type Action,
  type Observation,
  type PolicyCheckpoint,
} from "../contracts/index.ts";

const validated = new WeakSet<object>();
const expectedShapes = [[20, 32], [32], [32, 32], [32], [32, 4], [4]];

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
  if (validated.has(checkpoint)) return;
  if (
    checkpoint.version !== "bc-v1" ||
    checkpoint.layers.length !== expectedShapes.length
  )
    throw new Error("Unsupported policy checkpoint");
  if (
    checkpoint.mean.length !== FEATURE_COUNT ||
    checkpoint.std.length !== FEATURE_COUNT
  )
    throw new Error("Invalid policy normalization");
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
      layer.shape.length !== shape.length ||
      layer.shape.some((value, index) => value !== shape[index]) ||
      layer.data.length !== shape.reduce((a, b) => a * b, 1)
    )
      throw new Error("Invalid policy weight shape");
    numeric.push(...layer.data);
  }
  if (
    !numeric.every(Number.isFinite) ||
    !Number.isFinite(checkpoint.parityMaxError) ||
    checkpoint.samples < 1 ||
    checkpoint.epochs < 1
  )
    throw new Error("Policy contains invalid numeric values");
  if (checkpoint.hash !== checkpointHash(checkpoint))
    throw new Error("Policy checkpoint hash mismatch");
  validated.add(checkpoint);
}
