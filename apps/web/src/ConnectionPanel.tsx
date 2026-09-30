import { useEffect, useRef, useState } from "react";
import { dispatch } from "./agent-tools";
import { validateAction } from "../../../packages/contracts";

type Pair = {
  sessionId: string;
  browserToken: string;
  mcpToken: string;
  expiresAt: number;
};
export function ConnectionPanel({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState(""),
    [secret, setSecret] = useState(""),
    [status, setStatus] = useState("Not connected"),
    [pair, setPair] = useState<Pair>(),
    [provider, setProvider] = useState("openai"),
    [prompt, setPrompt] = useState("Fly the hover mission."),
    [trace, setTrace] = useState<string[]>([]);
  const [policySource, setPolicySource] = useState("policies");
  const [policySeconds, setPolicySeconds] = useState(5);
  const [policyRunning, setPolicyRunning] = useState(false);
  const policyAbort = useRef<AbortController | undefined>(undefined);
  const abort = useRef<AbortController | undefined>(undefined);
  const pairRef = useRef<Pair | undefined>(undefined);
  const connection = useRef<{ url: string; secret: string }>({
    url: "",
    secret: "",
  });
  const log = (s: string) => setTrace((old) => [...old.slice(-11), s]);
  const disconnect = async () => {
    policyAbort.current?.abort();
    abort.current?.abort();
    const p = pairRef.current;
    pairRef.current = undefined;
    setPair(undefined);
    setStatus("Disconnected");
    if (p) {
      const c = connection.current;
      await fetch(`${c.url}/sessions/${p.sessionId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${c.secret}`,
          "X-DroneLab-Pair-Token": p.browserToken,
        },
      }).catch(() => undefined);
    }
    connection.current = { url: "", secret: "" };
  };
  useEffect(
    () => () => {
      policyAbort.current?.abort();
      abort.current?.abort();
    },
    [],
  );
  const connect = async () => {
    try {
      const target = new URL(url);
      if (
        target.protocol !== "https:" &&
        !(
          target.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(target.hostname)
        )
      )
        throw new Error("Use an HTTPS relay URL");
      if (target.username || target.password || target.search || target.hash)
        throw new Error(
          "Use a plain relay origin without credentials or query parameters",
        );
      if (secret.length < 16)
        throw new Error(
          "Enter the relay access token configured by its operator",
        );
      await disconnect();
      const base = target.origin;
      const controller = new AbortController();
      abort.current = controller;
      connection.current = { url: base, secret };
      setStatus("Pairing…");
      const sim = window.dronelab.sim;
      await sim.ready;
      const response = await fetch(`${base}/sessions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify({
          generation: sim.generation,
          authorityEpoch: sim.epoch,
        }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          data.error?.message ?? `Relay returned ${response.status}`,
        );
      pairRef.current = data;
      setPair(data);
      setStatus("Connected to this browser");
      setSecret("");
      void poll(data, controller);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };
  const poll = async (p: Pair, controller: AbortController) => {
    const c = connection.current;
    const headers = {
      Authorization: `Bearer ${c.secret}`,
      "X-DroneLab-Pair-Token": p.browserToken,
    };
    try {
      while (!controller.signal.aborted) {
        const response = await fetch(`${c.url}/sessions/${p.sessionId}/poll`, {
          headers,
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error?.message ?? "Relay disconnected");
        for (const command of data.commands ?? []) {
          if (controller.signal.aborted) break;
          let result: unknown, error: string | undefined;
          try {
            const sim = window.dronelab.sim;
            if (
              command.generation !== sim.generation ||
              command.authorityEpoch !== sim.epoch ||
              !Number.isFinite(Date.parse(command.expiresAt)) ||
              Date.now() >= Date.parse(command.expiresAt)
            )
              throw new Error("stale_authority");
            result = await dispatch(command.name, command.args);
            log(`${command.name} completed`);
          } catch (e) {
            error = e instanceof Error ? e.message : String(e);
            log(`${command.name}: ${error}`);
          }
          const sim = window.dronelab.sim;
          const reply = await fetch(
            `${c.url}/sessions/${p.sessionId}/results`,
            {
              method: "POST",
              headers: { ...headers, "Content-Type": "application/json" },
              signal: controller.signal,
              body: JSON.stringify({
                commandId: command.id,
                requestId: command.requestId,
                generation: command.generation,
                authorityEpoch: command.authorityEpoch,
                ok: !error,
                ...(error
                  ? { error }
                  : {
                      result: result ?? null,
                      ...(sim.generation !== command.generation ||
                      sim.epoch !== command.authorityEpoch
                        ? {
                            authority: {
                              generation: sim.generation,
                              epoch: sim.epoch,
                            },
                          }
                        : {}),
                    }),
              }),
            },
          );
          if (!reply.ok)
            throw new Error(
              "Relay rejected a result; reconnect to resynchronize",
            );
        }
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setStatus(
          error instanceof Error ? error.message : "Relay disconnected",
        );
        pairRef.current = undefined;
        setPair(undefined);
      }
    }
  };
  const plan = async () => {
    if (!pair) return;
    const c = connection.current;
    const epoch = window.dronelab.sim.epoch,
      generation = window.dronelab.sim.generation;
    try {
      setStatus(`Waiting for ${provider}…`);
      const observation = await dispatch("get_observation");
      const response = await fetch(`${c.url}/providers/${provider}/plan`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${c.secret}`,
          "X-DroneLab-Pair-Token": pair.browserToken,
          "X-DroneLab-Session-Id": pair.sessionId,
          "Content-Type": "application/json",
        },
        signal: abort.current?.signal,
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content: `${prompt}\nCurrent browser observation: ${JSON.stringify(observation)}`,
            },
          ],
          tools: [
            {
              name: "set_mission",
              description:
                "Start a scripted browser mission using local stabilization.",
              inputSchema: {
                type: "object",
                properties: {
                  scenario: {
                    type: "string",
                    enum: ["hover", "gates", "landing", "free"],
                  },
                },
                required: ["scenario"],
                additionalProperties: false,
              },
            },
            {
              name: "stop_session",
              description: "Stop browser flight.",
              inputSchema: {
                type: "object",
                properties: {},
                additionalProperties: false,
              },
            },
          ],
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error?.message ?? "Provider request failed");
      if (
        generation !== window.dronelab.sim.generation ||
        epoch !== window.dronelab.sim.epoch
      )
        throw new Error("Planner response expired after local control changed");
      for (const call of data.calls ?? []) {
        if (!["set_mission", "stop_session"].includes(call.name))
          throw new Error("Provider requested an unoffered tool");
        await dispatch(call.name, call.arguments ?? call.args);
        log(`${provider}/${data.model}: ${call.name}`);
      }
      setStatus(
        `Connected · ${data.calls?.length ?? 0} validated tool requests`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };
  const runPolicy = async () => {
    if (!pair || policyAbort.current) return;
    const control = new AbortController();
    policyAbort.current = control;
    setPolicyRunning(true);
    const c = connection.current;
    let episodeId: string | undefined;
    try {
      let observation = await dispatch("reset_policy_session", { scenario: "hover", seed: 30001, maxSeconds: policySeconds });
      episodeId = observation.episodeId;
      for (let decision = 0; decision < 900 && !observation.terminated && !observation.truncated; decision++) {
        if (control.signal.aborted) break;
        setStatus(`${policySource === "connectome" ? "Connectome" : "Local policy"} · step ${observation.step}`);
        const response = await fetch(`${c.url}/${policySource}/action`, {
          method: "POST", signal: control.signal,
          headers: { Authorization: `Bearer ${c.secret}`, "X-DroneLab-Pair-Token": pair.browserToken, "X-DroneLab-Session-Id": pair.sessionId, "Content-Type": "application/json" },
          body: JSON.stringify({ expectedStep: observation.step, observation: observation.observation }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error?.message ?? "Policy bridge failed");
        if (control.signal.aborted) break;
        const action = validateAction(result.action);
        window.dronelab.policySandbox.annotate(episodeId!, policySource, result.metadata);
        observation = await dispatch("step_policy", { episodeId, expectedStep: observation.step, action });
        if (decision === 0) log(`${policySource}: ${result.metadata?.model ?? "external model"} · ${result.metadata?.datasetVersion ?? "unspecified dataset"}`);
      }
      setStatus(control.signal.aborted ? "Policy evaluation stopped" : `Policy evaluation saved · ${observation.reason || "budget reached"}`);
    } catch (error) {
      setStatus(control.signal.aborted ? "Policy evaluation stopped" : error instanceof Error ? error.message : String(error));
    } finally {
      if (episodeId) await dispatch("finish_policy_session", { episodeId }).catch(() => undefined);
      policyAbort.current = undefined;
      setPolicyRunning(false);
    }
  };
  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label="Connect AI"
    >
      <div>
        <button
          className="close"
          onClick={() => {
            void disconnect();
            onClose();
          }}
          aria-label="Close"
        >
          ×
        </button>
        <div className="eyebrow">OPTIONAL AI CONNECTION</div>
        <h2>Pair this browser</h2>
        <p>
          Fly, train and replay work without a connection. To enable external
          agents, connect a configured DroneLab relay. Provider keys stay on
          that server.
        </p>
        <details>
          <summary>API keys and local setup</summary>
          <p>Configure provider keys in the relay’s .env file. Never paste a provider key into this page. For Ollama or LM Studio, run the relay on the same computer as the model server. A remote relay’s localhost refers to that remote server.</p>
          <p>Start the app and relay locally if browser local-network permissions block a hosted page from pairing with localhost.</p>
          <a href="https://github.com/iecclodd/dronelab/blob/codex/ai-training-integrations/docs/ai-mcp.md" target="_blank" rel="noreferrer">Setup guide and environment variables ↗</a>
        </details>
        <label>
          Relay URL
          <input
            aria-label="Relay URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://127.0.0.1:8787"
            disabled={!!pair}
          />
        </label>
        <label>
          Relay access token
          <input
            aria-label="Relay access token"
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            autoComplete="off"
            disabled={!!pair}
          />
        </label>
        <p role="status">{status}</p>
        <button
          className="primary"
          onClick={() => void (pair ? disconnect() : connect())}
        >
          {pair ? "Disconnect" : "Connect relay"}
        </button>
        {pair && (
          <>
            <p>
              Session <code>{pair.sessionId}</code>
            </p>
            <details>
              <summary>Terminal / MCP client pairing</summary>
              <p>
                Use the relay MCP URL with this session ID. Set the short-lived
                pair token in the X-DroneLab-Pair-Token header.
              </p>
              <code style={{ overflowWrap: "anywhere" }}>{pair.mcpToken}</code>
              <p>Use examples/relay-policy-cli.py from your terminal with this session ID and pair token in environment variables. It calls the simulation API; this page does not execute shell commands.</p>
            </details>
            <label>
              Provider
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
              >
                <option value="openai">OpenAI Responses</option>
                <option value="anthropic">Anthropic Messages</option>
                <option value="gemini">Gemini</option>
                <option value="local">Local · Ollama / LM Studio</option>
              </select>
            </label>
            <label>
              Mission instruction
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                maxLength={2000}
              />
            </label>
            <p>
              The selected provider receives your instruction and state
              observations. No images are sent by this planner flow.
            </p>
            <button disabled={policyRunning} onClick={() => void plan()}>Ask planner</button>
            <hr />
            <div className="eyebrow">TEST AN EXTERNAL POLICY</div>
            <p>Run a pretrained model or fruit fly connectome adapter in a separate research Hover session. State observations go to the configured local runtime. Completed trajectories appear in Flight journal.</p>
            <label>Policy runtime
              <select value={policySource} disabled={policyRunning} onChange={e => setPolicySource(e.target.value)}>
                <option value="policies">Local policy · PyTorch / ONNX / custom</option>
                <option value="connectome">Fruit fly connectome adapter</option>
              </select>
            </label>
            <label>Evaluation seconds
              <input type="number" min="1" max="30" value={policySeconds} disabled={policyRunning} onChange={e => setPolicySeconds(Number(e.target.value))} />
            </label>
            <p>The connectome option requires a running neural model and an explicit sensory/motor mapping. No brain dataset is downloaded by the game.</p>
            <button disabled={policyRunning || !Number.isFinite(policySeconds) || policySeconds < 1 || policySeconds > 30} onClick={() => void runPolicy()}>Run policy evaluation</button>
            <button disabled={!policyRunning} onClick={() => policyAbort.current?.abort()}>Stop policy evaluation</button>
          </>
        )}
        {trace.map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>
    </div>
  );
}
