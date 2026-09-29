import { beforeEach, describe, expect, it, vi } from "vitest";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};
function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"], reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function api(overrides: Record<string, unknown> = {}) {
  return {
    sim: { generation: 1, epoch: 2, request: vi.fn(async () => ({})) },
    getState: vi.fn(() => ({
      busy: false,
      rgbAvailable: true,
      policies: [],
      runs: [],
      training: [],
    })),
    startFlight: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    cancelWork: vi.fn(async () => undefined),
    pauseFlight: vi.fn(async () => undefined),
    resetFlight: vi.fn(async () => undefined),
    train: vi.fn(async () => ({ id: "policy" })),
    runExperiment: vi.fn(async () => [{ id: "run", metrics: {} }]),
    evaluate: vi.fn(async () => []),
    captureFrame: vi.fn(async () => ({
      step: 1,
      dataUrl: "data:image/png;base64,a",
    })),
    ...overrides,
  };
}
async function tools(mock: ReturnType<typeof api>) {
  vi.resetModules();
  Object.assign(globalThis, {
    window: { dronelab: mock, addEventListener: vi.fn() },
    document: {},
  });
  return import("../apps/web/src/agent-tools");
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("agent tools dispatcher", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  it("marks a job failed when its operation resolves undefined", async () => {
    const mock = api({ train: vi.fn(async () => undefined) });
    const { dispatch } = await tools(mock);
    const started = await dispatch("start_training");
    await settle();
    const status = await dispatch("get_training_status", {
      jobId: started.jobId,
    });
    expect(status.status).toBe("failed");
    expect(status.error).toMatch(/without a result/i);
  });
  it("rejects cancellation of a completed job without stopping work", async () => {
    const mock = api();
    const { dispatch } = await tools(mock);
    const started = await dispatch("start_training");
    await settle();
    await expect(
      dispatch("cancel_run", { jobId: started.jobId }),
    ).rejects.toThrow(/Only a running job/);
    expect(mock.cancelWork).not.toHaveBeenCalled();
  });
  it("cancels only a running job through the work cancellation API", async () => {
    const pending = deferred<{ id: string }>();
    const mock = api({ train: vi.fn(() => pending.promise) });
    const { dispatch } = await tools(mock);
    const started = await dispatch("start_training");
    const result = await dispatch("cancel_run", { jobId: started.jobId });
    expect(result.status).toBe("cancelled");
    expect(mock.cancelWork).toHaveBeenCalledTimes(1);
    pending.resolve({ id: "late" });
    await settle();
    expect(
      (await dispatch("get_training_status", { jobId: started.jobId })).status,
    ).toBe("cancelled");
  });
  it("reports RGB unavailable from state rather than capture wrapper presence", async () => {
    const mock = api({
      getState: vi.fn(() => ({
        busy: false,
        rgbAvailable: false,
        policies: [],
        runs: [],
        training: [],
      })),
    });
    const { dispatch } = await tools(mock);
    await expect(
      dispatch("capture_frame", { expectedStep: 1 }),
    ).rejects.toThrow(/RGB capture is unavailable/);
    expect(mock.captureFrame).not.toHaveBeenCalled();
  });
  it("uses the authoritative pause API", async () => {
    const mock = api();
    const { dispatch } = await tools(mock);
    await expect(dispatch("pause_session")).resolves.toEqual({ paused: true });
    expect(mock.pauseFlight).toHaveBeenCalledTimes(1);
    expect(mock.sim.request).not.toHaveBeenCalled();
  });
});
