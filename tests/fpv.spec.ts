import { expect, test, type Page } from "@playwright/test";

type FlightState = {
  config: { scenario: string; mapId?: string };
  controller: string;
  mode: string;
  state: { step: number; position: [number, number, number] };
  camera: string;
  look: { yaw: number; pitch: number };
  pointerLocked: boolean;
  runs: unknown[];
};

async function openFlight(page: Page) {
  await page.goto(`http://127.0.0.1:${process.env.DRONELAB_TEST_PREVIEW_PORT ?? 5182}/`);
  await page.waitForFunction(() =>
    Boolean(window.dronelab?.sim && window.dronelab.getState().state),
  );
  await page.waitForFunction(() => !window.dronelab.getState().busy);
  await expect(page.locator("#flight-stage canvas")).toBeVisible();
}

const state = (page: Page) =>
  page.evaluate(() => window.dronelab.getState()) as Promise<FlightState>;

async function takeFlight(page: Page) {
  await page.getByRole("button", { name: "Take flight", exact: true }).click();
  await page.waitForFunction(
    () => window.dronelab.getState().mode === "realtime" && window.dronelab.getState().state.step > 0,
  );
}

async function runHoverExperiment(page: Page) {
  await page.getByRole("button", { name: "AI Lab", exact: true }).click();
  await page.getByLabel("Episode budget").fill("1");
  await page
    .locator("label")
    .filter({ hasText: "Scenario" })
    .locator("select")
    .selectOption("hover");
  await page.getByRole("button", { name: "Run experiment" }).click();
  await page.waitForFunction(
    () => !window.dronelab.getState().busy && window.dronelab.getState().runs.some((run: { config: { scenario: string }; controller: string }) => run.config.scenario === "hover" && run.controller === "scripted"),
  );
}

test("opens as free FPV in Aster Valley and switches to Freddy's Pizzeria", async ({ page }) => {
  await openFlight(page);
  expect(await state(page)).toMatchObject({
    config: { scenario: "free", mapId: "valley" },
    camera: "FPV",
  });
  await expect(page.getByText("Aster Valley", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Freddy.s Pizzeria/ }).click();
  await page.waitForFunction(
    () => !window.dronelab.getState().busy && window.dronelab.getState().config.mapId === "pizzeria",
  );
  expect(await state(page)).toMatchObject({
    config: { scenario: "free", mapId: "pizzeria" },
  });
  await expect(page.getByText("Freddy’s Pizzeria", { exact: true })).toBeVisible();
});

test("dragging the flight canvas changes the FPV look yaw and pitch", async ({ page }) => {
  await openFlight(page);
  const before = await state(page);
  const canvas = page.locator("#flight-stage canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 45, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await state(page)).look.yaw).not.toBe(before.look.yaw);
  expect((await state(page)).look.pitch).not.toBe(before.look.pitch);
});

test("Mouse look acquires pointer lock and Escape releases it in Chromium", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Pointer lock is verified in Chromium.");
  await openFlight(page);
  await page.getByRole("button", { name: "Mouse look", exact: true }).click();
  await expect.poll(async () => (await state(page)).pointerLocked).toBe(true);
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await state(page)).pointerLocked).toBe(false);
});

test("Assisted W moves the drone along the current FPV view", async ({ page }) => {
  await openFlight(page);
  await takeFlight(page);
  const before = await state(page);
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(900);
  await page.keyboard.up("KeyW");
  const after = await state(page);
  const dx = after.state.position[0] - before.state.position[0];
  const dy = after.state.position[1] - before.state.position[1];
  const viewDistance = dx * Math.cos(before.look.yaw) + dy * Math.sin(before.look.yaw);
  expect(after.controller).toBe("manual");
  expect(viewDistance).toBeGreaterThan(0.005);
});

test("cycling camera while pointer locked releases it without pausing flight", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Pointer lock is verified in Chromium.");
  await openFlight(page);
  await takeFlight(page);
  await page.getByRole("button", { name: "Mouse look", exact: true }).click();
  await expect.poll(async () => (await state(page)).pointerLocked).toBe(true);
  await page.keyboard.press("KeyV");
  await page.waitForFunction(() => window.dronelab.getState().camera === "Chase");
  await expect.poll(async () => (await state(page)).pointerLocked).toBe(false);
  expect((await state(page)).mode).toBe("realtime");
});

test("Acro W sends forward pitch rate and retains throttle beyond the worker command TTL", async ({ page }) => {
  await openFlight(page);
  await page.getByRole("button", { name: /Acro/ }).click();
  await page.evaluate(() => {
    const sim = window.dronelab.sim as typeof window.dronelab.sim & { request: (...args: any[]) => Promise<unknown> };
    const original = sim.request.bind(sim);
    (window as typeof window & { fpvActions: unknown[] }).fpvActions = [];
    sim.request = ((type: string, payload?: { action?: unknown }, ...rest: unknown[]) => {
      if (type === "action") (window as typeof window & { fpvActions: unknown[] }).fpvActions.push(payload?.action);
      return original(type, payload, ...rest);
    }) as typeof sim.request;
  });
  await takeFlight(page);
  await page.keyboard.down("KeyW");
  await page.keyboard.down("Space");
  await page.waitForTimeout(300);
  await page.keyboard.up("Space");
  await page.keyboard.up("KeyW");
  await page.waitForFunction(() => (window as typeof window & { fpvActions: unknown[] }).fpvActions.length > 0);
  expect(await state(page)).toMatchObject({ controller: "rate" });
  expect((await page.evaluate(() => (window as typeof window & { fpvActions: Array<{ kind: string; rates?: number[]; thrust?: number }> }).fpvActions)).some((action) => action.kind === "rate" && action.rates?.[1] === 1)).toBe(true);
  const throttle = await page.locator(".throttle-meter").textContent();
  expect(throttle).toMatch(/THROTTLE\s+(4[3-9]|[5-9]\d|100)%/);
  const actionsBeforeTtl = await page.evaluate(() => (window as typeof window & { fpvActions: unknown[] }).fpvActions.length);
  await page.waitForTimeout(700);
  expect(await page.locator(".throttle-meter").textContent()).toBe(throttle);
  const actionsAfterTtl = await page.evaluate(() => (window as typeof window & { fpvActions: Array<{ kind: string; thrust?: number }> }).fpvActions);
  expect(actionsAfterTtl.length).toBeGreaterThan(actionsBeforeTtl);
  expect(actionsAfterTtl.at(-1)?.thrust).toBeGreaterThan(0.42);
});

test("R restarts flight and form typing does not issue flight input", async ({ page }) => {
  await openFlight(page);
  await takeFlight(page);
  const runCount = (await state(page)).runs.length;
  await page.keyboard.press("KeyR");
  await page.waitForFunction((count) => window.dronelab.getState().runs.length > count, runCount);
  await page.getByRole("button", { name: "Flight setup", exact: true }).click();
  await page.getByLabel("Seed").fill("777");
  const before = await state(page);
  await page.getByLabel("Seed").press("KeyW");
  await page.waitForTimeout(200);
  const after = await state(page);
  expect(after.state.position).toEqual(before.state.position);
});

test("leaving replay restores worker state and a single Resume continues flight", async ({ page }) => {
  await openFlight(page);
  await takeFlight(page);
  await runHoverExperiment(page);
  await page.getByRole("button", { name: "Flight journal", exact: true }).click();
  await page.getByRole("button", { name: /hover · scripted/ }).click();
  await page.getByLabel("Replay position").fill("1");
  await page.waitForFunction(() => window.dronelab.getState().mode === "replay");
  await page.getByRole("button", { name: "Explore", exact: true }).click();
  await page.waitForFunction(() => !window.dronelab.getState().busy && window.dronelab.getState().mode === "paused");
  const restored = await state(page);
  const authoritative = await page.evaluate(() => window.dronelab.sim.request("get"));
  expect(restored.state).toEqual(authoritative.state);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.waitForFunction(() => window.dronelab.getState().mode === "realtime");
});

test("set_mission starts a bounded Pizzeria free-flight probe without a collision or bounds failure", async ({ page }) => {
  await openFlight(page);
  await page.evaluate(() => window.droneTools.dispatch("set_mission", { scenario: "free", mapId: "pizzeria" }));
  await page.waitForFunction(() => window.dronelab.getState().config.mapId === "pizzeria" && window.dronelab.getState().state.step > 0);
  await page.waitForTimeout(900);
  const probe = await state(page);
  expect(probe.state.position).toBeDefined();
  expect((probe.state as FlightState["state"] & { reason?: string }).reason).not.toMatch(/collision|out_of_bounds/);
  await page.evaluate(() => window.droneTools.dispatch("stop_session"));
});
