# Optional AI proxy and MCP browser relay

DroneLab flight, experiments, recording, replay, and browser training do not use this service. `apps/api` is a separate long-running Node 20+ service for an operator who deliberately configures an AI provider proxy or an external MCP client. It never starts, steps, reconstructs, or simulates a DroneLab world. The paired browser worker remains the sole simulation authority.

## Deploy

```powershell
cd apps/api
npm ci
Copy-Item .env.example .env
# Set DRONELAB_RELAY_SECRET and exact DRONELAB_ALLOWED_ORIGINS in .env.
npm run build
npx tsx test/browser-smoke.ts
node --env-file=.env dist/index.js
```

Set a high-entropy `DRONELAB_RELAY_SECRET` and exact HTTPS `DRONELAB_ALLOWED_ORIGINS` before starting. Run it on a persistent Node service behind TLS (for example a container, VM, or stateful service). Do not put this relay behind a short-lived serverless function: a browser poll can wait up to 30 seconds and a process retains the paired session and MCP transport state in memory. Every route, including `/healthz`, requires `Authorization: Bearer <DRONELAB_RELAY_SECRET>`.

Never put the relay secret or provider keys in `VITE_*`, a frontend bundle, browser storage, recordings, or exported datasets. A product integration should have an authenticated application backend provide the operator-entered relay secret for the one pairing action, hold it in memory only, and keep the Connect AI feature unconfigured when it cannot do that safely. The static game still works when this service is absent.

## Local quick start (macOS/Linux)

From the repository root, start the website with `npm ci && npm run dev`. In another terminal:

```sh
cd apps/api
npm ci
cp .env.example .env
openssl rand -base64 48
# Put the generated secret in .env as DRONELAB_RELAY_SECRET.
# Set DRONELAB_ALLOWED_ORIGINS=http://127.0.0.1:5173 exactly.
# Set DRONELAB_LOCAL_MODEL to a tool-capable model you already run.
# Ollama root URL: http://127.0.0.1:11434/
# LM Studio root URL: http://127.0.0.1:1234/
npm run build
node --env-file=.env dist/index.js
```

Open AI Lab → Connect AI, pair `http://127.0.0.1:8787` using the relay secret,
then choose Local for planner tool calls. The selected model must support tool calling. Protocol references: [Ollama](https://docs.ollama.com/api/openai-compatibility) and [LM Studio](https://lmstudio.ai/docs/developer/openai-compat).
Provider API keys belong only in `.env`; they are not the relay pairing secret.

For an arbitrary local policy, implement `policy(request)` returning the documented
`{action, metadata}` response. From the repository root:

```sh
DRONELAB_POLICY_CALLABLE=/absolute/path/to/your_policy.py:policy \
DRONELAB_POLICY_BRIDGE_TOKEN=your-separate-local-bridge-token \
python3 examples/policy_bridge.py
```

Set `DRONELAB_POLICY_URL=http://127.0.0.1:8790/` and the same
`DRONELAB_POLICY_TOKEN` in the relay `.env`, restart the relay, re-pair, and choose
Local policy → Run policy evaluation. For a connectome runtime use the equivalent
`DRONELAB_CONNECTOME_URL/TOKEN` settings. Only load trusted local Python modules:
the chosen callable runs in your Python process; the bridge is not an OS sandbox.

For terminal control, open Terminal / MCP client pairing in the connected browser,
set the four variables documented below in your shell, then run:

```sh
python3 examples/relay-policy-cli.py reset '{"scenario":"hover","seed":30001,"maxSeconds":5}'
python3 examples/relay-policy-cli.py status
# Use the returned episodeId and step for subsequent step calls.
```

Keep the browser open and paired. The CLI's export command returns a browser artifact
reference; download the full ZIP through Flight journal. Cloud keys, a model download,
and a full connectome are not required to use browser-only experiments.

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

Configure HTTP headers as `Authorization: Bearer RELAY_SECRET` and `X-DroneLab-Pair-Token: MCP_TOKEN`. The pairing token is deliberately not in the URL, where reverse proxies and client telemetry often retain query strings. The MCP endpoint uses the official `@modelcontextprotocol/sdk` 1.31 Streamable HTTP transport and exposes: `list_scenarios`, `get_capabilities`, `get_observation`, `reset_session`, `set_mission`, `pause_session`, `stop_session`, `start_experiment`, `get_run_status`, `cancel_run`, `start_training`, `get_training_status`, `list_policies`, `capture_frame`, `export_dataset`, `reset_policy_session`, `step_policy`, `get_policy_observation`, and `finish_policy_session`.

All tool arguments may include `requestId` for retry-safe mutation and optional `generation`/`authorityEpoch` preconditions. Remaining properties are passed unchanged to the browser canonical dispatcher. `capture_frame` only returns an actual browser-renderer capture when that capability exists; otherwise the browser should return `capability_unavailable`.

`packages/mcp-server` includes `connectDroneLabRelay`, a small official-SDK client helper for an already paired endpoint. The server itself lives with the authenticated HTTP relay in `apps/api` so the two credential checks cannot drift apart.

## Provider proxy

`POST /providers/openai/plan`, `/providers/anthropic/plan`, `/providers/gemini/plan`, and `/providers/local/plan` accept bounded `{ messages, tools }` input from an allowed origin, plus `X-DroneLab-Session-Id` and the browser pair token. Their keys and models come exclusively from server environment variables. The first three use `OPENAI_*`, `ANTHROPIC_*`, and `GEMINI_*`; `local` uses `DRONELAB_LOCAL_MODEL_URL`, `DRONELAB_LOCAL_MODEL`, and an optional `DRONELAB_LOCAL_MODEL_API_KEY`. Local is the OpenAI-compatible Chat Completions tool-calling surface used by Ollama and LM Studio. Its URL must be a loopback HTTP URL, so it works only when the relay runs on the same computer as the local model. The adapters use native Responses `function_call`/`function_call_output`, Messages `tool_use`/`tool_result`, Gemini `functionDeclarations`/`functionCall`/`functionResponse`, and OpenAI-compatible `tool_calls` shapes. Requests allow at most two concurrent provider calls, 20 calls per session/provider, `DRONELAB_PROVIDER_CALLS_PER_HOUR` calls per rolling operator hour (60 by default), 1,024 output tokens, and a 2 MiB response body; failed requests still consume budgets, so retries cannot evade them. The hourly counter is in process memory and resets when the relay restarts. The shared relay secret is a single trusted-operator boundary, not a multi-user authorization system. The proxy returns parsed tool calls only, not raw traces. Provider calls were fixture-tested; no provider credentials were present for live verification.

## Policy sandbox, local models, and terminal use

The policy sandbox is a separate browser-owned lockstep environment. It does not control the playable game and it never connects to a physical drone. `reset_policy_session` returns its first `state-v1` observation; `step_policy` validates `episodeId` and `expectedStep` then advances exactly four simulation ticks; `get_policy_observation` does not advance it; `finish_policy_session` ends it and preserves the journal record. In-progress external episodes checkpoint every 120 transitions; a tab crash may lose the most recent unflushed transitions. The accepted action is `{ "kind": "nav", "velocity": [0, 0, 0], "yawRate": 0 }`: velocity is ENU world-frame m/s with every component in `[-3, 3]`, and yaw rate is rad/s in `[-1.5, 1.5]`.

For terminal workflows, use the paired MCP endpoint rather than exposing a shell on the relay. [`examples/relay-policy-cli.py`](../examples/relay-policy-cli.py) is a standard-library Python client for `status`, `reset`, `step`, `finish`, and `export`; it executes no local command on behalf of the relay. It needs `DRONELAB_RELAY_URL`, `DRONELAB_RELAY_SECRET`, `DRONELAB_SESSION_ID`, and `DRONELAB_MCP_TOKEN` in its environment.

## Connectome and arbitrary runtime bridges

`POST /connectome/action` forwards to an operator-run `DRONELAB_CONNECTOME_URL`; `POST /policies/action` forwards to `DRONELAB_POLICY_URL`, which can front an ONNX Runtime, PyTorch, or other local policy process. Both URLs are restricted to loopback addresses and each may have a separate bearer token (`DRONELAB_CONNECTOME_TOKEN` or `DRONELAB_POLICY_TOKEN`). A hosted relay therefore cannot reach a model that is only running on an operator's laptop.

Bridge inference is bounded to two concurrent calls, 1,024 calls per browser session and bridge kind, and `DRONELAB_BRIDGE_CALLS_PER_HOUR` operator calls (3,600 by default). The session allowance covers the policy sandbox's maximum 30-second horizon: 900 four-tick decisions at 120 Hz, with room for retries.

Both bridges receive `POST /v1/action` with `{ "expectedStep": 120, "observation": { "version": "state-v1", "deliveryStep": 120, "...": "complete state-v1 observation" } }`. `expectedStep` must equal `observation.deliveryStep`. They must return `{ "action": { "kind": "nav", "velocity": [0, 0, 0], "yawRate": 0 }, "metadata": { "datasetVersion": "…", "model": "…", "mappingVersion": "…" } }`. The relay rejects invalid, stale-shaped, motor-command, extra-field, or out-of-bounds actions before they reach the policy sandbox.

[`examples/policy_bridge.py`](../examples/policy_bridge.py) is a runnable dependency-free loopback bridge host. It loads only an explicitly selected local Python callable and validates both sides of this protocol. [`examples/example_connectome_mapping.py`](../examples/example_connectome_mapping.py) shows a transparent firing-rate-to-ENU readout mapping. Replace its sensory encoding and rates function with a selected, versioned dataset/model; it is deliberately not presented as a FlyWire or hemibrain runtime.

This is a runtime adapter, not a claim that DroneLab embeds or simulates a fruit-fly connectome. The required dataset, model, and mapping versions make FlyWire, hemibrain, NeuPrint-derived, hand-designed, and pretrained policy traces attributable in the flight journal.

## Checks and limits

```powershell
cd apps/api
npm run build
npm test
npm run smoke
```

The smoke test starts the relay, then uses the actual SDK client to initialize Streamable HTTP, list tools, issue `get_capabilities`, and receive a clearly labelled fixture response from a simulated browser poll client. It does not test a real browser simulation or live provider account.

The production browser bridge command is `npx tsx test/browser-smoke.ts`. It runs against the configured production URL and exercises pairing, MCP tool calls, authority changes, and disconnect rejection; it requires a running relay and browser URL. Provider credentials were not configured, so live provider calls remain unverified.

The browser worker bounds replay results to a 4 MB cache, 60-second TTL, and 128 entries. Results too large to replay return `result_replay_unavailable`. A batch accepts 1–32 episodes but rejects more than 20,000 total decisions; individual advance requests are capped at 1,200 ticks. The relay queue defaults to 32 and is bounded by the configured maximum of 128.
