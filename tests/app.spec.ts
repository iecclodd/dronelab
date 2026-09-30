import type { RunRecord } from "../packages/contracts";
import { expect, test, type Page } from "@playwright/test";

async function open(page: Page) {
  await page.goto(`http://127.0.0.1:${process.env.DRONELAB_TEST_PREVIEW_PORT ?? 5182}/`);
  await page.waitForFunction(() =>
    Boolean(window.dronelab?.sim && window.droneTools),
  );
  await page.waitForFunction(
    () => window.dronelab.getState().state?.step === 0,
  );
  await page.waitForFunction(
    () =>
      !window.dronelab.getState().busy &&
      window.dronelab.getState().rgbAvailable,
  );
}

async function runScriptedExperiment(
  page: Page,
  scenario: string,
  seed: number,
) {
  await page
    .locator("label")
    .filter({ hasText: "Scenario" })
    .locator("select")
    .selectOption(scenario);
  await page
    .locator("label")
    .filter({ hasText: "Seed" })
    .locator("input")
    .fill(String(seed));
  await page.getByRole("button", { name: "Run experiment" }).click();
  await page.waitForFunction(
    (seed) =>
      !window.dronelab.getState().busy &&
      window.dronelab
        .getState()
        .runs.some(
          (run: RunRecord) =>
            run.config.seed === seed && run.controller === "scripted",
        ),
    seed,
    { timeout: 20_000 },
  );
  return page.evaluate(
    (seed) =>
      window.dronelab
        .getState()
        .runs.find(
          (run: RunRecord) =>
            run.config.seed === seed && run.controller === "scripted",
        ),
    seed,
  );
}

test("manual W/Space movement records in realtime and Stop freezes it", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Take flight", exact: true }).click();
  await page.waitForFunction(() => window.dronelab.getState().state.step > 0);
  const before = await page.evaluate(() => window.dronelab.getState().state);
  await page.keyboard.down("KeyW");
  await page.keyboard.down("Space");
  await page.waitForTimeout(500);
  await page.keyboard.up("Space");
  await page.keyboard.up("KeyW");
  const moving = await page.evaluate(() => window.dronelab.getState().state);
  expect(moving.step).toBeGreaterThan(before.step);
  expect(moving.position).not.toEqual(before.position);
  await page.getByRole("button", { name: "Flight setup", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Flight setup" })).toBeVisible();
  await page.getByRole("button", { name: "Stop / cancel" }).click();
  const stopped = await page.evaluate(() => window.dronelab.getState().state);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.dronelab.getState().state.step)).toBe(
    stopped.step,
  );
  await page.waitForFunction(() =>
    window.dronelab
      .getState()
      .runs.some(
        (run: RunRecord) =>
          run.controller === "manual" &&
          run.status === "stopped" &&
          run.transitions.length > 0,
      ),
  );
  for (const camera of ["Chase", "FPV", "Orbit"]) {
    await page.getByRole("button", { name: camera, exact: true }).click();
    await expect(
      page.getByRole("button", { name: camera, exact: true }),
    ).toHaveClass(/on/);
  }
});

test("paused frame capture accepts the exact step and rejects a mismatch", async ({
  page,
}) => {
  await open(page);
  const step = await page.evaluate(() => window.dronelab.getState().state.step);
  await expect(
    page.evaluate(
      (step) =>
        window.droneTools.dispatch("capture_frame", { expectedStep: step }),
      step,
    ),
  ).resolves.toMatchObject({ step, format: "image/png" });
  await expect(
    page.evaluate(
      (step) =>
        window.droneTools.dispatch("capture_frame", { expectedStep: step + 1 }),
      step,
    ),
  ).rejects.toThrow("Pause at the expected simulation step");
});

test("tool pause synchronizes the UI and exact-step renderer", async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => window.dronelab.startFlight());
  await page.waitForFunction(() => window.dronelab.getState().state.step > 0);
  await page.evaluate(() => window.droneTools.dispatch("pause_session"));
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  const step = await page.evaluate(() => window.dronelab.getState().state.step);
  await expect(
    page.evaluate(
      (step) =>
        window.droneTools.dispatch("capture_frame", { expectedStep: step }),
      step,
    ),
  ).resolves.toMatchObject({ step });
});

test("failed experiment is a failed job and an old job cannot cancel flight", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "AI Lab", exact: true }).click();
  await page.getByLabel("Max seconds").fill("0");
  const failed = await page.evaluate(() =>
    window.droneTools.dispatch("start_experiment"),
  );
  await expect
    .poll(() =>
      page.evaluate(
        (id) =>
          window.droneTools
            .dispatch("get_run_status", { jobId: id })
            .then((r) => r.status),
        failed.jobId,
      ),
    )
    .toBe("failed");
  await page.getByLabel("Max seconds").fill("30");
  await page.getByLabel("Episode budget").fill("1");
  const completed = await page.evaluate(() =>
    window.droneTools.dispatch("start_experiment"),
  );
  await expect
    .poll(() =>
      page.evaluate(
        (id) =>
          window.droneTools
            .dispatch("get_run_status", { jobId: id })
            .then((r) => r.status),
        completed.jobId,
      ),
    )
    .toBe("completed");
  await page.evaluate(() => window.dronelab.startFlight());
  await page.waitForFunction(() => window.dronelab.getState().state.step > 0);
  await expect(
    page.evaluate(
      (id) => window.droneTools.dispatch("cancel_run", { jobId: id }),
      completed.jobId,
    ),
  ).rejects.toThrow("Only a running job");
  expect(await page.evaluate(() => window.dronelab.getState().mode)).toBe(
    "realtime",
  );
  await page.evaluate(() => window.dronelab.stop());
});

test("AI Lab and browser-owned starts keep the research flight profile", async ({ page }) => {
  await page.goto(`http://127.0.0.1:${process.env.DRONELAB_TEST_PREVIEW_PORT ?? 5182}/#experiment`);
  await page.waitForFunction(() => Boolean(window.dronelab?.sim && !window.dronelab.getState().busy));
  expect(await page.evaluate(() => window.dronelab.getState().config.flightFeel)).toBe("research");
  await page.getByLabel("Episode budget").fill("1");
  const run = await runScriptedExperiment(page, "hover", 1234);
  expect(run.config.flightFeel).toBe("research");
  await page.evaluate(() => window.dronelab.startFlight({ config: { scenario: "free", mapId: "pizzeria" } }));
  await page.waitForFunction(() => window.dronelab.getState().mode === "realtime");
  expect(await page.evaluate(() => window.dronelab.getState().config.flightFeel)).toBe("research");
  await page.evaluate(() => window.dronelab.resetFlight({ scenario: "free", mapId: "valley" }));
  await page.waitForFunction(() => !window.dronelab.getState().busy);
  expect(await page.evaluate(() => window.dronelab.getState().config.flightFeel)).toBe("research");
});

test("bounded scripted Hover, Gates, and Landing experiments each complete successfully", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "AI Lab", exact: true }).click();
  await page.getByLabel("Episode budget").fill("1");
  for (const [scenario, seed] of [
    ["hover", 1001],
    ["gates", 1002],
    ["landing", 1003],
  ] as const) {
    const run = await runScriptedExperiment(page, scenario, seed);
    expect(run).toMatchObject({
      status: "completed",
      config: { scenario, seed },
      metrics: { success: true, reason: "success" },
    });
  }
});

test("replay slider selects a saved frame without a realtime overwrite", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "AI Lab", exact: true }).click();
  await page.getByLabel("Episode budget").fill("1");
  await runScriptedExperiment(page, "hover", 1001);
  await page.getByRole("button", { name: "Flight journal", exact: true }).click();
  await page.getByRole("button", { name: /hover · scripted/ }).click();
  await page.getByLabel("Replay position").fill("1");
  const selected = await page.evaluate(
    () => window.dronelab.getState().state.step,
  );
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.dronelab.getState().state.step)).toBe(
    selected,
  );
});

test("unavailable relay never presents a false connected state", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "AI Lab", exact: true }).click();
  await page.getByRole("button", { name: "Connect AI" }).click();
  await expect(page.getByRole("status")).toHaveText("Not connected");
  await page.getByLabel("Relay URL").fill("http://example.invalid");
  await page.getByLabel("Relay access token").fill("123");
  await page.getByRole("button", { name: "Connect relay" }).click();
  await expect(page.getByRole("status")).toHaveText("Use an HTTPS relay URL");
  await expect(page.getByText("Connected to this browser")).toHaveCount(0);
});

test("mobile primary navigation remains visible and keyboard reachable", async ({
  browser,
}) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await open(page);
  await expect(
    page.getByRole("navigation", { name: "Primary navigation" }),
  ).toBeVisible();
  for (const label of ["Explore", "AI Lab", "Flight journal"])
    await expect(
      page.getByRole("button", { name: label, exact: true }),
    ).toBeVisible();
  await page.close();
});
