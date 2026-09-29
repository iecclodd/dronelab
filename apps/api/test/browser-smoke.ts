/**
 * Real production-browser bridge check. Requires a running DroneLab build and the
 * parent project's Playwright installation; it deliberately never logs credentials.
 * Run: npx tsx test/browser-smoke.ts
 */
import { createRequire } from "node:module";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createRelayApp } from "../src/index.js";

type Pair = { sessionId: string; browserToken: string; mcpToken: string; generation: number; authorityEpoch: number };
type BrowserResult = { generation: number; authorityEpoch: number; authority?: { generation: number; epoch: number } };
const browserUrl = process.env.DRONELAB_BROWSER_URL ?? "http://127.0.0.1:4173";
const browserOrigin = new URL(browserUrl).origin;
const testDirectory = dirname(fileURLToPath(import.meta.url));
const outputRoot = resolve(testDirectory, "../../..");
const moduleLoader = createRequire(import.meta.url);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function sleep(milliseconds: number) { return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)); }
async function waitForResult(results: BrowserResult[], count: number): Promise<BrowserResult> {
  const deadline = Date.now() + 10_000;
  while (results.length <= count && Date.now() < deadline) await sleep(25);
  assert(results.length > count, "browser did not post a command result before timeout");
  return results.at(-1)!;
}

const playwrightPath = moduleLoader.resolve("@playwright/test", { paths: [process.env.DRONELAB_PLAYWRIGHT_ROOT ?? outputRoot] });
const { chromium } = moduleLoader(playwrightPath) as { chromium: { launch: (options: { headless: boolean }) => Promise<any> } };
const relaySecret = randomBytes(32).toString("base64url");
const relayApp = createRelayApp({
  secret: relaySecret, allowedOrigins: new Set([browserOrigin]), sessionTtlMs: 30_000, commandTtlMs: 10_000,
  pollTimeoutMs: 1_000, maxQueue: 8, maxResultBytes: 131_072, maxSessions: 4, providerCallsPerHour: 60,
});
relayApp.server.listen(0, "127.0.0.1"); await once(relayApp.server, "listening");
const address = relayApp.server.address();
assert(address && typeof address !== "string", "temporary relay did not bind");
const relayUrl = `http://127.0.0.1:${address.port}`;
let browser: any;
let transport: StreamableHTTPClientTransport | undefined;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(browserUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForFunction(() => window.dronelab?.sim?.generation > 0, { timeout: 30_000 });
  await page.getByText("Connect AI", { exact: false }).first().click();
  const browserPoll = page.waitForRequest((request: any) => request.url().startsWith(`${relayUrl}/sessions/`) && request.url().endsWith("/poll"), { timeout: 10_000 });
  const paired = page.waitForResponse((response: any) => response.url() === `${relayUrl}/sessions` && response.request().method() === "POST", { timeout: 10_000 });
  await page.getByLabel("Relay URL").fill(relayUrl);
  await page.getByLabel("Relay access token").fill(relaySecret);
  await page.getByRole("button", { name: "Connect relay" }).click();
  const pairingResponse = await paired;
  assert(pairingResponse.status() === 201, `browser pairing request was rejected with HTTP ${pairingResponse.status()}`);
  const pair = await pairingResponse.json() as Pair;
  assert(pair.sessionId && pair.mcpToken && pair.browserToken, "browser pairing response omitted credentials");
  await page.getByText("Connected to this browser", { exact: false }).waitFor({ timeout: 10_000 });
  await browserPoll;
  assert(relayApp.relay.isActive(pair.sessionId), "browser pairing expired before MCP initialization");

  const browserResults: BrowserResult[] = [];
  page.on("request", (request: any) => {
    if (request.method() !== "POST" || request.url() !== `${relayUrl}/sessions/${pair.sessionId}/results`) return;
    try { browserResults.push(request.postDataJSON() as BrowserResult); } catch { /* the relay will reject malformed browser envelopes */ }
  });
  const mcpUrl = new URL(`${relayUrl}/mcp`); mcpUrl.searchParams.set("sessionId", pair.sessionId);
  const client = new Client({ name: "dronelab-browser-smoke", version: "0.1.0" }, { capabilities: {} });
  transport = new StreamableHTTPClientTransport(mcpUrl, { requestInit: { headers: { Authorization: `Bearer ${relaySecret}`, "X-DroneLab-Pair-Token": pair.mcpToken } } });
  try { await client.connect(transport); }
  catch (error) { throw new Error(`MCP initialization failed; paired browser remained active=${relayApp.relay.isActive(pair.sessionId)}`, { cause: error }); }
  await sleep(100);
  let tools;
  try { tools = await client.listTools(); }
  catch (error) { throw new Error(`MCP list-tools failed; paired browser remained active=${relayApp.relay.isActive(pair.sessionId)}`, { cause: error }); }
  assert(tools.tools.length === 15 && tools.tools.some((tool) => tool.name === "set_mission"), "MCP list-tools did not expose the canonical surface");
  let requestCounter = 0;
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const before = browserResults.length;
    const response = await client.callTool({ name, arguments: { ...args, requestId: `browser-smoke-${++requestCounter}` } });
    assert(!response.isError, `${name} returned an MCP error`);
    return waitForResult(browserResults, before);
  };
  const capabilities = await call("get_capabilities");
  assert(!capabilities.authority, "read-only get_capabilities unexpectedly changed browser authority");
  const observation = await call("get_observation");
  assert(!observation.authority, "read-only get_observation unexpectedly changed browser authority");
  const mission = await call("set_mission", { scenario: "hover" });
  assert(mission.authority?.generation === pair.generation + 1 && mission.authority.epoch === pair.authorityEpoch + 2, "set_mission authority transition did not match browser contract");
  const paused = await call("pause_session");
  assert(paused.authority?.generation === mission.authority.generation && paused.authority.epoch === mission.authority.epoch + 1, "pause_session authority transition did not match browser contract");
  const stopped = await call("stop_session");
  assert(stopped.authority?.generation === paused.authority.generation + 1 && stopped.authority.epoch === paused.authority.epoch + 1, "stop_session authority transition did not match browser contract");

  await page.getByRole("button", { name: "Disconnect" }).click();
  await page.getByText("Disconnected", { exact: true }).waitFor({ timeout: 10_000 });
  let disconnectRejected = false;
  try { disconnectRejected = !!(await client.callTool({ name: "get_capabilities", arguments: { requestId: "after-disconnect" } })).isError; }
  catch { disconnectRejected = true; }
  assert(disconnectRejected, "MCP command succeeded after the browser disconnected");
  await transport.close(); transport = undefined;
  await browser.close(); browser = undefined;
  console.log(`Browser relay smoke passed: tools=${tools.tools.length}, calls=5, authorityUpdates=3, disconnectRejected=true`);
} finally {
  await transport?.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
  await relayApp.close();
}
