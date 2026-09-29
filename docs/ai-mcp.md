# Optional AI proxy and MCP browser relay

DroneLab flight, experiments, recording, replay, and browser training do not use this service. `apps/api` is a separate long-running Node 20+ service for an operator who deliberately configures an AI provider proxy or an external MCP client. It never starts, steps, reconstructs, or simulates a DroneLab world. The paired browser worker remains the sole simulation authority.

## Deploy

```powershell
cd apps/api
Copy-Item .env.example .env
npm install
npm run build
npm start
```

Set a high-entropy `DRONELAB_RELAY_SECRET` and exact HTTPS `DRONELAB_ALLOWED_ORIGINS` before starting. Run it on a persistent Node service behind TLS (for example a container, VM, or stateful service). Do not put this relay behind a short-lived serverless function: a browser poll can wait up to 30 seconds and a process retains the paired session and MCP transport state in memory. Every route, including `/healthz`, requires `Authorization: Bearer <DRONELAB_RELAY_SECRET>`.

Never put the relay secret or provider keys in `VITE_*`, a frontend bundle, browser storage, recordings, or exported datasets. A product integration should have an authenticated application backend provide the operator-entered relay secret for the one pairing action, hold it in memory only, and keep the Connect AI feature unconfigured when it cannot do that safely. The static game still works when this service is absent.

## Browser pairing contract

All browser calls also need `Origin` exactly matching `DRONELAB_ALLOWED_ORIGINS`; `*`, missing browser origins, and unlisted origins fail. The token named below is supplied in `X-DroneLab-Pair-Token`, not in a query string.

1. `POST /sessions` creates a short-lived pair with body `{ generation, authorityEpoch }` copied from the current browser worker identity. It returns `{ sessionId, browserToken, mcpToken, generation, authorityEpoch, expiresAt, pollAfterMs }`.
2. The browser sends `GET /sessions/:sessionId/poll` with its `browserToken`. It receives `{ expiresAt, commands: [{ id, requestId, name, args, generation, authorityEpoch, expiresAt }] }`. The outer `expiresAt` is a 15-second-or-less heartbeat deadline; every poll renews it. An empty poll waits only up to `RELAY_POLL_TIMEOUT_MS`.
3. The browser dispatches each command through its canonical worker dispatcher. It must never manufacture a result. It sends `POST /sessions/:sessionId/results` with `{ commandId, requestId, generation, authorityEpoch, authority?, ok, result | error }`. `authority` is `{ generation, epoch }` and is included only when the worker changed it: `pause_session` is same generation/epoch + 1; `set_mission` is generation + 1/epoch + 2; and `cancel_run`, `reset_session`, and `stop_session` are generation + 1/epoch + 1. The envelope remains the command's old authority; the relay atomically accepts the exact newer authority only after that result validates.
4. The browser should stop polling and send `DELETE /sessions/:sessionId` when it closes. Expiry or deletion rejects waiting MCP work.

When a valid canonical mutation response carries a newer authority, the relay rejects old queued work and requires later commands to match the new identity. The relay also enforces a bounded command queue, command deadline, response size, 15-second browser heartbeat, and request-id idempotency. Long browser jobs must return their own job/artifact ID immediately; the browser handles later `get_*_status`, `cancel_run`, or export requests.

## MCP client configuration

The remote endpoint is:

```text
https://relay.example.com/mcp?sessionId=SESSION_ID
```

Configure HTTP headers as `Authorization: Bearer RELAY_SECRET` and `X-DroneLab-Pair-Token: MCP_TOKEN`. The pairing token is deliberately not in the URL, where reverse proxies and client telemetry often retain query strings. The MCP endpoint uses the official `@modelcontextprotocol/sdk` 1.31 Streamable HTTP transport and exposes: `list_scenarios`, `get_capabilities`, `get_observation`, `reset_session`, `set_mission`, `pause_session`, `stop_session`, `start_experiment`, `get_run_status`, `cancel_run`, `start_training`, `get_training_status`, `list_policies`, `capture_frame`, and `export_dataset`.

All tool arguments may include `requestId` for retry-safe mutation and optional `generation`/`authorityEpoch` preconditions. Remaining properties are passed unchanged to the browser canonical dispatcher. `capture_frame` only returns an actual browser-renderer capture when that capability exists; otherwise the browser should return `capability_unavailable`.

`packages/mcp-server` includes `connectDroneLabRelay`, a small official-SDK client helper for an already paired endpoint. The server itself lives with the authenticated HTTP relay in `apps/api` so the two credential checks cannot drift apart.

## Provider proxy

`POST /providers/openai/plan`, `/providers/anthropic/plan`, and `/providers/gemini/plan` accept bounded `{ messages, tools }` input from an allowed origin, plus `X-DroneLab-Session-Id` and the browser pair token. Their keys and models come exclusively from `OPENAI_*`, `ANTHROPIC_*`, and `GEMINI_*` server environment variables. The adapters use native Responses `function_call`/`function_call_output`, Messages `tool_use`/`tool_result`, and Gemini `functionDeclarations`/`functionCall`/`functionResponse` shapes. Requests allow at most two concurrent provider calls, 20 calls per session/provider, `DRONELAB_PROVIDER_CALLS_PER_HOUR` calls per rolling operator hour (60 by default), 1,024 output tokens, and a 2 MiB response body; failed requests still consume budgets, so retries cannot evade them. The hourly counter is in process memory and resets when the relay restarts. The shared relay secret is a single trusted-operator boundary, not a multi-user authorization system. The proxy returns parsed tool calls only, not raw traces. Provider calls were fixture-tested; no provider credentials were present for live verification.

## Checks and limits

```powershell
cd apps/api
npm run build
npm test
npm run smoke
```

The smoke test starts the relay, then uses the actual SDK client to initialize Streamable HTTP, list tools, issue `get_capabilities`, and receive a clearly labelled fixture response from a simulated browser poll client. It does not test a real browser simulation or live provider account.
