import { once } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createRelayApp } from "../src/index.js";

const secret = "s".repeat(32);
const execFileAsync = promisify(execFile);
const relayApp = createRelayApp({ secret, allowedOrigins: new Set(["https://app.example.test"]), sessionTtlMs: 30_000, commandTtlMs: 5_000, pollTimeoutMs: 100, maxQueue: 4, maxResultBytes: 8_192, maxSessions: 4 });
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
  const cliCreated = await fetch(`${root}/sessions`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ generation: 9, authorityEpoch: 3 }) });
  if (!cliCreated.ok) throw new Error(`terminal CLI session creation failed: ${cliCreated.status}`);
  const cliSession = await cliCreated.json() as { sessionId: string; browserToken: string; mcpToken: string };
  const runCli = async () => {
    const running = execFileAsync("python3", [resolve(process.cwd(), "../../examples/relay-policy-cli.py"), "status"], { env: { ...process.env, DRONELAB_RELAY_URL: root, DRONELAB_RELAY_SECRET: secret, DRONELAB_SESSION_ID: cliSession.sessionId, DRONELAB_MCP_TOKEN: cliSession.mcpToken } });
    void running.catch(() => undefined);
    let cliCommands: Array<{ id: string; requestId: string; generation: number; authorityEpoch: number }> = [];
    const deadline = Date.now() + 5_000;
    while (!cliCommands.length && Date.now() < deadline) {
      const cliPoll = await fetch(`${root}/sessions/${cliSession.sessionId}/poll`, { headers: { ...headers, "x-dronelab-pair-token": cliSession.browserToken } });
      if (!cliPoll.ok) throw new Error(`CLI browser poll failed: ${cliPoll.status}`);
      cliCommands = (await cliPoll.json() as { commands: typeof cliCommands }).commands;
    }
    if (cliCommands.length !== 1) throw new Error("terminal CLI tool call was not delivered to paired browser");
    const cliCommand = cliCommands[0];
    const cliResult = await fetch(`${root}/sessions/${cliSession.sessionId}/results`, { method: "POST", headers: { ...headers, "x-dronelab-pair-token": cliSession.browserToken, "content-type": "application/json" }, body: JSON.stringify({ commandId: cliCommand.id, requestId: cliCommand.requestId, generation: cliCommand.generation, authorityEpoch: cliCommand.authorityEpoch, ok: true, result: { fixture: "terminal-cli" } }) });
    if (!cliResult.ok) throw new Error(`terminal CLI browser result rejected: ${cliResult.status}`);
    const output = await running;
    if (!output.stdout.includes("terminal-cli")) throw new Error("terminal CLI did not receive paired browser result");
  };
  await runCli();
  // The CLI sends DELETE in finally. A second run proves it released the MCP connection.
  await runCli();
  console.log("SDK smoke passed: initialize, list-tools, and paired browser tool-call.");
} finally { await relayApp.close(); }
