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

test("arcade camera-relative axes, dash, turning, opposites, and release send meaningful commands", async ({ page }) => {
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
  expect((await lastActionFor(page, ["KeyC"]))?.velocity[2]).toBeLessThan(-10);
  // Shift is dash (one-shot kick) + boost while held.
  const boosted = await lastActionFor(page, ["KeyW", "ShiftLeft"]);
  expect(Math.hypot(...(boosted?.velocity ?? [0, 0, 0]))).toBeGreaterThan(25);
  const dashed = await page.evaluate(() => (window as typeof window & { arcadeActions: (NavAction & { impulse?: number[] })[] }).arcadeActions.some((a) => a.impulse && Math.hypot(...a.impulse) > 10));
  expect(dashed).toBe(true);
  // Q/E turn the camera; the drone's heading command follows it.
  expect((await lastActionFor(page, ["KeyQ"]))?.yawRate).toBeGreaterThan(0);
  await page.waitForTimeout(700);
  expect((await lastActionFor(page, ["KeyE"]))?.yawRate).toBeLessThan(0);
  await page.waitForTimeout(700);

  const opposite = await lastActionFor(page, ["KeyW", "KeyS", "KeyA", "KeyD", "KeyQ", "KeyE"]);
  expect(opposite?.kind).toBe("nav");
  expect(opposite?.velocity.every(value => Math.abs(value) < 1e-9)).toBe(true);
  expect(Math.abs(opposite?.yawRate ?? Infinity)).toBeLessThan(0.3);
  await page.waitForTimeout(400);
  const released = await page.evaluate(() => (window as typeof window & { arcadeActions: NavAction[] }).arcadeActions.at(-1));
  expect(released?.kind).toBe("nav");
  expect(released?.velocity.every(value => Math.abs(value) < 1e-9)).toBe(true);
  expect(Math.abs(released?.yawRate ?? Infinity)).toBeLessThan(0.3);
});

test("arcade free flight reaches manga speed lines and a real Pizzeria ground impact bounces without ending flight", async ({ page }, testInfo) => {
  await openFlight(page);
  await takeFlight(page);
  await page.keyboard.down("KeyW");
  await page.waitForFunction(() => Math.hypot(...window.dronelab.getState().state.velocity) * 3.6 > 58);
  await page.screenshot({ path: testInfo.outputPath("anime-speed.png"), fullPage: true });
  await expect(page.locator(".speed-lines")).toBeVisible();
  await page.keyboard.up("KeyW");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.waitForFunction(() => window.dronelab.getState().mode === "paused");
  await page.getByRole("button", { name: /Freddy.s Pizzeria/ }).click();
  await page.waitForFunction(() => !window.dronelab.getState().busy && window.dronelab.getState().config.mapId === "pizzeria");
  await takeFlight(page);
  const collisions = await page.evaluate(() => window.dronelab.getState().state.collisions);
  await page.keyboard.down("KeyC");
  await page.waitForFunction((before) => window.dronelab.getState().state.collisions > before, collisions, { timeout: 10_000 });
  await page.keyboard.up("KeyC");
  // Bounces are reactions now (onomatopoeia + rebound), not full-screen frames.
  await expect(page.locator(".impact-frame")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.dronelab.getState().state.velocity[2])).toBeGreaterThan(1);
  await page.screenshot({ path: testInfo.outputPath("anime-impact.png"), fullPage: true });
  expect(await page.evaluate(() => window.dronelab.getState().state.terminated)).toBe(false);
  expect(await page.evaluate(() => window.dronelab.getState().state.truncated)).toBe(false);
});

test("the machine gun (F) shreds a Hollow bot, scores, and heats up", async ({ page }) => {
  test.setTimeout(90_000);
  await openFlight(page);
  await page.getByRole("button", { name: /Freddy.s Pizzeria/ }).click();
  await page.waitForFunction(() => !window.dronelab.getState().busy && window.dronelab.getState().config.mapId === "pizzeria");
  await page.waitForFunction(() => Boolean((window as typeof window & { dronelabCombat?: unknown }).dronelabCombat));
  await takeFlight(page);
  type Combat = { targets: () => { id: string; alive: boolean; position: number[] }[]; stats: () => { score: number; kills: number; combo: number; heat: number } };
  const combat = () => (window as unknown as { dronelabCombat: Combat }).dronelabCombat;
  // The aisle bot hovers straight ahead of the spawn; climb to its height, close in and fire.
  const held = new Set<string>();
  const hold = async (key: string, on: boolean) => {
    if (on && !held.has(key)) { await page.keyboard.down(key); held.add(key); }
    if (!on && held.has(key)) { await page.keyboard.up(key); held.delete(key); }
  };
  let killed = false;
  let maxCombo = 0;
  for (let i = 0; i < 600 && !killed; i++) {
    const probe = await page.evaluate(() => {
      const c = (window as unknown as { dronelabCombat: Combat }).dronelabCombat;
      return { p: window.dronelab.getState().state.position, bot: c.targets().find((t) => t.id === "p-aisle")!, combo: c.stats().combo };
    });
    killed = !probe.bot.alive;
    maxCombo = Math.max(maxCombo, probe.combo);
    const dz = probe.bot.position[2]! - probe.p[2]!;
    const dx = probe.bot.position[0]! - probe.p[0]!;
    // Hold station 6–10 m away so the kill has to come from gunfire, not ramming.
    await hold("Space", dz > 0.3);
    await hold("KeyC", dz < -0.3);
    await hold("KeyW", dx > 10);
    await hold("KeyS", dx < 6);
    await hold("KeyF", Math.abs(dz) < 0.7 && dx < 12);
    await page.waitForTimeout(20);
  }
  for (const key of [...held]) await page.keyboard.up(key);
  expect(killed).toBe(true);
  const stats = await page.evaluate(() => (window as unknown as { dronelabCombat: Combat }).dronelabCombat.stats());
  expect(stats.kills).toBeGreaterThanOrEqual(1);
  expect(stats.score).toBeGreaterThan(400);
  expect(maxCombo).toBeGreaterThanOrEqual(8);
  void combat;
  expect(await page.evaluate(() => window.dronelab.getState().state.terminated)).toBe(false);
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
