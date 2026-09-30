import { once } from "node:events";
import http from "node:http";
import { describe, expect, it } from "vitest";
import { BrowserRelay, RelayError, configFromEnv, type RelayConfig } from "../src/relay.js";
import { anthropicAdapter, geminiAdapter, localOpenAIAdapter, openAIAdapter } from "../src/providers.js";
import { BRIDGE_SESSION_CALL_LIMIT, createRelayApp } from "../src/index.js";
import { connectomeRequestSchema } from "../src/connectome.js";

const config: RelayConfig = { secret: "s".repeat(32), allowedOrigins: new Set(["https://app.example.test"]), sessionTtlMs: 5_000, commandTtlMs: 50, pollTimeoutMs: 20, maxQueue: 2, maxResultBytes: 1024, maxSessions: 2, providerCallsPerHour: 60 };
const relay = () => new BrowserRelay(config);

describe("BrowserRelay", () => {
  it("only accepts loopback endpoints for local inference", () => {
    const env = { DRONELAB_RELAY_SECRET: "s".repeat(32), DRONELAB_ALLOWED_ORIGINS: "https://app.example.test", DRONELAB_LOCAL_MODEL_URL: "http://127.0.0.1:11434", DRONELAB_LOCAL_MODEL: "qwen" };
    expect(configFromEnv(env).localModel).toMatchObject({ baseUrl: "http://127.0.0.1:11434/", model: "qwen" });
    expect(() => configFromEnv({ ...env, DRONELAB_LOCAL_MODEL_URL: "http://model.example.test" })).toThrow(/loopback/);
  });
  it("requires a fresh state-v1 observation and a bounded nav action shape", () => {
    const observation = { version: "state-v1", sourceStep: 3, deliveryStep: 4, sampleTime: 1, deliveryTime: 1, position: [0, 0, 0], velocity: [0, 0, 0], quaternion: [0, 0, 0, 1], angularVelocity: [0, 0, 0], relativeTarget: [0, 0, 0], range: [0, 0, 0, 0, 0, 0], battery: 1, priorAction: { kind: "nav", velocity: [0, 0, 0], yawRate: 0 }, elapsed: 1 };
    expect(connectomeRequestSchema.parse({ expectedStep: 4, observation })).toMatchObject({ expectedStep: 4 });
    expect(() => connectomeRequestSchema.parse({ expectedStep: 5, observation })).toThrow(/deliveryStep/);
  });
  it("adopts the worker authority at pairing and returns a 15-second heartbeat deadline", async () => {
    const subject = relay(); const session = subject.createSession({ generation: 7, epoch: 12 });
    expect(session).toMatchObject({ generation: 7, authorityEpoch: 12 });
    const poll = await subject.poll(session.sessionId, session.browserToken);
    expect(Date.parse(poll.expiresAt) - Date.now()).toBeLessThanOrEqual(15_000);
  });
  it("rejects invalid bearer, origins, and pairing ownership", () => {
    const subject = relay(); const session = subject.createSession();
    expect(() => subject.assertSecret("wrong")).toThrow(RelayError);
    expect(() => subject.assertOrigin("https://evil.test")).toThrow(RelayError);
    expect(() => subject.assertBrowser(session.sessionId, session.mcpToken)).toThrow(RelayError);
    expect(() => subject.assertMcp(session.sessionId, session.browserToken)).toThrow(RelayError);
  });
  it("deduplicates matching request IDs without adding a second command", async () => {
    const subject = relay(); const session = subject.createSession();
    const one = subject.issue(session.sessionId, session.mcpToken, "get_capabilities", {}, "same");
    const two = subject.issue(session.sessionId, session.mcpToken, "get_capabilities", {}, "same");
    const [command] = (await subject.poll(session.sessionId, session.browserToken)).commands;
    expect(command.requestId).toBe("same");
    subject.submitResult(session.sessionId, session.browserToken, { commandId: command.id, requestId: "same", generation: command.generation, authorityEpoch: command.authorityEpoch, ok: true, result: { source: "browser" } });
    await expect(one).resolves.toEqual({ source: "browser" }); await expect(two).resolves.toEqual({ source: "browser" });
  });
  it("invalidates pending work on reset and rejects stale browser results", async () => {
    const subject = relay(); const session = subject.createSession();
    const pending = subject.issue(session.sessionId, session.mcpToken, "get_observation", {}, "old");
    const [old] = (await subject.poll(session.sessionId, session.browserToken)).commands;
    expect(() => subject.submitResult(session.sessionId, session.browserToken, { commandId: old.id, requestId: old.requestId, generation: old.generation + 1, authorityEpoch: old.authorityEpoch, ok: true, result: {} })).toThrow(/invalidated simulation generation/);
    const reset = subject.issue(session.sessionId, session.mcpToken, "reset_session", {}, "reset");
    const [fresh] = (await subject.poll(session.sessionId, session.browserToken)).commands;
    expect(fresh.generation).toBe(old.generation);
    subject.submitResult(session.sessionId, session.browserToken, { commandId: fresh.id, requestId: fresh.requestId, generation: fresh.generation, authorityEpoch: fresh.authorityEpoch, authority: { generation: old.generation + 1, epoch: old.authorityEpoch + 1 }, ok: true, result: { reset: true } });
    await expect(pending).rejects.toMatchObject({ code: "stale_generation" });
    await expect(reset).resolves.toEqual({ reset: true });
  });
  it("accepts only the browser worker's exact canonical authority transitions", async () => {
    const subject = relay(); const session = subject.createSession({ generation: 10, epoch: 20 });
    const execute = async (name: "get_observation" | "pause_session" | "set_mission" | "cancel_run", authority?: { generation: number; epoch: number }) => {
      const pending = subject.issue(session.sessionId, session.mcpToken, name, {}, name);
      const [command] = (await subject.poll(session.sessionId, session.browserToken)).commands;
      subject.submitResult(session.sessionId, session.browserToken, { commandId: command.id, requestId: command.requestId, generation: command.generation, authorityEpoch: command.authorityEpoch, authority, ok: true, result: { name } });
      await expect(pending).resolves.toEqual({ name });
    };
    await execute("get_observation");
    await execute("pause_session", { generation: 10, epoch: 21 });
    await execute("set_mission", { generation: 11, epoch: 23 });
    await execute("cancel_run", { generation: 12, epoch: 24 });
  });
  it("expires a command if the browser does not answer", async () => {
    const subject = relay(); const session = subject.createSession();
    await expect(subject.issue(session.sessionId, session.mcpToken, "list_policies", {})).rejects.toMatchObject({ code: "browser_timeout" });
    await expect(subject.issue(session.sessionId, session.mcpToken, "list_policies", {}, "failed-request")).rejects.toMatchObject({ code: "browser_timeout" });
    await expect(subject.issue(session.sessionId, session.mcpToken, "list_policies", {}, "failed-request")).rejects.toMatchObject({ code: "browser_timeout" });
  });
  it("bounds completed request-id records while preserving recent idempotency", async () => {
    const subject = relay(); const session = subject.createSession();
    for (let index = 0; index < 260; index += 1) {
      const pending = subject.issue(session.sessionId, session.mcpToken, "get_capabilities", {}, `request-${index}`);
      const [command] = (await subject.poll(session.sessionId, session.browserToken)).commands;
      subject.submitResult(session.sessionId, session.browserToken, { commandId: command.id, requestId: command.requestId, generation: command.generation, authorityEpoch: command.authorityEpoch, ok: true, result: { index } });
      await expect(pending).resolves.toEqual({ index });
    }
    const internals = subject as unknown as { sessions: Map<string, { byRequestId: Map<string, unknown> }> };
    expect(internals.sessions.get(session.sessionId)?.byRequestId.size).toBeLessThanOrEqual(256);
  });
});

describe("HTTP relay safeguards", () => {
  it("allows a complete 30-second policy horizon before the session bridge cap", () => {
    // 30 seconds × 120 Hz / four-tick policy decisions = 900 calls.
    expect(BRIDGE_SESSION_CALL_LIMIT).toBe(1_024);
    expect(BRIDGE_SESSION_CALL_LIMIT).toBeGreaterThanOrEqual(900);
  });
  it("requires browser pairing and rate-limits local policy bridge calls", async () => {
    const bridge = http.createServer((_req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ action: { kind: "nav", velocity: [0, 0, 0], yawRate: 0 }, metadata: { datasetVersion: "test", model: "fixture", mappingVersion: "v1" } })); });
    bridge.listen(0, "127.0.0.1"); await once(bridge, "listening");
    const bridgeAddress = bridge.address(); if (!bridgeAddress || typeof bridgeAddress === "string") throw new Error("bridge bind failed");
    const secret = "b".repeat(32); const relayApp = createRelayApp({ ...config, secret, bridgeCallsPerHour: 1, policy: { url: `http://127.0.0.1:${bridgeAddress.port}/` } });
    relayApp.server.listen(0, "127.0.0.1"); await once(relayApp.server, "listening");
    const address = relayApp.server.address(); if (!address || typeof address === "string") throw new Error("bind failed");
    const root = `http://127.0.0.1:${address.port}`;
    const headers = { authorization: `Bearer ${secret}`, origin: "https://app.example.test", "content-type": "application/json" };
    const body = { expectedStep: 4, observation: { version: "state-v1", sourceStep: 3, deliveryStep: 4, sampleTime: 1, deliveryTime: 1, position: [0, 0, 0], velocity: [0, 0, 0], quaternion: [0, 0, 0, 1], angularVelocity: [0, 0, 0], relativeTarget: [0, 0, 0], range: [0, 0, 0, 0, 0, 0], battery: 1, priorAction: { kind: "nav", velocity: [0, 0, 0], yawRate: 0 }, elapsed: 1 } };
    try {
      expect((await fetch(`${root}/policies/action`, { method: "POST", headers, body: JSON.stringify(body) })).status).toBe(401);
      const created = await fetch(`${root}/sessions`, { method: "POST", headers, body: JSON.stringify({ generation: 1, authorityEpoch: 0 }) });
      const session = await created.json() as { sessionId: string; browserToken: string };
      const paired = { ...headers, "x-dronelab-session-id": session.sessionId, "x-dronelab-pair-token": session.browserToken };
      expect((await fetch(`${root}/policies/action`, { method: "POST", headers: paired, body: JSON.stringify(body) })).status).toBe(200);
      expect((await fetch(`${root}/policies/action`, { method: "POST", headers: paired, body: JSON.stringify(body) })).status).toBe(429);
    } finally { await relayApp.close(); await new Promise<void>((resolve, reject) => bridge.close((error) => error ? reject(error) : resolve())); }
  });
  it("reserves the browser session during concurrent MCP initialize and permits provider preflight headers", async () => {
    const secret = "t".repeat(32);
    const relayApp = createRelayApp({ ...config, secret });
    relayApp.server.listen(0, "127.0.0.1"); await once(relayApp.server, "listening");
    const address = relayApp.server.address(); if (!address || typeof address === "string") throw new Error("bind failed");
    const root = `http://127.0.0.1:${address.port}`;
    const headers = { authorization: `Bearer ${secret}`, origin: "https://app.example.test", "content-type": "application/json" };
    try {
      const created = await fetch(`${root}/sessions`, { method: "POST", headers, body: JSON.stringify({ generation: 1, authorityEpoch: 0 }) });
      const session = await created.json() as { sessionId: string; mcpToken: string };
      const initialize = () => fetch(`${root}/mcp?sessionId=${encodeURIComponent(session.sessionId)}`, { method: "POST", headers: { ...headers, "x-dronelab-pair-token": session.mcpToken, accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } } }) });
      const responses = await Promise.all([initialize(), initialize()]);
      const statuses = responses.map((response) => response.status);
      expect(statuses).toContain(409);
      expect(statuses.some((status) => status >= 200 && status < 300)).toBe(true);
      const preflight = await fetch(`${root}/providers/openai/plan`, { method: "OPTIONS", headers: { origin: "https://app.example.test", "access-control-request-method": "POST", "access-control-request-headers": "x-dronelab-session-id, x-dronelab-pair-token, authorization, content-type" } });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("access-control-allow-headers")).toContain("x-dronelab-session-id");
    } finally { await relayApp.close(); }
  });
  it("retains the operator provider budget across new browser sessions", async () => {
    const secret = "u".repeat(32);
    const relayApp = createRelayApp({ ...config, secret, providerCallsPerHour: 1 });
    relayApp.server.listen(0, "127.0.0.1"); await once(relayApp.server, "listening");
    const address = relayApp.server.address(); if (!address || typeof address === "string") throw new Error("bind failed");
    const root = `http://127.0.0.1:${address.port}`;
    const headers = { authorization: `Bearer ${secret}`, origin: "https://app.example.test", "content-type": "application/json" };
    const create = async () => {
      const response = await fetch(`${root}/sessions`, { method: "POST", headers, body: JSON.stringify({ generation: 1, authorityEpoch: 0 }) });
      return response.json() as Promise<{ sessionId: string; browserToken: string }>;
    };
    const plan = (session: { sessionId: string; browserToken: string }) => fetch(`${root}/providers/openai/plan`, { method: "POST", headers: { ...headers, "x-dronelab-session-id": session.sessionId, "x-dronelab-pair-token": session.browserToken }, body: JSON.stringify({ messages: [{ role: "user", content: "plan" }], tools: [] }) });
    try {
      const first = await create();
      expect((await plan(first)).status).toBe(503);
      const second = await create();
      expect((await plan(second)).status).toBe(429);
    } finally { await relayApp.close(); }
  });
});

describe("provider native conversions", () => {
  const tools = [{ name: "set_mission", description: "Set a mission", inputSchema: { type: "object", properties: { mission: { type: "string" } }, required: ["mission"] } }];
  it("uses OpenAI Responses function call shapes", () => {
    expect(openAIAdapter.request({ model: "configured", messages: [{ role: "user", content: "go" }], tools })).toMatchObject({ max_output_tokens: 1024, tools: [{ type: "function", name: "set_mission", parameters: tools[0].inputSchema }] });
    expect(openAIAdapter.calls({ output: [{ type: "function_call", call_id: "o1", name: "set_mission", arguments: '{"mission":"hover"}' }] })).toEqual([{ id: "o1", name: "set_mission", args: { mission: "hover" } }]);
  });
  it("uses Anthropic Messages tool_use and tool_result shapes", () => {
    expect(anthropicAdapter.request({ model: "configured", messages: [{ role: "user", content: "go" }], tools }).tools).toMatchObject([{ name: "set_mission", input_schema: tools[0].inputSchema }]);
    expect(anthropicAdapter.calls({ content: [{ type: "tool_use", id: "a1", name: "set_mission", input: { mission: "hover" } }] })).toEqual([{ id: "a1", name: "set_mission", args: { mission: "hover" } }]);
    expect(anthropicAdapter.toolResult("a1", { ok: true })).toMatchObject({ type: "tool_result", tool_use_id: "a1" });
  });
  it("uses Gemini functionDeclarations/functionCall/functionResponse shapes", () => {
    expect(geminiAdapter.request({ model: "configured", messages: [{ role: "user", content: "go" }], tools })).toMatchObject({ generationConfig: { maxOutputTokens: 1024 }, tools: [{ functionDeclarations: [{ name: "set_mission", parametersJsonSchema: tools[0].inputSchema }] }] });
    expect(geminiAdapter.calls({ candidates: [{ content: { parts: [{ functionCall: { id: "g1", name: "set_mission", args: { mission: "hover" } } }] } }] })).toEqual([{ id: "g1", name: "set_mission", args: { mission: "hover" } }]);
    expect(geminiAdapter.toolResult("set_mission", { ok: true })).toMatchObject({ functionResponse: { name: "set_mission" } });
  });
  it("uses OpenAI-compatible local tool call shapes", () => {
    expect(localOpenAIAdapter.request({ model: "llama", messages: [{ role: "user", content: "go" }], tools })).toMatchObject({ model: "llama", stream: false, tools: [{ type: "function", function: { name: "set_mission", parameters: tools[0].inputSchema } }] });
    expect(localOpenAIAdapter.calls({ choices: [{ message: { tool_calls: [{ id: "l1", function: { name: "set_mission", arguments: '{"mission":"hover"}' } }] } }] })).toEqual([{ id: "l1", name: "set_mission", args: { mission: "hover" } }]);
  });
});
