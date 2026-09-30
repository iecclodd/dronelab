import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

export const CANONICAL_TOOLS = [
  "list_scenarios", "get_capabilities", "get_observation", "reset_session",
  "set_mission", "pause_session", "stop_session", "start_experiment",
  "get_run_status", "cancel_run", "start_training", "get_training_status",
  "list_policies", "capture_frame", "export_dataset", "reset_policy_session",
  "step_policy", "finish_policy_session", "get_policy_observation",
] as const;
export type CanonicalTool = (typeof CANONICAL_TOOLS)[number];
export type JsonObject = Record<string, unknown>;

export class RelayError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message);
  }
}

export interface RelayConfig {
  secret: string;
  allowedOrigins: Set<string>;
  sessionTtlMs: number;
  commandTtlMs: number;
  pollTimeoutMs: number;
  maxQueue: number;
  maxResultBytes: number;
  maxSessions: number;
  providerCallsPerHour: number;
  bridgeCallsPerHour?: number;
  /** Optional local OpenAI-compatible inference server; loopback only. */
  localModel?: { baseUrl: string; apiKey?: string; model: string };
  /** Optional local state-v1 → nav-action bridge; loopback only. */
  connectome?: { url: string; token?: string };
  /** Optional local arbitrary policy-runtime bridge; loopback only. */
  policy?: { url: string; token?: string };
}

export interface BrowserSession {
  sessionId: string;
  browserToken: string;
  mcpToken: string;
  generation: number;
  authorityEpoch: number;
  expiresAt: string;
  pollAfterMs: number;
}
export interface BrowserAuthority { generation: number; epoch: number; }
export interface PollResult { commands: RelayCommand[]; expiresAt: string; }

export interface RelayCommand {
  id: string;
  requestId: string;
  name: CanonicalTool;
  args: JsonObject;
  generation: number;
  authorityEpoch: number;
  expiresAt: string;
}

interface PendingCommand extends RelayCommand {
  timer: NodeJS.Timeout;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  state: "queued" | "delivered" | "done";
  result?: unknown;
  failure?: RelayError;
  dedupeExpiresAtMs?: number;
}
interface SessionState extends BrowserSession {
  expiresAtMs: number;
  heartbeatExpiresAtMs: number;
  commands: Map<string, PendingCommand>;
  byRequestId: Map<string, PendingCommand>;
  waiters: Set<() => void>;
  closed: boolean;
}

export function configFromEnv(env = process.env): RelayConfig {
  const secret = env.DRONELAB_RELAY_SECRET;
  if (!secret || secret.length < 24) throw new Error("DRONELAB_RELAY_SECRET must be at least 24 characters");
  const origins = (env.DRONELAB_ALLOWED_ORIGINS ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  if (origins.length === 0 || origins.includes("*")) throw new Error("DRONELAB_ALLOWED_ORIGINS must contain exact origins, never *");
  const readPositive = (name: string, fallback: number, maximum: number) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`${name} must be an integer from 1 to ${maximum}`);
    return value;
  };
  const localUrl = (name: string): string | undefined => {
    const value = env[name]?.trim();
    if (!value) return undefined;
    let parsed: URL;
    try { parsed = new URL(value); } catch { throw new Error(`${name} must be an absolute HTTP URL`); }
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !["localhost", "127.0.0.1", "[::1]", "::1"].includes(parsed.hostname) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error(`${name} must be a credential-free loopback HTTP URL`);
    return parsed.toString().endsWith("/") ? parsed.toString() : `${parsed.toString()}/`;
  };
  const localModelUrl = localUrl("DRONELAB_LOCAL_MODEL_URL");
  const localModel = localModelUrl ? { baseUrl: localModelUrl, apiKey: env.DRONELAB_LOCAL_MODEL_API_KEY || undefined, model: env.DRONELAB_LOCAL_MODEL || "" } : undefined;
  if (localModel && !localModel.model) throw new Error("DRONELAB_LOCAL_MODEL is required when DRONELAB_LOCAL_MODEL_URL is set");
  const connectomeUrl = localUrl("DRONELAB_CONNECTOME_URL");
  const policyUrl = localUrl("DRONELAB_POLICY_URL");
  return {
    secret,
    allowedOrigins: new Set(origins),
    sessionTtlMs: readPositive("RELAY_SESSION_TTL_MS", 900_000, 3_600_000),
    commandTtlMs: readPositive("RELAY_COMMAND_TTL_MS", 15_000, 60_000),
    pollTimeoutMs: readPositive("RELAY_POLL_TIMEOUT_MS", 25_000, 30_000),
    maxQueue: readPositive("RELAY_MAX_QUEUE", 32, 128),
    maxResultBytes: readPositive("RELAY_MAX_RESULT_BYTES", 131_072, 1_048_576),
    maxSessions: readPositive("RELAY_MAX_SESSIONS", 100, 10_000),
    providerCallsPerHour: readPositive("DRONELAB_PROVIDER_CALLS_PER_HOUR", 60, 10_000),
    bridgeCallsPerHour: readPositive("DRONELAB_BRIDGE_CALLS_PER_HOUR", 3_600, 10_000),
    localModel,
    connectome: connectomeUrl ? { url: connectomeUrl, token: env.DRONELAB_CONNECTOME_TOKEN || undefined } : undefined,
    policy: policyUrl ? { url: policyUrl, token: env.DRONELAB_POLICY_TOKEN || undefined } : undefined,
  };
}

const token = () => randomBytes(32).toString("base64url");
const fingerprint = (value: string) => createHash("sha256").update(value).digest("hex");

export class BrowserRelay {
  private readonly sessions = new Map<string, SessionState>();
  private static readonly maxRecentRequests = 256;
  constructor(readonly config: RelayConfig) {}

  constantTimeEquals(left: string | undefined, right: string): boolean {
    if (!left) return false;
    const a = Buffer.from(left); const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  assertSecret(received: string | undefined): void {
    if (!this.constantTimeEquals(received, this.config.secret)) throw new RelayError("unauthorized", "invalid relay bearer token", 401);
  }
  assertOrigin(origin: string | undefined): void {
    if (!origin || !this.config.allowedOrigins.has(origin)) throw new RelayError("forbidden_origin", "browser origin is not allowed", 403);
  }
  createSession(authority: BrowserAuthority = { generation: 1, epoch: 0 }): BrowserSession {
    this.expire();
    if (this.sessions.size >= this.config.maxSessions) throw new RelayError("session_limit", "relay session capacity is exhausted", 429);
    const expiresAtMs = Date.now() + this.config.sessionTtlMs;
    if (!Number.isSafeInteger(authority.generation) || authority.generation < 1 || !Number.isSafeInteger(authority.epoch) || authority.epoch < 0) throw new RelayError("invalid_authority", "generation must be positive and authorityEpoch must be non-negative integers");
    const session: SessionState = {
      sessionId: randomUUID(), browserToken: token(), mcpToken: token(), generation: authority.generation,
      authorityEpoch: authority.epoch, expiresAt: new Date(expiresAtMs).toISOString(), expiresAtMs, heartbeatExpiresAtMs: Date.now() + Math.min(15_000, this.config.sessionTtlMs),
      pollAfterMs: Math.min(1_000, this.config.pollTimeoutMs), commands: new Map(), byRequestId: new Map(), waiters: new Set(), closed: false,
    };
    this.sessions.set(session.sessionId, session);
    return this.publicSession(session);
  }
  private publicSession(session: SessionState): BrowserSession {
    return { sessionId: session.sessionId, browserToken: session.browserToken, mcpToken: session.mcpToken, generation: session.generation, authorityEpoch: session.authorityEpoch, expiresAt: session.expiresAt, pollAfterMs: session.pollAfterMs };
  }
  private get(id: string): SessionState {
    this.expire();
    const session = this.sessions.get(id);
    if (!session || session.closed) throw new RelayError("session_not_found", "active session was not found", 404);
    return session;
  }
  assertBrowser(id: string, pairToken: string | undefined): SessionState {
    const session = this.get(id);
    if (!this.constantTimeEquals(pairToken, session.browserToken)) throw new RelayError("forbidden_session", "invalid browser pairing token", 403);
    return session;
  }
  assertMcp(id: string, pairToken: string | undefined): SessionState {
    const session = this.get(id);
    if (!this.constantTimeEquals(pairToken, session.mcpToken)) throw new RelayError("forbidden_session", "invalid MCP pairing token", 403);
    return session;
  }
  private touchBrowser(session: SessionState): string {
    session.heartbeatExpiresAtMs = Math.min(session.expiresAtMs, Date.now() + Math.min(15_000, this.config.sessionTtlMs));
    return new Date(session.heartbeatExpiresAtMs).toISOString();
  }
  private pruneRequestIds(session: SessionState, now = Date.now()): void {
    for (const [requestId, command] of session.byRequestId) {
      if (command.state === "done" && (command.dedupeExpiresAtMs ?? 0) <= now) session.byRequestId.delete(requestId);
    }
    while (session.byRequestId.size > BrowserRelay.maxRecentRequests) {
      const oldestDone = [...session.byRequestId].find(([, command]) => command.state === "done");
      if (!oldestDone) break;
      session.byRequestId.delete(oldestDone[0]);
    }
  }
  private rememberCompletion(session: SessionState, command: PendingCommand): void {
    command.dedupeExpiresAtMs = Math.min(session.expiresAtMs, Date.now() + 60_000);
    this.pruneRequestIds(session);
  }
  private expectedAuthorityUpdate(name: CanonicalTool, session: SessionState): BrowserAuthority | undefined {
    switch (name) {
      case "pause_session": return { generation: session.generation, epoch: session.authorityEpoch + 1 };
      case "set_mission": return { generation: session.generation + 1, epoch: session.authorityEpoch + 2 };
      case "cancel_run":
      case "reset_session":
      case "stop_session": return { generation: session.generation + 1, epoch: session.authorityEpoch + 1 };
      default: return undefined;
    }
  }
  async poll(id: string, browserToken: string | undefined): Promise<PollResult> {
    const session = this.assertBrowser(id, browserToken);
    this.touchBrowser(session);
    const ready = () => [...session.commands.values()].filter((command) => command.state === "queued");
    let commands = ready();
    if (commands.length === 0) await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { session.waiters.delete(wake); resolve(); }, Math.min(this.config.pollTimeoutMs, 15_000));
      const wake = () => { clearTimeout(timer); session.waiters.delete(wake); resolve(); };
      session.waiters.add(wake);
    });
    commands = ready();
    for (const command of commands) command.state = "delivered";
    return { expiresAt: this.touchBrowser(session), commands: commands.map(({ id: commandId, requestId, name, args, generation, authorityEpoch, expiresAt }) => ({ id: commandId, requestId, name, args, generation, authorityEpoch, expiresAt })) };
  }
  submitResult(id: string, browserToken: string | undefined, input: { commandId: string; requestId: string; generation: number; authorityEpoch: number; authority?: BrowserAuthority; ok: boolean; result?: unknown; error?: string }): void {
    const session = this.assertBrowser(id, browserToken);
    this.touchBrowser(session);
    const command = session.commands.get(input.commandId);
    if (!command || command.requestId !== input.requestId) throw new RelayError("unknown_command", "command does not belong to this session", 404);
    if (command.state === "done") return;
    if (input.generation !== command.generation || input.authorityEpoch !== command.authorityEpoch || input.generation !== session.generation || input.authorityEpoch !== session.authorityEpoch) {
      throw new RelayError("stale_generation", "result belongs to an invalidated simulation generation", 409);
    }
    if (input.authority) {
      const expected = this.expectedAuthorityUpdate(command.name, session);
      if (!input.ok || !expected || input.authority.generation !== expected.generation || input.authority.epoch !== expected.epoch) {
        throw new RelayError("invalid_authority_update", "authority update does not match this canonical mutation", 409);
      }
    }
    const body = input.ok ? input.result : { code: "browser_command_failed", message: input.error?.slice(0, 512) || "browser rejected command" };
    if (Buffer.byteLength(JSON.stringify(body ?? null), "utf8") > this.config.maxResultBytes) throw new RelayError("result_too_large", "browser result exceeds relay limit", 413);
    command.state = "done"; command.result = body; clearTimeout(command.timer); session.commands.delete(command.id);
    if (input.authority) {
      session.generation = input.authority.generation; session.authorityEpoch = input.authority.epoch;
      for (const pending of session.commands.values()) if (pending.state !== "done") { pending.state = "done"; clearTimeout(pending.timer); pending.failure = new RelayError("stale_generation", "session state was superseded", 409); this.rememberCompletion(session, pending); pending.reject(pending.failure); }
      session.commands.clear();
    }
    if (!input.ok) command.failure = new RelayError("browser_command_failed", String((body as JsonObject).message), 502);
    this.rememberCompletion(session, command);
    if (input.ok) command.resolve(body);
    else command.reject(command.failure!);
  }
  async issue(id: string, mcpToken: string | undefined, name: CanonicalTool, args: JsonObject, requestId?: string, expectedGeneration?: number, expectedEpoch?: number): Promise<unknown> {
    const session = this.assertMcp(id, mcpToken);
    if (expectedGeneration !== undefined && expectedGeneration !== session.generation) throw new RelayError("stale_generation", "caller has an obsolete session generation", 409);
    if (expectedEpoch !== undefined && expectedEpoch !== session.authorityEpoch) throw new RelayError("stale_epoch", "caller has an obsolete authority epoch", 409);
    const dedupeId = requestId || randomUUID();
    this.pruneRequestIds(session);
    const old = session.byRequestId.get(dedupeId);
    if (old) {
      if (old.name !== name || JSON.stringify(old.args) !== JSON.stringify(args)) throw new RelayError("idempotency_conflict", "requestId was reused with a different command", 409);
      if (old.state === "done") {
        if (old.failure) throw old.failure;
        return old.result;
      }
      return new Promise((resolve, reject) => { const originalResolve = old.resolve; const originalReject = old.reject; old.resolve = (value) => { originalResolve(value); resolve(value); }; old.reject = (error) => { originalReject(error); reject(error); }; });
    }
    if (session.commands.size >= this.config.maxQueue) throw new RelayError("queue_full", "browser command queue is full", 429);
    const expiresAtMs = Math.min(session.expiresAtMs, Date.now() + this.config.commandTtlMs);
    return new Promise<unknown>((resolve, reject) => {
      const command: PendingCommand = {
        id: randomUUID(), requestId: dedupeId, name, args, generation: session.generation, authorityEpoch: session.authorityEpoch,
        expiresAt: new Date(expiresAtMs).toISOString(), state: "queued" as const, resolve, reject,
        timer: undefined as unknown as NodeJS.Timeout,
      };
      command.timer = setTimeout(() => { if (command.state !== "done") { command.state = "done"; session.commands.delete(command.id); command.failure = new RelayError("browser_timeout", "paired browser did not return a result before the deadline", 504); this.rememberCompletion(session, command); reject(command.failure); } }, Math.max(1, expiresAtMs - Date.now()));
      session.commands.set(command.id, command); session.byRequestId.set(dedupeId, command); this.pruneRequestIds(session);
      for (const wake of session.waiters) wake();
    });
  }
  private advance(session: SessionState, reason: string): void {
    for (const command of session.commands.values()) {
      if (command.state !== "done") { command.state = "done"; clearTimeout(command.timer); command.failure = new RelayError("stale_generation", reason, 409); command.reject(command.failure); }
    }
    session.commands.clear(); session.byRequestId.clear();
  }
  expire(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) if (session.expiresAtMs <= now || session.heartbeatExpiresAtMs <= now) {
      session.closed = true; this.advance(session, "browser session expired or disconnected"); this.sessions.delete(id);
    }
  }
  close(id: string): void { const session = this.get(id); session.closed = true; this.advance(session, "browser disconnected"); this.sessions.delete(id); }
  isActive(id: string): boolean { this.expire(); const session = this.sessions.get(id); return !!session && !session.closed; }
  sessionFingerprint(id: string): string { return fingerprint(this.get(id).mcpToken); }
}
