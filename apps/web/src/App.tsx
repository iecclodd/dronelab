import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { FlightScene, type CameraMode } from "./Scene";
import { ConnectionPanel } from "./ConnectionPanel";
import { SimulationClient } from "./simulation";
import { TrainingClient, type TrainingProgress } from "./learning";
import {
  appendChunk,
  deleteRun,
  download,
  exportRun,
  listPolicies,
  listRuns,
  savePolicy,
  saveRun,
} from "./storage";
import {
  DEFAULT_CONFIG,
  type Action,
  type ControllerId,
  type PhysicalState,
  type PolicyCheckpoint,
  type RunRecord,
  type Scenario,
  type ScenarioId,
  type SimConfig,
  type V3,
} from "../../../packages/contracts";

import { wilson } from "../../../packages/learning";

type View = "Fly" | "Experiment" | "Review";
const missions: { id: ScenarioId; label: string; detail: string }[] = [
  { id: "hover", label: "Hover", detail: "Stabilize on target" },
  { id: "gates", label: "Gates", detail: "Pass sequential gates" },
  { id: "landing", label: "Landing", detail: "Controlled descent" },
  { id: "free", label: "Free flight", detail: "Open test range" },
];
const controllers: ControllerId[] = [
  "manual",
  "rate",
  "scripted",
  "random",
  "learned",
];
const n = (value: number, digits = 1) =>
  Number.isFinite(value) ? value.toFixed(digits) : "—";
const mean = (runs: RunRecord[], f: (r: RunRecord) => number) =>
  runs.length ? runs.reduce((x, r) => x + f(r), 0) / runs.length : 0;
type Evaluation = Partial<Record<ControllerId, RunRecord[]>>;
class SceneGuard extends Component<
  { children: ReactNode; onFailure: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFailure();
  }
  render() {
    return this.state.failed ? (
      <div className="webgl-error" role="alert">
        <b>3D renderer unavailable</b>
        <span>
          Your browser or graphics driver did not start WebGL. Flight controls
          and saved records remain available.
        </span>
      </div>
    ) : (
      this.props.children
    );
  }
}

export default function App() {
  const sim = useRef<SimulationClient | undefined>(undefined);
  const batch = useRef<SimulationClient | undefined>(undefined);
  const trainer = useRef<TrainingClient | undefined>(undefined);
  const stateRef = useRef<PhysicalState | undefined>(undefined);
  const ghostRef = useRef<PhysicalState | undefined>(undefined);
  const captureRef = useRef<
    (() => { step: number; dataUrl: string }) | undefined
  >(undefined);
  const attachCapture = useCallback(
    (fn: (() => { step: number; dataUrl: string }) | undefined) => {
      captureRef.current = fn;
    },
    [],
  );
  const keys = useRef(new Set<string>());
  const latestStep = useRef(0);
  const lastUi = useRef(0);
  const alive = useRef(false);
  const cancelled = useRef(false);
  const gamepadZero = useRef<number[]>([]);
  const modeRef = useRef("paused");
  const [batchProgress, setBatchProgress] = useState("");
  const [view, setView] = useState<View>(
      location.hash === "#experiment"
        ? "Experiment"
        : location.hash === "#review"
          ? "Review"
          : "Fly",
    ),
    [config, setConfig] = useState<SimConfig>({ ...DEFAULT_CONFIG }),
    [controller, setController] = useState<ControllerId>("manual"),
    [scenario, setScenario] = useState<Scenario>(),
    [flight, setFlight] = useState<PhysicalState>(),
    [observation, setObservation] = useState<unknown>(),
    [mode, setMode] = useState("paused"),
    [path, setPath] = useState<V3[]>([]),
    [camera, setCamera] = useState<CameraMode>("Chase"),
    [fps, setFps] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true),
    [runs, setRuns] = useState<RunRecord[]>([]),
    [policies, setPolicies] = useState<PolicyCheckpoint[]>([]),
    [policyId, setPolicyId] = useState(""),
    [training, setTraining] = useState<TrainingProgress[]>([]),
    [experiment, setExperiment] = useState<RunRecord[]>([]),
    [experimentControl, setExperimentControl] =
      useState<ControllerId>("scripted"),
    [evaluation, setEvaluation] = useState<Evaluation>({}),
    [budget, setBudget] = useState(4),
    [selected, setSelected] = useState<RunRecord>(),
    [scrub, setScrub] = useState(0),
    [ai, setAi] = useState(false),
    [gamepad, setGamepad] = useState("Keyboard");
  const policy = policies.find((p) => p.id === policyId);
  useEffect(() => {
    history.replaceState(null, "", "#" + view.toLowerCase());
  }, [view]);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  const report = useCallback(
    (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    [],
  );
  const refresh = useCallback(async () => {
    try {
      setRuns(await listRuns());
      setPolicies(await listPolicies());
    } catch (e) {
      report(e);
    }
  }, [report]);
  const reset = useCallback(
    async (next = config, control = controller) => {
      try {
        setBusy(true);
        modeRef.current = "paused";
        const result = await sim.current!.request<any>("reset", {
          config: next,
          controller: control,
          policy: control === "learned" ? policy : undefined,
        });
        if (!alive.current) return;
        stateRef.current = result.state;
        latestStep.current = result.state.step;
        setFlight(result.state);
        setScenario(result.scenario);
        setConfig(next);
        setController(control);
        setMode(result.mode);
        setPath([result.state.position]);
        setSelected(undefined);
        setError("");
      } catch (e) {
        if (alive.current) report(e);
        throw e;
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [config, controller, policy, report],
  );
  useEffect(() => {
    let active = true;
    const a = new SimulationClient(),
      b = new SimulationClient(),
      t = new TrainingClient();
    alive.current = true;
    sim.current = a;
    batch.current = b;
    trainer.current = t;
    const unsubscribeBatch = b.subscribe((message) => {
      if (active && message.type === "progress") {
        const p = message.payload as {
          completed: number;
          total: number;
          episodeStep: number;
        };
        setBatchProgress(
          `${p.completed} / ${p.total} episodes · step ${p.episodeStep}`,
        );
      }
    });
    const unsubscribe = a.subscribe((message) => {
      if (!active) return;
      const p = message.payload as any;
      if (message.type === "snapshot" && p?.state) {
        if (modeRef.current === "replay") return;
        stateRef.current = p.state;
        latestStep.current = p.state.step;
        setObservation(p.observation);
        modeRef.current = p.mode || "paused";
        setMode(p.mode || "paused");
        if (p.scenario) setScenario(p.scenario);
        if (p.config) setConfig(p.config);
        if (p.controller) setController(p.controller);
        setPath((old) => [...old.slice(-499), p.state.position]);
        const now = performance.now();
        if (now - lastUi.current > 100) {
          lastUi.current = now;
          setFlight(p.state);
        }
      }
      if (message.type === "chunk" && p)
        void appendChunk(p.id, Date.now(), p.transitions).catch(report);
      if (message.type === "run" && p)
        void saveRun(p).then(refresh).catch(report);
      if (message.type === "interruption") {
        modeRef.current = "paused";
        setMode("paused");
      }
      if (message.type === "interruption" || message.type === "overload")
        setError(p?.reason || "Tab paused. Resume explicitly.");
    });
    void a.ready
      .then(() => {
        if (active) return reset();
      })
      .catch((e) => {
        if (active) report(e);
      });
    void refresh();
    return () => {
      active = false;
      alive.current = false;
      unsubscribe();
      unsubscribeBatch();
      a.dispose();
      b.dispose();
      t.dispose();
      if (sim.current === a) sim.current = undefined;
      if (batch.current === b) batch.current = undefined;
      if (trainer.current === t) trainer.current = undefined;
    };
  }, []); // clients are intentionally created once
  useEffect(() => {
    const clear = () => {
      keys.current.clear();
      if (modeRef.current === "realtime")
        void sim.current
          ?.request("mode", { mode: "paused" })
          .then(() => {
            if (alive.current) {
              setMode("paused");
              setError(
                "Flight paused because the window lost focus. Resume explicitly.",
              );
            }
          })
          .catch(report);
    };
    const down = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (
        ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName) ||
        el.isContentEditable
      )
        return;
      if (
        [
          "KeyW",
          "KeyA",
          "KeyS",
          "KeyD",
          "Space",
          "ShiftLeft",
          "ShiftRight",
          "KeyQ",
          "KeyE",
        ].includes(e.code)
      ) {
        e.preventDefault();
        keys.current.add(e.code);
      }
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.code);
    const visibility = () => {
      if (document.hidden) clear();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", visibility);
    const id = window.setInterval(() => {
      if (
        modeRef.current !== "realtime" ||
        !["manual", "rate"].includes(controller)
      )
        return;
      const k = keys.current;
      const gp = navigator.getGamepads?.().find(Boolean);
      const axis = (i: number) =>
        Math.max(
          -1,
          Math.min(1, (gp?.axes[i] ?? 0) - (gamepadZero.current[i] ?? 0)),
        );
      let action: Action;
      if (controller === "rate") {
        action = {
          kind: "rate",
          rates: [
            (k.has("KeyW") ? 1 : 0) - (k.has("KeyS") ? 1 : 0) || -axis(1),
            (k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0) || axis(0),
            (k.has("KeyE") ? 1 : 0) - (k.has("KeyQ") ? 1 : 0) || axis(2),
          ],
          thrust: Math.max(
            0,
            Math.min(
              1,
              0.42 +
                (k.has("Space") ? 0.22 : 0) -
                (k.has("ShiftLeft") || k.has("ShiftRight") ? 0.22 : 0) -
                axis(3) * 0.28,
            ),
          ),
        };
      } else
        action = {
          kind: "nav",
          velocity: [
            (k.has("KeyD") ? 3 : 0) - (k.has("KeyA") ? 3 : 0) || axis(0) * 3,
            (k.has("KeyW") ? 3 : 0) - (k.has("KeyS") ? 3 : 0) || -axis(1) * 3,
            (k.has("Space") ? 3 : 0) -
              (k.has("ShiftLeft") || k.has("ShiftRight") ? 3 : 0),
          ],
          yawRate:
            (k.has("KeyE") ? 1.5 : 0) - (k.has("KeyQ") ? 1.5 : 0) ||
            axis(2) * 1.5,
        };
      void sim.current?.request("action", { action }).catch(() => undefined);
    }, 65);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", visibility);
      clearInterval(id);
    };
  }, [controller, report]);
  useEffect(() => {
    const id = window.setInterval(() => {
      const gp = navigator.getGamepads?.().find(Boolean);
      setGamepad(gp ? `${gp.id.slice(0, 22)} connected` : "Keyboard only");
    }, 900);
    return () => clearInterval(id);
  }, []);
  const chooseMission = (id: ScenarioId) => {
    if (busy) return;
    const next = { ...config, scenario: id };
    setConfig(next);
    void reset(next).catch(report);
  };
  const chooseController = async (c: ControllerId) => {
    if (c === "learned" && !policy) {
      setError("Select a saved policy before choosing Learned.");
      return;
    }
    try {
      await sim.current!.request("controller", {
        controller: c,
        policy: c === "learned" ? policy : undefined,
      });
      setController(c);
      setError("");
    } catch (e) {
      report(e);
    }
  };
  const start = async (overrides?: {
    controller?: ControllerId;
    config?: Partial<SimConfig>;
  }): Promise<void> => {
    try {
      setBusy(true);
      modeRef.current = "paused";
      setSelected(undefined);
      const next = { ...config, ...overrides?.config };
      const nextController = overrides?.controller ?? controller;
      if (nextController === "learned" && !policy)
        throw new Error("Select a saved policy before flying Learned.");
      setConfig(next);
      setController(nextController);
      const fresh = await sim.current!.request<any>("reset", {
        config: next,
        controller: nextController,
        policy: nextController === "learned" ? policy : undefined,
      });
      if (!alive.current) return;
      stateRef.current = fresh.state;
      latestStep.current = fresh.state.step;
      setFlight(fresh.state);
      setScenario(fresh.scenario);
      setPath([fresh.state.position]);
      const record = await sim.current!.request<RunRecord>("record");
      await saveRun(record);
      await sim.current!.request("mode", { mode: "realtime" });
      modeRef.current = "realtime";
      setMode("realtime");
      setError("");
    } catch (e) {
      report(e);
      throw e;
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const cancelWork = async (): Promise<void> => {
    cancelled.current = true;
    trainer.current?.cancel();
    await batch.current?.request("stop");
  };
  const stop = async (): Promise<void> => {
    await Promise.all([sim.current?.request("stop"), cancelWork()]);
    modeRef.current = "paused";
    if (alive.current) setMode("paused");
  };
  const pauseFlight = async (): Promise<void> => {
    await sim.current!.request("mode", { mode: "paused" });
    modeRef.current = "paused";
    setMode("paused");
  };
  const pause = async () => {
    try {
      const next = modeRef.current === "paused" ? "realtime" : "paused";
      await sim.current!.request("mode", {
        mode: next,
      });
      modeRef.current = next;
      setMode(next);
    } catch (e) {
      report(e);
    }
  };
  const runExperiment = async (): Promise<RunRecord[] | void> => {
    try {
      if (experimentControl === "learned" && !policy)
        throw new Error("Select a trained policy for the learned controller.");
      cancelled.current = false;
      setBusy(true);
      setExperiment([]);
      setBatchProgress("Starting episodes…");
      const configs = Array.from({ length: budget }, (_, i) => ({
        ...config,
        seed: config.seed + i,
      }));
      const result = await batch.current!.request<RunRecord[]>("batch", {
        configs,
        control: experimentControl,
        checkpoint: experimentControl === "learned" ? policy : undefined,
      });
      if (cancelled.current) return;
      setExperiment(result);
      await Promise.all(result.map(saveRun));
      await refresh();
      return result;
    } catch (e) {
      if (!cancelled.current) report(e);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const train = async (): Promise<PolicyCheckpoint | void> => {
    const fixed = { ...config, scenario: "hover" as ScenarioId };
    try {
      cancelled.current = false;
      setBusy(true);
      setTraining([]);
      setBatchProgress("Collecting demonstrations…");
      const seeds = [
        ...Array.from({ length: 12 }, (_, i) => 10001 + i),
        ...Array.from({ length: 4 }, (_, i) => 20001 + i),
      ];
      const configs = seeds.map((seed) => ({ ...fixed, seed }));
      const data = await batch.current!.request<RunRecord[]>("batch", {
        configs,
        control: "scripted",
      });
      if (cancelled.current) return;
      const checkpoint = await trainer.current!.start(
        data.map((r) => ({ seed: r.config.seed, transitions: r.transitions })),
        fixed,
        (p) => {
          if (!cancelled.current) setTraining((old) => [...old, p]);
        },
      );
      if (cancelled.current) return;
      await savePolicy(checkpoint);
      await refresh();
      setPolicyId(checkpoint.id);
      setError("Policy saved. Evaluate it on held-out seeds.");
      return checkpoint;
    } catch (e) {
      if (!cancelled.current) report(e);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const evaluate = async (): Promise<RunRecord[] | void> => {
    if (!policy) {
      setError("Choose a trained policy to evaluate.");
      return;
    }
    try {
      cancelled.current = false;
      setBusy(true);
      setEvaluation({});
      const configs = Array.from({ length: 8 }, (_, i) => ({
        ...policy.config,
        seed: 30001 + i,
      }));
      const all: RunRecord[] = [];
      for (const control of [
        "scripted",
        "random",
        "learned",
      ] as ControllerId[]) {
        const result = await batch.current!.request<RunRecord[]>("batch", {
          configs,
          control,
          checkpoint: control === "learned" ? policy : undefined,
        });
        if (cancelled.current) return;
        all.push(...result);
        setEvaluation((old) => ({ ...old, [control]: result }));
        await Promise.all(result.map(saveRun));
      }
      await refresh();
      return all;
    } catch (e) {
      if (!cancelled.current) report(e);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const playback = (run: RunRecord, index: number) => {
    void sim.current
      ?.request("mode", { mode: "paused" })
      .catch(() => undefined);
    setSelected(run);
    setScrub(index);
    void sim.current
      ?.request<Scenario>("scenario", { config: run.config })
      .then(setScenario)
      .catch(report);
    const transition = run.transitions[index];
    if (transition) {
      ghostRef.current = transition.state;
      stateRef.current = transition.state;
      setFlight(transition.state);
      setPath(run.transitions.slice(0, index + 1).map((t) => t.state.position));
      setMode("replay");
    }
  };
  const capture = async (
    expectedStep?: number,
  ): Promise<{ step: number; dataUrl: string }> => {
    const item = captureRef.current?.();
    if (!item) throw new Error("Canvas capture is unavailable.");
    if (
      modeRef.current !== "paused" ||
      item.step !== latestStep.current ||
      (expectedStep !== undefined && item.step !== expectedStep)
    )
      throw new Error("Pause at the expected simulation step before capture.");
    return item;
  };
  const downloadCapture = () =>
    void capture()
      .then((item) => {
        const a = document.createElement("a");
        a.href = item.dataUrl;
        a.download = `dronelab-step-${item.step}.png`;
        a.click();
      })
      .catch(report);
  useEffect(() => {
    (window as any).dronelab = {
      sim: sim.current,
      batch: batch.current,
      trainer: trainer.current,
      getState: () => ({
        config,
        currentConfig: config,
        controller,
        policies,
        runs,
        view,
        training,
        busy,
        state: stateRef.current,
        observation,
        error,
        mode: modeRef.current,
        rgbAvailable: !!captureRef.current,
      }),
      setView,
      startFlight: start,
      stop,
      cancelWork,
      pauseFlight,
      resetFlight: (options?: Partial<SimConfig>) =>
        reset({ ...config, ...options }),
      runExperiment,
      train,
      evaluate,
      selectRun: (id: string) => {
        const r = runs.find((x) => x.id === id);
        if (r) playback(r, 0);
      },
      captureFrame: capture,
    };
  }, [
    config,
    controller,
    policies,
    runs,
    view,
    training,
    busy,
    observation,
    mode,
    policyId,
    experimentControl,
    budget,
    error,
  ]);
  const lossPath = useMemo(
    () =>
      training
        .map(
          (p, i) =>
            `${i ? `${(i * 100) / Math.max(1, training.length - 1)},${90 - p.loss * 80}` : `0,${90 - p.loss * 80}`}`,
        )
        .join(" "),
    [training],
  );
  const selectedMission = missions.find((m) => m.id === config.scenario)!;
  return (
    <div className="app">
      <header>
        <button
          className="brand"
          onClick={() => setView("Fly")}
          aria-label="DroneLab home"
        >
          <i />
          DRONELAB <small>FLIGHT RESEARCH</small>
        </button>
        <nav aria-label="Primary navigation">
          {(["Fly", "Experiment", "Review"] as View[]).map((v) => (
            <button
              key={v}
              className={view === v ? "active" : ""}
              onClick={() => setView(v)}
            >
              {v}
            </button>
          ))}
        </nav>
        <button className="connect" onClick={() => setAi(true)}>
          Connect AI <span>↗</span>
        </button>
      </header>
      {error && (
        <div className="notice" role="alert">
          {error}
          <button aria-label="Dismiss message" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
      <main>
        <aside className="sidebar">
          <div className="eyebrow">MISSION / 01</div>
          <h1>{view === "Fly" ? selectedMission.label : view}</h1>
          {view === "Fly" && (
            <>
              <div className="mission-list">
                {missions.map((m) => (
                  <button
                    key={m.id}
                    disabled={busy}
                    className={config.scenario === m.id ? "selected" : ""}
                    onClick={() => chooseMission(m.id)}
                  >
                    <b>{m.label}</b>
                    <span>{m.detail}</span>
                  </button>
                ))}
              </div>
              <label>
                Controller
                <select
                  value={controller}
                  disabled={busy}
                  onChange={(e) =>
                    void chooseController(e.target.value as ControllerId)
                  }
                  aria-label="Controller"
                >
                  {controllers.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              {controller === "learned" && (
                <>
                  <label>
                    Policy
                    <select
                      value={policyId}
                      onChange={(e) => setPolicyId(e.target.value)}
                      aria-label="Saved policy"
                    >
                      <option value="">Select policy</option>
                      {policies.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.id}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="wide"
                    disabled={!policyId || busy}
                    onClick={() =>
                      void start({ controller: "learned" }).catch(report)
                    }
                  >
                    Play saved policy
                  </button>
                </>
              )}
              <label>
                Seed
                <input
                  aria-label="Seed"
                  type="number"
                  disabled={busy}
                  value={config.seed}
                  onChange={(e) =>
                    setConfig({ ...config, seed: +e.target.value })
                  }
                />
              </label>
              <div className="controls">
                <button
                  className="primary"
                  onClick={() => void start().catch(report)}
                  disabled={busy || mode === "realtime"}
                >
                  Start fresh mission
                </button>
                <button onClick={() => void stop().catch(report)}>
                  Stop / cancel
                </button>
                <button
                  disabled={busy}
                  onClick={() => void reset().catch(report)}
                >
                  Reset
                </button>
                <button onClick={pause}>
                  {mode === "paused" ? "Resume" : "Pause"}
                </button>
              </div>
              <div className="camera">
                <span>Camera</span>
                {(["Chase", "FPV", "Orbit"] as CameraMode[]).map((c) => (
                  <button
                    key={c}
                    className={camera === c ? "on" : ""}
                    onClick={() => setCamera(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <div className="device">
                <b>INPUT</b>
                <span>{gamepad}</span>
                <button
                  disabled={!navigator.getGamepads?.().some(Boolean)}
                  onClick={() => {
                    const gp = navigator.getGamepads().find(Boolean);
                    if (gp) {
                      gamepadZero.current = [...gp.axes];
                      setError("Gamepad neutral point calibrated.");
                    } else setError("No gamepad is connected.");
                  }}
                >
                  Calibrate zeros
                </button>
              </div>
              <div className="metrics">
                <div className="eyebrow">PERSONAL BEST</div>
                <b>
                  {runs.filter((r) => r.metrics.success).length
                    ? `${n(Math.max(...runs.filter((r) => r.metrics.success).map((r) => r.metrics.reward)), 1)} reward`
                    : "No completed success yet"}
                </b>
              </div>
            </>
          )}
          {view === "Experiment" && (
            <>
              {busy && (
                <p role="status" className="copy">
                  {batchProgress || "Preparing experiment…"}
                </p>
              )}
              <Experiment
                config={config}
                setConfig={setConfig}
                budget={budget}
                setBudget={setBudget}
                busy={busy}
                experiment={experiment}
                control={experimentControl}
                setControl={setExperimentControl}
                policies={policies}
                policyId={policyId}
                setPolicyId={setPolicyId}
                onRun={runExperiment}
                onTrain={train}
                onCancel={() => void cancelWork().catch(report)}
                onEvaluate={evaluate}
                training={training}
                lossPath={lossPath}
                evaluation={evaluation}
              />
            </>
          )}{" "}
          {view === "Review" && (
            <Review
              runs={runs}
              selected={selected}
              scrub={scrub}
              onPick={playback}
              onDelete={async (r) => {
                await deleteRun(r.id);
                await refresh();
                setSelected(undefined);
              }}
            />
          )}
        </aside>
        <section className="stage">
          <SceneGuard onFailure={() => attachCapture(undefined)}>
            <FlightScene
              state={stateRef}
              ghost={selected ? ghostRef : undefined}
              scenario={scenario}
              cameraMode={camera}
              path={path}
              onFps={setFps}
              onCapture={attachCapture}
            />
          </SceneGuard>
          <div className="hud top">
            <div>
              <span>ALTITUDE</span>
              <b>
                {n(flight?.position[2] ?? 0)}
                <em>m</em>
              </b>
            </div>
            <div>
              <span>SPEED</span>
              <b>
                {n(Math.hypot(...(flight?.velocity ?? [0, 0, 0])))}
                <em>m/s</em>
              </b>
            </div>
            <div>
              <span>MISSION TIME</span>
              <b>
                {n(flight?.time ?? 0)}
                <em>s</em>
              </b>
            </div>
          </div>
          <div className="hud right">
            <span>
              COLLISIONS <b>{flight?.collisions ?? 0}</b>
            </span>
            <span>
              BATTERY <b>{n((flight?.battery ?? 0) * 100, 0)}%</b>
            </span>
            <span>
              FPS <b>{fps}</b>
            </span>
          </div>
          <button
            className="capture"
            onClick={downloadCapture}
            aria-label="Capture frame"
          >
            Capture frame
          </button>
          <div className="keyguide">
            <span>
              <kbd>W</kbd>/<kbd>S</kbd> NORTH
            </span>
            <span>
              <kbd>D</kbd>/<kbd>A</kbd> EAST
            </span>
            <span>
              <kbd>SPACE</kbd> UP
            </span>
            <span>
              <kbd>SHIFT</kbd> DOWN
            </span>
            <span>
              <kbd>Q</kbd>/<kbd>E</kbd> YAW
            </span>
          </div>
          {selected && (
            <div className="replay">
              <b>REPLAY · {selected.id.slice(0, 8)}</b>
              <input
                aria-label="Replay position"
                type="range"
                min="0"
                max={Math.max(0, selected.transitions.length - 1)}
                value={scrub}
                onChange={(e) => playback(selected, +e.target.value)}
              />
              <span>
                {scrub + 1} / {selected.transitions.length}
              </span>
              <button onClick={() => exportRun(selected)}>Export ZIP</button>
            </div>
          )}
        </section>
      </main>
      {ai && <ConnectionPanel onClose={() => setAi(false)} />}
    </div>
  );
}

function Experiment({
  config,
  setConfig,
  budget,
  setBudget,
  busy,
  experiment,
  control,
  setControl,
  policies,
  policyId,
  setPolicyId,
  onRun,
  onTrain,
  onCancel,
  onEvaluate,
  training,
  lossPath,
  evaluation,
}: {
  config: SimConfig;
  setConfig: (c: SimConfig) => void;
  budget: number;
  setBudget: (n: number) => void;
  busy: boolean;
  experiment: RunRecord[];
  control: ControllerId;
  setControl: (c: ControllerId) => void;
  policies: PolicyCheckpoint[];
  policyId: string;
  setPolicyId: (s: string) => void;
  onRun: () => void;
  onTrain: () => void;
  onCancel: () => void;
  onEvaluate: () => void;
  training: TrainingProgress[];
  lossPath: string;
  evaluation: Evaluation;
}) {
  const update = (key: keyof SimConfig, value: number) =>
    setConfig({ ...config, [key]: value });
  return (
    <>
      <p className="copy">
        Run bounded, reproducible episodes on a separate physics worker.
      </p>
      <label>
        Scenario
        <select
          value={config.scenario}
          disabled={busy}
          onChange={(e) =>
            setConfig({ ...config, scenario: e.target.value as ScenarioId })
          }
        >
          {missions.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Controller
        <select
          value={control}
          disabled={busy}
          onChange={(e) => setControl(e.target.value as ControllerId)}
        >
          {["scripted", "random", "learned"].map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label>
        Seed
        <input
          type="number"
          disabled={busy}
          value={config.seed}
          onChange={(e) => update("seed", +e.target.value)}
        />
      </label>
      <label>
        Wind X
        <input
          type="number"
          disabled={busy}
          step=".1"
          value={config.wind[0]}
          onChange={(e) =>
            setConfig({
              ...config,
              wind: [+e.target.value, config.wind[1], config.wind[2]],
            })
          }
        />
      </label>
      <label>
        Sensor noise
        <input
          type="number"
          disabled={busy}
          step=".01"
          value={config.noise}
          onChange={(e) => update("noise", +e.target.value)}
        />
      </label>
      <label>
        Delay steps
        <input
          type="number"
          disabled={busy}
          min="0"
          value={config.delaySteps}
          onChange={(e) => update("delaySteps", +e.target.value)}
        />
      </label>
      <label>
        Observation profile
        <select
          disabled={busy}
          value={config.noise || config.delaySteps ? "noisy" : "ideal"}
          onChange={(e) =>
            setConfig({
              ...config,
              noise: e.target.value === "ideal" ? 0 : 0.03,
              delaySteps: e.target.value === "ideal" ? 0 : 2,
            })
          }
        >
          <option value="ideal">Ideal state benchmark</option>
          <option value="noisy">Seeded noise and delay</option>
        </select>
      </label>
      <label>
        Max seconds
        <input
          type="number"
          disabled={busy}
          min="1"
          value={config.maxSeconds}
          onChange={(e) => update("maxSeconds", +e.target.value)}
        />
      </label>
      <label>
        Episode budget <b>{budget}</b>
        <input
          aria-label="Episode budget"
          disabled={busy}
          type="range"
          min="1"
          max="8"
          value={budget}
          onChange={(e) => setBudget(+e.target.value)}
        />
      </label>
      <div className="controls">
        <button className="primary" disabled={busy} onClick={onRun}>
          Run experiment
        </button>
        <button disabled={!busy} onClick={onCancel}>
          Cancel work
        </button>
      </div>
      {experiment.length > 0 && (
        <div className="results">
          <b>
            {Math.round(
              mean(experiment, (r) => (r.metrics.success ? 1 : 0)) * 100,
            )}
            % success
          </b>
          <span>
            Mean reward{" "}
            {n(
              mean(experiment, (r) => r.metrics.reward),
              2,
            )}
          </span>
          <span>
            Mean error{" "}
            {n(
              mean(experiment, (r) => r.metrics.trackingError),
              2,
            )}{" "}
            m
          </span>
          <span>{experiment.length} measured episodes.</span>
          <span>
            {n(mean(experiment, (r) => r.metrics.seconds))} s mean duration ·{" "}
            {n(mean(experiment, (r) => r.metrics.collisions))} collisions
          </span>
          <span>
            {n(mean(experiment, (r) => r.metrics.energy))} energy proxy ·{" "}
            {n(
              mean(experiment, (r) => r.metrics.throughput),
              0,
            )}{" "}
            physics ticks/s
          </span>
        </div>
      )}
      <hr />
      <div className="eyebrow">BEHAVIOR CLONING</div>
      <p className="copy">
        Collect scripted Hover demos on seeds 10001–10012 and validation seeds
        20001–20004.
      </p>
      <button className="primary wide" disabled={busy} onClick={onTrain}>
        Train policy
      </button>
      {training.length > 0 && (
        <div className="chart">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none">
            <polyline points={lossPath} />
          </svg>
          <span>
            Epoch {training.at(-1)?.epoch} · loss{" "}
            {n(training.at(-1)?.loss ?? 0, 4)}
          </span>
        </div>
      )}
      <label>
        Saved policy
        <select
          value={policyId}
          disabled={busy}
          onChange={(e) => setPolicyId(e.target.value)}
        >
          <option value="">Select a policy</option>
          {policies.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id} · {p.samples} samples
            </option>
          ))}
        </select>
      </label>
      <div className="controls">
        <button
          className="wide"
          disabled={busy || !policyId}
          onClick={onEvaluate}
        >
          Evaluate paired 8 seeds
        </button>
        <button
          className="wide"
          disabled={!policyId}
          onClick={() => {
            const p = policies.find((x) => x.id === policyId);
            if (p) download(`${p.id}.json`, JSON.stringify(p, null, 2));
          }}
        >
          Download policy
        </button>
      </div>
      {Object.keys(evaluation).length > 0 && (
        <div className="results">
          <b>Held-out paired evaluation</b>
          {(["scripted", "random", "learned"] as ControllerId[]).map((c) => {
            const rs = evaluation[c] ?? [];
            const successes = rs.filter((r) => r.metrics.success).length;
            const ci = wilson(successes, rs.length || 1);
            return (
              <span key={c}>
                {c}: {successes}/{rs.length} success ({n(ci.low * 100, 0)}–
                {n(ci.high * 100, 0)}% Wilson), reward{" "}
                {n(
                  mean(rs, (r) => r.metrics.reward),
                  1,
                )}
                , error{" "}
                {n(
                  mean(rs, (r) => r.metrics.trackingError),
                  2,
                )}{" "}
                m
              </span>
            );
          })}
        </div>
      )}
    </>
  );
}
function Review({
  runs,
  selected,
  scrub,
  onPick,
  onDelete,
}: {
  runs: RunRecord[];
  selected?: RunRecord;
  scrub: number;
  onPick: (r: RunRecord, i: number) => void;
  onDelete: (r: RunRecord) => Promise<void>;
}) {
  const [storage, setStorage] = useState("");
  useEffect(() => {
    void navigator.storage
      ?.estimate()
      .then((value) =>
        setStorage(
          `${n((value.usage ?? 0) / 1048576)} MB used of ${n((value.quota ?? 0) / 1048576, 0)} MB browser quota`,
        ),
      )
      .catch(() => setStorage("Storage estimate unavailable"));
  }, [runs]);
  const transition = selected?.transitions[scrub];
  return (
    <>
      <p className="copy">Saved trajectories stay on this device.</p>
      <p className="copy">
        {storage} · {runs.length}/64 saved runs. Browser storage may be evicted;
        export important runs.
      </p>
      <div className="run-list">
        {runs.length ? (
          runs.map((r) => (
            <article
              key={r.id}
              className={selected?.id === r.id ? "selected" : ""}
            >
              <button onClick={() => onPick(r, 0)}>
                <b>
                  {r.config.scenario} · {r.controller}
                </b>
                <span>{new Date(r.createdAt).toLocaleString()}</span>
                <small>
                  {r.metrics.success ? "SUCCESS" : r.metrics.reason} ·{" "}
                  {n(r.metrics.reward, 1)} reward
                </small>
              </button>
              <button
                aria-label={`Delete run ${r.id}`}
                onClick={() => void onDelete(r)}
              >
                ×
              </button>
            </article>
          ))
        ) : (
          <div className="empty">No recorded runs yet.</div>
        )}
      </div>
      {selected && (
        <div className="metrics">
          <div className="eyebrow">RUN METRICS</div>
          <b>{selected.metrics.success ? "SUCCESS" : "INCOMPLETE"}</b>
          <span>
            {n(selected.metrics.seconds)} s · {selected.metrics.collisions}{" "}
            collisions
          </span>
          <span>{n(selected.metrics.trackingError)} m tracking error</span>
          <span>
            Frame {scrub + 1} of {selected.transitions.length}
          </span>
          {transition && (
            <>
              <span>
                Step {transition.startStep} → {transition.endStep} ·{" "}
                {transition.ticks} physics ticks
              </span>
              <span>
                Event: {transition.reason || "in progress"} ·{" "}
                {transition.terminated
                  ? "terminated"
                  : transition.truncated
                    ? "truncated"
                    : "active"}
              </span>
              <span>Reward {n(transition.reward, 4)}</span>
              {Object.entries(transition.components).map(([name, value]) => (
                <span key={name}>
                  {name}: {n(value, 4)}
                </span>
              ))}
              <span>
                Energy proxy {n(selected.metrics.energy)} ·{" "}
                {n(selected.metrics.throughput, 0)} ticks/s
              </span>
            </>
          )}
        </div>
      )}
    </>
  );
}
