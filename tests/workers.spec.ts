import { expect, test, type Page } from "@playwright/test";

async function harness(page: Page): Promise<void> {
  await page.goto("/tests/worker-harness.html");
  await page.waitForFunction(() => Boolean(window.workerHarness));
  await page.evaluate(() => window.workerHarness.ready());
}

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => harness(page));
test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.workerHarness.dispose());
});

test("initializes Rapier and emits an authoritative ready state", async ({
  page,
}) => {
  const ready = await page.evaluate(() => window.workerHarness.ready());
  expect(ready).toMatchObject({
    state: { step: 0, terminated: false, truncated: false },
    mode: "paused",
  });
});

test("rejects a raw request from the pre-reset generation", async ({
  page,
}) => {
  const stale = await page.evaluate(() =>
    window.workerHarness.rawStaleGeneration(),
  );
  expect(stale).toMatchObject({
    type: "result",
    requestId: 2,
    error: "stale_authority",
    generation: 1,
    epoch: 1,
  });
});

test("serves a duplicate advance request id from cache without advancing twice", async ({
  page,
}) => {
  const result = await page.evaluate(() =>
    window.workerHarness.rawDuplicateAdvance(),
  );
  expect(result.first.payload.transition).toMatchObject({
    startStep: 0,
    endStep: 4,
    ticks: 4,
  });
  expect(result.second.payload.transition).toMatchObject({
    startStep: 0,
    endStep: 4,
    ticks: 4,
  });
  expect(result.state.payload.state.step).toBe(4);
});

test("keeps clock modes exclusive and only advances in lockstep", async ({
  page,
}) => {
  await expect(
    page.evaluate(() =>
      window.workerHarness.request("action", {
        action: { kind: "nav", velocity: [0, 0, 0], yawRate: 0 },
      }),
    ),
  ).rejects.toThrow("Session paused");
  await page.evaluate(() =>
    window.workerHarness.request("mode", { mode: "lockstep" }),
  );
  const step = await page.evaluate(() =>
    window.workerHarness.request("advance", { ticks: 4 }),
  );
  expect(step.transition.ticks).toBe(4);
  await page.evaluate(() =>
    window.workerHarness.request("mode", { mode: "realtime" }),
  );
  await expect(
    page.evaluate(() => window.workerHarness.request("advance", { ticks: 1 })),
  ).rejects.toThrow("Lockstep required");
});

test("publishes an authoritative snapshot whenever the clock mode changes", async ({
  page,
}) => {
  await page.evaluate(() => window.workerHarness.clearMessages());
  await page.evaluate(() =>
    window.workerHarness.request("mode", { mode: "lockstep" }),
  );
  const snapshots = await page.evaluate(() =>
    window.workerHarness
      .messages()
      .filter((message) => message.type === "snapshot"),
  );
  expect(snapshots).toHaveLength(1);
  expect(snapshots[0]?.payload).toMatchObject({
    mode: "lockstep",
    controller: "manual",
    config: { scenario: "hover" },
    state: { step: 0 },
  });
});

test("uses a rate-compatible hold action before a rate command arrives", async ({
  page,
}) => {
  await page.evaluate(() =>
    window.workerHarness.request("reset", {
      config: {
        scenario: "hover",
        seed: 42,
        wind: [0, 0, 0],
        noise: 0,
        delaySteps: 0,
        maxSeconds: 30,
        dt: 1 / 120,
      },
      controller: "rate",
    }),
  );
  await page.evaluate(() =>
    window.workerHarness.request("mode", { mode: "lockstep" }),
  );
  const result = await page.evaluate(() =>
    window.workerHarness.request("advance", { ticks: 1 }),
  );
  expect(result.transition.appliedAction).toEqual({
    kind: "rate",
    rates: [0, 0, 0],
    thrust: 0.42,
  });
});

test("serializes concurrent lockstep advances", async ({ page }) => {
  await page.evaluate(() =>
    window.workerHarness.request("mode", { mode: "lockstep" }),
  );
  const results = await page.evaluate(() =>
    Promise.all([
      window.workerHarness.request("advance", { ticks: 4 }),
      window.workerHarness.request("advance", { ticks: 4 }),
    ]),
  );
  expect(results.map((result) => result.transition.endStep)).toEqual([4, 8]);
  const state = await page.evaluate(() => window.workerHarness.request("get"));
  expect(state.state.step).toBe(8);
});

test("restores a lockstep snapshot exactly", async ({ page }) => {
  await page.evaluate(() =>
    window.workerHarness.request("mode", { mode: "lockstep" }),
  );
  await page.evaluate(() =>
    window.workerHarness.request("advance", { ticks: 12 }),
  );
  const snapshot = await page.evaluate(() =>
    window.workerHarness.request("snapshot"),
  );
  await page.evaluate(() =>
    window.workerHarness.request("advance", { ticks: 8 }),
  );
  const restored = await page.evaluate(
    (snapshot) => window.workerHarness.request("restore", snapshot),
    snapshot,
  );
  const state = await page.evaluate(() => window.workerHarness.request("get"));
  expect(restored.state.step).toBe(snapshot.tick);
  expect(state.state.step).toBe(snapshot.tick);
});

test("cancels a yielding batch with stop and does not publish a successful stale batch result", async ({
  page,
}) => {
  await page.evaluate(() => window.workerHarness.clearMessages());
  const settled = await page.evaluate(async () => {
    const batch = window.workerHarness.request("batch", {
      configs: Array.from({ length: 8 }, () => ({
        scenario: "free",
        seed: 42,
        wind: [0, 0, 0],
        noise: 0,
        delaySteps: 0,
        maxSeconds: 30,
        dt: 1 / 120,
      })),
      control: "scripted",
    });
    const stop = window.workerHarness.request("stop");
    return Promise.allSettled([batch, stop]).then((results) =>
      results.map((result) =>
        result.status === "rejected"
          ? { status: result.status, reason: String(result.reason) }
          : { status: result.status, value: result.value },
      ),
    );
  });
  expect(settled[0]).toMatchObject({
    status: "rejected",
    reason: expect.stringContaining("Batch cancelled"),
  });
  expect(settled[1]).toMatchObject({
    status: "fulfilled",
    value: { mode: "paused" },
  });
  const messages = await page.evaluate(() => window.workerHarness.messages());
  expect(
    messages.filter(
      (message) =>
        message.type === "result" && message.requestId === 1 && !message.error,
    ),
  ).toHaveLength(0);
  const state = await page.evaluate(() => window.workerHarness.request("get"));
  expect(state.mode).toBe("paused");
});

test("rejects batches whose requested episode decisions exceed the shared budget", async ({
  page,
}) => {
  await expect(
    page.evaluate(() =>
      window.workerHarness.request("batch", {
        configs: Array.from({ length: 23 }, (_, seed) => ({
          scenario: "free",
          seed,
          wind: [0, 0, 0],
          noise: 0,
          delaySteps: 0,
          maxSeconds: 30,
          dt: 1 / 120,
        })),
        control: "scripted",
      }),
    ),
  ).rejects.toThrow("Batch decision budget exceeds 20000");
});

test("records a zero-tick terminal transition when stopping a recording", async ({
  page,
}) => {
  await page.evaluate(() => window.workerHarness.clearMessages());
  await page.evaluate(() => window.workerHarness.request("record"));
  await page.evaluate(() =>
    window.workerHarness.request("mode", { mode: "lockstep" }),
  );
  await page.evaluate(() =>
    window.workerHarness.request("advance", { ticks: 4 }),
  );
  await page.evaluate(() => window.workerHarness.request("stop"));
  const run = await page.evaluate(
    () =>
      window.workerHarness.messages().find((message) => message.type === "run")
        ?.payload,
  );
  expect(run.metrics.reason).toBe("user_stop");
  expect(run.transitions.at(-1)).toMatchObject({
    ticks: 0,
    reason: "user_stop",
    startStep: 4,
    endStep: 4,
  });
});

test("halts terminal episodes and reports zero ticks on later advances", async ({
  page,
}) => {
  await page.evaluate(() => window.workerHarness.reset({ maxSeconds: 0.01 }));
  await page.evaluate(() =>
    window.workerHarness.request("mode", { mode: "lockstep" }),
  );
  const terminal = await page.evaluate(() =>
    window.workerHarness.request("advance", { ticks: 20 }),
  );
  const after = await page.evaluate(() =>
    window.workerHarness.request("advance", { ticks: 1 }),
  );
  expect(terminal.state.truncated || terminal.state.terminated).toBe(true);
  expect(after.transition).toMatchObject({
    ticks: 0,
    startStep: terminal.state.step,
    endStep: terminal.state.step,
  });
});

test("stop prevents further realtime ticks promptly", async ({ page }) => {
  await page.evaluate(() =>
    window.workerHarness.request("mode", { mode: "realtime" }),
  );
  await page.waitForFunction(
    async () => (await window.workerHarness.request("get")).state.step > 0,
  );
  const stopped = await page.evaluate(() =>
    window.workerHarness.request("stop"),
  );
  await page.waitForTimeout(100);
  const after = await page.evaluate(() => window.workerHarness.request("get"));
  expect(after.state.step).toBe(stopped.state.step);
  expect(after.mode).toBe("paused");
});

test("rejects new client requests after disposal", async ({ page }) => {
  await page.evaluate(() => window.workerHarness.dispose());
  await expect(
    page.evaluate(() => window.workerHarness.request("get")),
  ).rejects.toThrow("Session closed");
});
