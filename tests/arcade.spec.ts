import { expect, test, type Page } from "@playwright/test";

type NavAction = { kind: "nav"; velocity: [number, number, number]; yawRate: number };

async function openFlight(page: Page) {
  await page.goto("http://127.0.0.1:5182/");
  await page.waitForFunction(() => Boolean(window.dronelab?.sim && window.dronelab.getState().state));
  await page.waitForFunction(() => !window.dronelab.getState().busy);
}

async function takeFlight(page: Page) {
  await page.getByRole("button", { name: "Take flight", exact: true }).click();
  await page.waitForFunction(() => window.dronelab.getState().mode === "realtime" && !window.dronelab.getState().busy);
}

async function recordActions(page: Page) {
  await page.evaluate(() => {
    const sim = window.dronelab.sim as typeof window.dronelab.sim & { request: (...args: any[]) => Promise<unknown> };
    const original = sim.request.bind(sim);
    (window as typeof window & { arcadeActions: unknown[] }).arcadeActions = [];
    sim.request = ((type: string, payload?: { action?: unknown }, ...rest: unknown[]) => {
      if (type === "action") (window as typeof window & { arcadeActions: unknown[] }).arcadeActions.push(payload?.action);
      return original(type, payload, ...rest);
    }) as typeof sim.request;
  });
}

async function lastActionFor(page: Page, keys: string[]) {
  await page.evaluate(() => { (window as typeof window & { arcadeActions: unknown[] }).arcadeActions = []; });
  for (const key of keys) await page.keyboard.down(key);
  await page.waitForTimeout(180);
  await page.waitForFunction(() => (window as typeof window & { arcadeActions: unknown[] }).arcadeActions.length > 0);
  const active = await page.evaluate(() => (window as typeof window & { arcadeActions: NavAction[] }).arcadeActions.at(-1));
  for (const key of [...keys].reverse()) await page.keyboard.up(key);
  return active;
}

test("arcade keyboard axes, opposites, and release send meaningful Assisted commands", async ({ page }) => {
  await openFlight(page);
  await recordActions(page);
  await takeFlight(page);

  const w = await lastActionFor(page, ["KeyW"]);
  const s = await lastActionFor(page, ["KeyS"]);
  const a = await lastActionFor(page, ["KeyA"]);
  const d = await lastActionFor(page, ["KeyD"]);
  for (const action of [w, s, a, d]) expect(Math.hypot(...(action?.velocity ?? [0, 0, 0]))).toBeGreaterThan(10);
  const dot = (left: NavAction | undefined, right: NavAction | undefined) => left!.velocity.reduce((sum, value, index) => sum + value * right!.velocity[index]!, 0);
  expect(dot(w, s)).toBeLessThan(-100);
  expect(dot(a, d)).toBeLessThan(-100);
  expect((await lastActionFor(page, ["Space"]))?.velocity[2]).toBeGreaterThan(10);
  expect((await lastActionFor(page, ["ShiftLeft"]))?.velocity[2]).toBeLessThan(-10);
  expect((await lastActionFor(page, ["ShiftRight"]))?.velocity[2]).toBeLessThan(-10);
  expect((await lastActionFor(page, ["KeyQ"]))?.yawRate).toBeGreaterThan(0);
  expect((await lastActionFor(page, ["KeyE"]))?.yawRate).toBeLessThan(0);

  const opposite = await lastActionFor(page, ["KeyW", "KeyS", "KeyA", "KeyD", "KeyQ", "KeyE"]);
  expect(opposite?.kind).toBe("nav");
  expect(opposite?.velocity.every(value => Math.abs(value) < 1e-9)).toBe(true);
  expect(Math.abs(opposite?.yawRate ?? Infinity)).toBeLessThan(1e-9);
  await page.waitForTimeout(160);
  const released = await page.evaluate(() => (window as typeof window & { arcadeActions: NavAction[] }).arcadeActions.at(-1));
  expect(released?.kind).toBe("nav");
  expect(released?.velocity.every(value => Math.abs(value) < 1e-9)).toBe(true);
  expect(Math.abs(released?.yawRate ?? Infinity)).toBeLessThan(1e-9);
});

test("arcade free flight reaches speed lines and a real Pizzeria ground impact bounces without ending flight", async ({ page }) => {
  await openFlight(page);
  await takeFlight(page);
  await page.keyboard.down("KeyW");
  await page.keyboard.down("KeyF");
  await page.waitForFunction(() => Math.hypot(...window.dronelab.getState().state.velocity) * 3.6 > 35);
  await page.screenshot({ path: "C:/Users/azaan/Documents/Codex/2026-09-29/execute/outputs/anime-speed.png", fullPage: true });
  await expect(page.locator(".speed-lines")).toBeVisible();
  await page.keyboard.up("KeyF");
  await page.keyboard.up("KeyW");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.waitForFunction(() => window.dronelab.getState().mode === "paused");
  await page.getByRole("button", { name: /Freddy.s Pizzeria/ }).click();
  await page.waitForFunction(() => !window.dronelab.getState().busy && window.dronelab.getState().config.mapId === "pizzeria");
  await takeFlight(page);
  const collisions = await page.evaluate(() => window.dronelab.getState().state.collisions);
  await page.keyboard.down("ShiftLeft");
  await page.waitForFunction((before) => window.dronelab.getState().state.collisions > before, collisions, { timeout: 10_000 });
  await page.keyboard.up("ShiftLeft");
  await expect(page.locator(".impact-frame")).toBeVisible();
  await page.screenshot({ path: "C:/Users/azaan/Documents/Codex/2026-09-29/execute/outputs/anime-impact.png", fullPage: true });
  expect(await page.evaluate(() => window.dronelab.getState().state.terminated)).toBe(false);
  expect(await page.evaluate(() => window.dronelab.getState().state.truncated)).toBe(false);
});

test("reduced motion starts effects disabled and the minimap expands on request", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openFlight(page);
  await page.getByRole("button", { name: "Flight setup", exact: true }).click();
  const effects = page.getByLabel("Motion effects");
  await expect(effects).not.toBeChecked();
  await effects.check();
  await expect(effects).toBeChecked();
  const minimap = page.getByRole("button", { name: "Show minimap" });
  await expect(minimap).toHaveAttribute("aria-expanded", "false");
  await minimap.click();
  await expect(page.getByRole("button", { name: "Hide minimap" })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("img", { name: /Map of Aster Valley/ })).toBeVisible();
});

test("a flight gesture builds the engine audio graph, while mute and pause ramp it silent", async ({ page }) => {
  await page.addInitScript(() => {
    const targets: number[] = [];
    const starts: number[] = [];
    const contexts: AudioContext[] = [];
    const OriginalContext = window.AudioContext;
    class TrackingAudioContext extends OriginalContext {
      constructor(...args: ConstructorParameters<typeof AudioContext>) {
        super(...args);
        contexts.push(this);
      }
    }
    Object.defineProperty(window, "AudioContext", { configurable: true, value: TrackingAudioContext });
    const originalTarget = AudioParam.prototype.setTargetAtTime;
    const originalStart = OscillatorNode.prototype.start;
    AudioParam.prototype.setTargetAtTime = function(value, ...rest) {
      targets.push(value);
      return originalTarget.call(this, value, ...rest);
    };
    OscillatorNode.prototype.start = function(...args) {
      starts.push(Date.now());
      return originalStart.call(this, ...args);
    };
    (window as typeof window & { arcadeAudio: { targets: number[]; starts: number[]; contexts: AudioContext[] } }).arcadeAudio = { targets, starts, contexts };
  });
  await openFlight(page);
  await takeFlight(page);
  await expect.poll(() => page.evaluate(() => (window as typeof window & { arcadeAudio: { starts: number[] } }).arcadeAudio.starts.length)).toBeGreaterThanOrEqual(8);
  await expect.poll(() => page.evaluate(() => (window as typeof window & { arcadeAudio: { contexts: AudioContext[] } }).arcadeAudio.contexts[0]?.state)).toBe("running");
  await expect.poll(() => page.evaluate(() => (window as typeof window & { arcadeAudio: { targets: number[] } }).arcadeAudio.targets.some(value => value >= 65))).toBe(true);
  const beforeMute = await page.evaluate(() => (window as typeof window & { arcadeAudio: { targets: number[] } }).arcadeAudio.targets.length);
  await page.getByRole("button", { name: "Mute drone sound" }).click();
  await expect(page.getByRole("button", { name: "Enable drone sound" })).toBeVisible();
  await expect.poll(() => page.evaluate((index) => (window as typeof window & { arcadeAudio: { targets: number[] } }).arcadeAudio.targets.slice(index).includes(0), beforeMute)).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as typeof window & { arcadeAudio: { contexts: AudioContext[] } }).arcadeAudio.contexts[0]?.state)).toBe("suspended");
  await page.getByRole("button", { name: "Enable drone sound" }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { arcadeAudio: { contexts: AudioContext[] } }).arcadeAudio.contexts[0]?.state)).toBe("running");
  const beforePause = await page.evaluate(() => (window as typeof window & { arcadeAudio: { targets: number[] } }).arcadeAudio.targets.length);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.waitForFunction(() => window.dronelab.getState().mode === "paused");
  await expect.poll(() => page.evaluate((index) => (window as typeof window & { arcadeAudio: { targets: number[] } }).arcadeAudio.targets.slice(index).includes(0), beforePause)).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as typeof window & { arcadeAudio: { contexts: AudioContext[] } }).arcadeAudio.contexts[0]?.state)).toBe("suspended");
});
