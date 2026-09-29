import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { BrowserRelay, CANONICAL_TOOLS, RelayError, type CanonicalTool, type JsonObject } from "./relay.js";

interface McpConnection { transport: StreamableHTTPServerTransport; server: Server; relaySessionId: string; expiresAtMs: number; }
const toolSchema = {
  type: "object" as const,
  properties: {
    requestId: { type: "string", minLength: 1, maxLength: 128 },
    generation: { type: "integer", minimum: 1 },
    authorityEpoch: { type: "integer", minimum: 0 },
  },
  additionalProperties: true,
};
const descriptions: Record<CanonicalTool, string> = {
  list_scenarios: "List browser-provided scenario IDs and metadata.", get_capabilities: "Read current browser simulation capabilities.", get_observation: "Read the latest browser observation; no physics is advanced.", reset_session: "Reset the browser-owned simulation and invalidate old work.", set_mission: "Validate and set a bounded browser mission.", pause_session: "Pause the browser simulation.", stop_session: "Stop browser work and invalidate old commands.", start_experiment: "Start a bounded browser experiment; returns a job ID.", get_run_status: "Get a browser experiment status by job ID.", cancel_run: "Cancel a browser experiment by job ID.", start_training: "Start bounded browser training; returns a job ID.", get_training_status: "Get browser training status by job ID.", list_policies: "List browser-local policies.", capture_frame: "Capture a real renderer frame when the browser advertises that capability.", export_dataset: "Request a browser dataset export artifact ID.",
};
const bearer = (value: string | undefined) => value?.match(/^Bearer\s+(.+)$/i)?.[1];
const jsonText = (value: unknown) => JSON.stringify(value, null, 0).slice(0, 120_000);

function makeServer(relay: BrowserRelay, sessionId: string, mcpToken: string): Server {
  const server = new Server({ name: "dronelab-browser-relay", version: "0.1.0" }, { capabilities: { tools: {} }, instructions: "Commands are relayed to a paired active browser. The browser owns simulation authority; unavailable or disconnected sessions fail." });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: CANONICAL_TOOLS.map((name) => ({ name, description: descriptions[name], inputSchema: toolSchema })) }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    if (!(CANONICAL_TOOLS as readonly string[]).includes(name)) return { content: [{ type: "text", text: jsonText({ error: { code: "unknown_tool", message: `Unknown tool: ${name}` } }) }], isError: true };
    const source = (request.params.arguments ?? {}) as JsonObject;
    const { requestId, generation, authorityEpoch, ...args } = source;
    try {
      const result = await relay.issue(sessionId, mcpToken, name as CanonicalTool, args, typeof requestId === "string" ? requestId : undefined, typeof generation === "number" ? generation : undefined, typeof authorityEpoch === "number" ? authorityEpoch : undefined);
      return { content: [{ type: "text", text: jsonText({ ok: true, result }) }], structuredContent: { ok: true, result } };
    } catch (error) {
      const known = error instanceof RelayError ? error : new RelayError("relay_error", "relay command failed", 502);
      return { content: [{ type: "text", text: jsonText({ ok: false, error: { code: known.code, message: known.message } }) }], isError: true };
    }
  });
  return server;
}

/** Attach this after JSON body parsing. It uses one official SDK transport/server per MCP session. */
export function mcpHandler(relay: BrowserRelay) {
  const connections = new Map<string, McpConnection>();
  const connectionsByRelaySession = new Map<string, string>();
  const remove = (id: string, connection: McpConnection) => {
    connections.delete(id);
    if (connectionsByRelaySession.get(connection.relaySessionId) === id) connectionsByRelaySession.delete(connection.relaySessionId);
  };
  const reap = () => {
    const now = Date.now();
    for (const [id, connection] of connections) if (connection.expiresAtMs <= now || !relay.isActive(connection.relaySessionId)) {
      remove(id, connection); void connection.transport.close().catch(() => undefined);
    }
  };
  const reaper = setInterval(reap, Math.max(1_000, Math.min(relay.config.sessionTtlMs, 30_000)));
  reaper.unref();
  return async (req: Request, res: Response): Promise<void> => {
    try {
      reap();
      relay.assertSecret(bearer(req.header("authorization") ?? undefined));
      const sessionId = req.query.sessionId;
      const mcpToken = req.header("x-dronelab-pair-token") ?? undefined;
      if (typeof sessionId !== "string" || !mcpToken) throw new RelayError("missing_pairing", "sessionId query parameter and X-DroneLab-Pair-Token header are required", 401);
      relay.assertMcp(sessionId, mcpToken);
      const transportId = req.header("mcp-session-id") ?? undefined;
      let connection = transportId ? connections.get(transportId) : undefined;
      if (connection && connection.relaySessionId !== sessionId) throw new RelayError("invalid_mcp_session", "MCP transport is bound to another browser session", 403);
      if (!connection) {
        if (req.method !== "POST" || (req.body as JsonObject | undefined)?.method !== "initialize") throw new RelayError("invalid_mcp_session", "initialize a new MCP session before making requests", 400);
        if (connectionsByRelaySession.has(sessionId)) throw new RelayError("mcp_connection_exists", "this browser session already has an active MCP client connection", 409);
        const expiresAtMs = Date.parse(relay.assertMcp(sessionId, mcpToken).expiresAt);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(), onsessioninitialized: (id) => { connections.set(id, connection!); connectionsByRelaySession.set(sessionId, id); } });
        const server = makeServer(relay, sessionId, mcpToken);
        connection = { transport, server, relaySessionId: sessionId, expiresAtMs };
        transport.onclose = () => { if (transport.sessionId) remove(transport.sessionId, connection!); };
        await server.connect(transport);
      }
      await connection.transport.handleRequest(req, res, req.body);
    } catch (error) {
      const known = error instanceof RelayError ? error : new RelayError("mcp_error", "MCP request failed", 500);
      if (!res.headersSent) res.status(known.status).json({ error: { code: known.code, message: known.message } });
    }
  };
}
