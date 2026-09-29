import { once } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createRelayApp } from "../src/index.js";

const secret = "s".repeat(32);
const relayApp = createRelayApp({ secret, allowedOrigins: new Set(["https://app.example.test"]), sessionTtlMs: 10_000, commandTtlMs: 2_000, pollTimeoutMs: 100, maxQueue: 4, maxResultBytes: 8_192, maxSessions: 4 });
relayApp.server.listen(0, "127.0.0.1"); await once(relayApp.server, "listening");
const address = relayApp.server.address();
if (!address || typeof address === "string") throw new Error("failed to bind relay");
const root = `http://127.0.0.1:${address.port}`;
const headers = { authorization: `Bearer ${secret}`, origin: "https://app.example.test" };
try {
  const created = await fetch(`${root}/sessions`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ generation: 9, authorityEpoch: 3 }) });
  if (!created.ok) throw new Error(`session creation failed: ${created.status}`);
  const session = await created.json() as { sessionId: string; browserToken: string; mcpToken: string };
  const url = new URL(`${root}/mcp`); url.searchParams.set("sessionId", session.sessionId);
  const client = new Client({ name: "sdk-smoke", version: "0.1.0" }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${secret}`, "x-dronelab-pair-token": session.mcpToken } } });
  await client.connect(transport);
  const tools = await client.listTools();
  if (!tools.tools.some((tool) => tool.name === "get_capabilities")) throw new Error("MCP list-tools omitted get_capabilities");
  const call = client.callTool({ name: "get_capabilities", arguments: { requestId: "sdk-smoke" } });
  const poll = await fetch(`${root}/sessions/${session.sessionId}/poll`, { headers: { ...headers, "x-dronelab-pair-token": session.browserToken } });
  const commands = (await poll.json() as { expiresAt: string; commands: Array<{ id: string; requestId: string; generation: number; authorityEpoch: number }> }).commands;
  if (commands.length !== 1) throw new Error("MCP tool call was not delivered to paired browser");
  const command = commands[0];
  const result = await fetch(`${root}/sessions/${session.sessionId}/results`, { method: "POST", headers: { ...headers, "x-dronelab-pair-token": session.browserToken, "content-type": "application/json" }, body: JSON.stringify({ commandId: command.id, requestId: command.requestId, generation: command.generation, authorityEpoch: command.authorityEpoch, ok: true, result: { fixture: true, capability: "state" } }) });
  if (!result.ok) throw new Error(`browser result rejected: ${result.status}`);
  const output = await call;
  if (output.isError || !JSON.stringify(output).includes("fixture")) throw new Error("MCP call did not return browser fixture result");
  await transport.close();
  console.log("SDK smoke passed: initialize, list-tools, and paired browser tool-call.");
} finally { await relayApp.close(); }
