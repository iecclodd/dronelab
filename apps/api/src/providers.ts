import { RelayError, type JsonObject } from "./relay.js";

export type ProviderName = "openai" | "anthropic" | "gemini";
export interface ProviderTool { name: string; description: string; inputSchema: JsonObject; }
export interface ProviderMessage { role: "user" | "assistant"; content: string; }
export interface ToolInvocation { id: string; name: string; args: JsonObject; }
export interface ProviderRequest { model: string; messages: ProviderMessage[]; tools: ProviderTool[]; }

const parseArgs = (input: unknown): JsonObject => {
  if (typeof input === "object" && input !== null && !Array.isArray(input)) return input as JsonObject;
  if (typeof input !== "string") throw new RelayError("invalid_tool_arguments", "provider returned non-object tool arguments", 502);
  try { const value = JSON.parse(input); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); return value as JsonObject; }
  catch { throw new RelayError("invalid_tool_arguments", "provider returned invalid JSON tool arguments", 502); }
};

export const openAIAdapter = {
  request: (input: ProviderRequest): JsonObject => ({
    model: input.model,
    max_output_tokens: 1024,
    input: input.messages.map((message) => ({ role: message.role, content: [{ type: "input_text", text: message.content }] })),
    tools: input.tools.map((tool) => ({ type: "function", name: tool.name, description: tool.description, parameters: tool.inputSchema, strict: true })),
    tool_choice: "auto",
  }),
  calls: (response: JsonObject): ToolInvocation[] => Array.isArray(response.output) ? response.output
    .filter((item): item is JsonObject => !!item && typeof item === "object" && (item as JsonObject).type === "function_call")
    .map((item) => ({ id: String(item.call_id), name: String(item.name), args: parseArgs(item.arguments) })) : [],
  toolResult: (callId: string, result: unknown): JsonObject => ({ type: "function_call_output", call_id: callId, output: JSON.stringify(result) }),
};

export const anthropicAdapter = {
  request: (input: ProviderRequest): JsonObject => ({
    model: input.model, max_tokens: 1024, messages: input.messages,
    tools: input.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema })),
  }),
  calls: (response: JsonObject): ToolInvocation[] => Array.isArray(response.content) ? response.content
    .filter((item): item is JsonObject => !!item && typeof item === "object" && (item as JsonObject).type === "tool_use")
    .map((item) => ({ id: String(item.id), name: String(item.name), args: parseArgs(item.input) })) : [],
  toolResult: (toolUseId: string, result: unknown): JsonObject => ({ type: "tool_result", tool_use_id: toolUseId, content: JSON.stringify(result) }),
};

export const geminiAdapter = {
  request: (input: ProviderRequest): JsonObject => ({
    contents: input.messages.map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.content }] })),
    tools: [{ functionDeclarations: input.tools.map((tool) => ({ name: tool.name, description: tool.description, parametersJsonSchema: tool.inputSchema })) }],
    generationConfig: { maxOutputTokens: 1024 },
  }),
  calls: (response: JsonObject): ToolInvocation[] => {
    const parts = ((response.candidates as JsonObject[] | undefined)?.[0]?.content as JsonObject | undefined)?.parts;
    return Array.isArray(parts) ? parts.filter((item): item is JsonObject => !!item && typeof item === "object" && !!(item as JsonObject).functionCall)
      .map((item, index) => { const call = item.functionCall as JsonObject; return { id: String(call.id ?? `gemini-${index}`), name: String(call.name), args: parseArgs(call.args ?? {}) }; }) : [];
  },
  toolResult: (name: string, result: unknown): JsonObject => ({ functionResponse: { name, response: { result } } }),
};

export interface ProviderConfig { key?: string; model?: string; timeoutMs?: number; }
const adapterFor = (provider: ProviderName) => provider === "openai" ? openAIAdapter : provider === "anthropic" ? anthropicAdapter : geminiAdapter;

async function readJsonLimited(response: Response, maxBytes = 2 * 1024 * 1024): Promise<JsonObject> {
  const length = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > maxBytes) throw new RelayError("provider_response_too_large", "provider response exceeds 2 MiB", 502);
  if (!response.body) return {};
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  while (true) { const next = await reader.read(); if (next.done) break; total += next.value.byteLength; if (total > maxBytes) { await reader.cancel(); throw new RelayError("provider_response_too_large", "provider response exceeds 2 MiB", 502); } chunks.push(next.value); }
  const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)) as JsonObject; } catch { throw new RelayError("provider_invalid_response", "provider did not return JSON", 502); }
}
export async function invokeProvider(provider: ProviderName, config: ProviderConfig, request: Omit<ProviderRequest, "model">): Promise<{ calls: ToolInvocation[]; raw: JsonObject }> {
  if (!config.key || !config.model) throw new RelayError("provider_unconfigured", `${provider} is not configured on this server`, 503);
  const timeout = AbortSignal.timeout(config.timeoutMs ?? 20_000);
  const adapter = adapterFor(provider);
  const payload = adapter.request({ ...request, model: config.model });
  const target = provider === "openai" ? "https://api.openai.com/v1/responses" : provider === "anthropic" ? "https://api.anthropic.com/v1/messages" : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (provider === "openai") headers.authorization = `Bearer ${config.key}`;
  if (provider === "anthropic") { headers["x-api-key"] = config.key; headers["anthropic-version"] = "2023-06-01"; }
  if (provider === "gemini") headers["x-goog-api-key"] = config.key;
  let response: Response;
  try { response = await fetch(target, { method: "POST", headers, body: JSON.stringify(payload), signal: timeout }); }
  catch { throw new RelayError("provider_unavailable", `${provider} request failed or timed out`, 502); }
  const raw = await readJsonLimited(response);
  if (!response.ok) throw new RelayError("provider_error", `${provider} returned ${response.status}`, 502);
  return { calls: adapter.calls(raw), raw };
}
