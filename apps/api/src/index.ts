import http from "node:http";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { mcpHandler } from "./mcp.js";
import { invokeProvider, type ProviderName } from "./providers.js";
import { BrowserRelay, RelayError, configFromEnv, type RelayConfig } from "./relay.js";

const bearer = (value: string | undefined) => value?.match(/^Bearer\s+(.+)$/i)?.[1];
const pairToken = (req: Request) => req.header("x-dronelab-pair-token") ?? undefined;
const authoritySchema = z.object({ generation: z.number().int().positive(), epoch: z.number().int().nonnegative() });
const createSessionSchema = z.object({ generation: z.number().int().positive(), authorityEpoch: z.number().int().nonnegative() });
const resultSchema = z.object({ commandId: z.string().uuid(), requestId: z.string().min(1).max(128), generation: z.number().int().positive(), authorityEpoch: z.number().int().nonnegative(), authority: authoritySchema.optional(), ok: z.boolean(), result: z.unknown().optional(), error: z.string().max(512).optional() }).superRefine((value, ctx) => { if (value.ok && value.result === undefined) ctx.addIssue({ code: "custom", message: "successful results must include result" }); if (!value.ok && !value.error) ctx.addIssue({ code: "custom", message: "failed results must include error" }); });
const planSchema = z.object({ messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(16_000) })).min(1).max(20), tools: z.array(z.object({ name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), description: z.string().max(1000), inputSchema: z.record(z.string(), z.unknown()) })).max(32) });

const asyncRoute = (handler: (req: Request, res: Response) => Promise<void> | void) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next);
const requireBrowser = (relay: BrowserRelay) => (req: Request, _res: Response, next: NextFunction) => { try { relay.assertSecret(bearer(req.header("authorization") ?? undefined)); relay.assertOrigin(req.header("origin") ?? undefined); next(); } catch (error) { next(error); } };
const requireRelaySecret = (relay: BrowserRelay) => (req: Request, _res: Response, next: NextFunction) => { try { relay.assertSecret(bearer(req.header("authorization") ?? undefined)); next(); } catch (error) { next(error); } };
const pathValue = (value: string | string[] | undefined) => { if (typeof value !== "string") throw new RelayError("invalid_path", "path parameter must be a single value", 400); return value; };

export interface RelayApp { app: express.Express; relay: BrowserRelay; server: http.Server; close: () => Promise<void>; }
export function createRelayApp(config: RelayConfig = configFromEnv()): RelayApp {
  const relay = new BrowserRelay(config);
  const providerCalls = new Map<string, number>();
  let activeProviderCalls = 0;
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "160kb", type: "application/json" }));
  app.use((req, res, next) => {
    const origin = req.header("origin");
    if (origin && config.allowedOrigins.has(origin)) { res.setHeader("access-control-allow-origin", origin); res.setHeader("vary", "Origin"); res.setHeader("access-control-allow-headers", "authorization, content-type, x-dronelab-pair-token"); res.setHeader("access-control-allow-methods", "GET,POST,DELETE,OPTIONS"); }
    if (req.method === "OPTIONS") return res.sendStatus(origin && config.allowedOrigins.has(origin) ? 204 : 403);
    next();
  });
  app.get("/healthz", requireRelaySecret(relay), (_req, res) => res.json({ ok: true, service: "dronelab-relay" }));
  app.post("/sessions", requireBrowser(relay), (req, res) => { const authority = createSessionSchema.parse(req.body); res.status(201).json(relay.createSession({ generation: authority.generation, epoch: authority.authorityEpoch })); });
  app.get("/sessions/:id/poll", requireBrowser(relay), asyncRoute(async (req, res) => { res.json(await relay.poll(pathValue(req.params.id), pairToken(req))); }));
  app.post("/sessions/:id/results", requireBrowser(relay), (req, res) => { const id = pathValue(req.params.id); const parsed = resultSchema.parse(req.body); relay.submitResult(id, pairToken(req), parsed); res.status(202).json({ accepted: true }); });
  app.delete("/sessions/:id", requireBrowser(relay), (req, res) => { const id = pathValue(req.params.id); relay.assertBrowser(id, pairToken(req)); relay.close(id); res.status(204).end(); });
  app.post("/providers/:provider/plan", requireBrowser(relay), asyncRoute(async (req, res) => {
    const provider = req.params.provider;
    if (provider !== "openai" && provider !== "anthropic" && provider !== "gemini") throw new RelayError("unknown_provider", "provider must be openai, anthropic, or gemini", 404);
    const input = planSchema.parse(req.body);
    const sessionId = req.header("x-dronelab-session-id") ?? undefined;
    const browserToken = pairToken(req);
    if (!sessionId || !browserToken) throw new RelayError("missing_pairing", "provider requests require X-DroneLab-Session-Id and X-DroneLab-Pair-Token", 401);
    relay.assertBrowser(sessionId, browserToken);
    const budgetKey = `${sessionId}:${provider}`;
    const calls = providerCalls.get(budgetKey) ?? 0;
    if (calls >= 20) throw new RelayError("provider_budget_exhausted", "per-session provider call budget is exhausted", 429);
    if (activeProviderCalls >= 2) throw new RelayError("provider_busy", "provider concurrency limit reached", 429);
    providerCalls.set(budgetKey, calls + 1); activeProviderCalls += 1;
    const env = process.env;
    const upper = provider.toUpperCase();
    let output;
    try { output = await invokeProvider(provider as ProviderName, { key: env[`${upper}_API_KEY`], model: env[`${upper}_MODEL`], timeoutMs: 20_000 }, input); }
    finally { activeProviderCalls -= 1; }
    // Raw provider payload is intentionally excluded: it can contain extra billing or trace data.
    res.json({ provider, model: env[`${upper}_MODEL`], calls: output.calls });
  }));
  app.all("/mcp", mcpHandler(relay));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const known = error instanceof RelayError ? error : error instanceof z.ZodError ? new RelayError("invalid_request", "request did not match the relay contract", 400) : new RelayError("internal_error", "relay request failed", 500);
    if (!res.headersSent) res.status(known.status).json({ error: { code: known.code, message: known.message } });
  });
  const server = http.createServer(app);
  return { app, relay, server, close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

const isMain = process.argv[1] && new URL(import.meta.url).pathname === new URL(`file:${process.argv[1].replaceAll("\\", "/")}`).pathname;
if (isMain) {
  const { server } = createRelayApp();
  const port = Number(process.env.PORT ?? 8787);
  server.listen(port, "0.0.0.0", () => console.log(`DroneLab relay listening on ${port}`));
}
