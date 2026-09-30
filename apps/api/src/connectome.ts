import { z } from "zod";
import { RelayError, type JsonObject } from "./relay.js";

const finite = z.number().finite();
const v3 = z.tuple([finite, finite, finite]);
const actionSchema = z.object({
  kind: z.literal("nav"),
  velocity: v3,
  yawRate: finite,
}).strict().superRefine((action, ctx) => {
  if (action.velocity.some((value) => Math.abs(value) > 3)) ctx.addIssue({ code: "custom", message: "nav velocity components must be within ±3 m/s" });
  if (Math.abs(action.yawRate) > 1.5) ctx.addIssue({ code: "custom", message: "yawRate must be within ±1.5 rad/s" });
});
const priorActionSchema = z.union([
  z.object({ kind: z.literal("nav"), velocity: v3, yawRate: finite }).strict(),
  z.object({ kind: z.literal("rate"), rates: v3, thrust: finite }).strict(),
]);

export const stateV1Schema = z.object({
  version: z.literal("state-v1"), sourceStep: z.number().int().nonnegative(), deliveryStep: z.number().int().nonnegative(),
  sampleTime: finite, deliveryTime: finite, position: v3, velocity: v3, quaternion: z.tuple([finite, finite, finite, finite]),
  angularVelocity: v3, relativeTarget: v3, range: z.array(finite).length(6), battery: finite.min(0).max(1),
  priorAction: priorActionSchema, elapsed: finite.min(0),
}).strict().superRefine((observation, ctx) => {
  if (observation.sourceStep > observation.deliveryStep) ctx.addIssue({ code: "custom", path: ["sourceStep"], message: "sourceStep cannot exceed deliveryStep" });
  if (observation.sampleTime > observation.deliveryTime) ctx.addIssue({ code: "custom", path: ["sampleTime"], message: "sampleTime cannot exceed deliveryTime" });
});

export const connectomeRequestSchema = z.object({
  expectedStep: z.number().int().nonnegative(),
  observation: stateV1Schema,
}).strict().superRefine((value, ctx) => {
  if (value.expectedStep !== value.observation.deliveryStep) ctx.addIssue({ code: "custom", path: ["expectedStep"], message: "expectedStep must equal observation.deliveryStep" });
});

const connectomeResponseSchema = z.object({
  action: actionSchema,
  metadata: z.object({
    datasetVersion: z.string().min(1).max(128), model: z.string().min(1).max(128), mappingVersion: z.string().min(1).max(128),
  }).strict(),
}).strict();

async function jsonResponse(response: Response, label: string): Promise<JsonObject> {
  const length = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > 128 * 1024) throw new RelayError(`${label}_response_too_large`, `${label} bridge response exceeds 128 KiB`, 502);
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > 128 * 1024) throw new RelayError(`${label}_response_too_large`, `${label} bridge response exceeds 128 KiB`, 502);
  try { return JSON.parse(text) as JsonObject; } catch { throw new RelayError(`${label}_invalid_response`, `${label} bridge did not return JSON`, 502); }
}

/** Calls an operator-run loopback bridge. It does not run a connectome itself. */
export async function requestPolicyAction(config: { url: string; token?: string }, input: z.infer<typeof connectomeRequestSchema>, label = "policy") {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (config.token) headers.authorization = `Bearer ${config.token}`;
  let response: Response;
  try {
    response = await fetch(new URL("v1/action", config.url), { method: "POST", headers, body: JSON.stringify(input), signal: AbortSignal.timeout(5_000), redirect: "error" });
  } catch { throw new RelayError(`${label}_unavailable`, `${label} bridge request failed or timed out`, 502); }
  if (!response.ok) throw new RelayError(`${label}_error`, `${label} bridge returned ${response.status}`, 502);
  const parsed = connectomeResponseSchema.safeParse(await jsonResponse(response, label));
  if (!parsed.success) throw new RelayError(`${label}_invalid_response`, `${label} bridge response did not match the state-v1/nav contract`, 502);
  return parsed.data;
}

export const requestConnectomeAction = (config: { url: string; token?: string }, input: z.infer<typeof connectomeRequestSchema>) => requestPolicyAction(config, input, "connectome");
