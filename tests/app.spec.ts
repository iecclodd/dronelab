import type {RunRecord} from '../packages/contracts';
import { expect, test, type Page } from '@playwright/test';

async function open(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.dronelab?.sim && window.droneTools));
  await page.waitForFunction(() => window.dronelab.getState().state?.step === 0);
}

async function runScriptedExperiment(page: Page, scenario: string, seed: number) {
  await page.locator('label').filter({ hasText: 'Scenario' }).locator('select').selectOption(scenario);
  await page.locator('label').filter({ hasText: 'Seed' }).locator('input').fill(String(seed));
  await page.getByRole('button', { name: 'Run experiment' }).click();
  await page.waitForFunction(seed => !window.dronelab.getState().busy && window.dronelab.getState().runs.some((run:RunRecord) => run.config.seed === seed && run.controller === 'scripted'), seed, { timeout: 20_000 });
  return page.evaluate(seed => window.dronelab.getState().runs.find((run:RunRecord) => run.config.seed === seed && run.controller === 'scripted'), seed);
}

test('manual W/Space movement records in realtime and Stop freezes it', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Start fresh mission' }).click();
  await page.waitForFunction(() => window.dronelab.getState().state.step > 0);
  const before = await page.evaluate(() => window.dronelab.getState().state);
  await page.keyboard.down('KeyW');
  await page.keyboard.down('Space');
  await page.waitForTimeout(500);
  await page.keyboard.up('Space');
  await page.keyboard.up('KeyW');
  const moving = await page.evaluate(() => window.dronelab.getState().state);
  expect(moving.step).toBeGreaterThan(before.step);
  expect(moving.position).not.toEqual(before.position);
  await page.getByRole('button', { name: 'Stop / cancel' }).click();
  const stopped = await page.evaluate(() => window.dronelab.getState().state);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.dronelab.getState().state.step)).toBe(stopped.step);
  await page.waitForFunction(() => window.dronelab.getState().runs.some((run:RunRecord) => run.controller === 'manual' && run.status === 'stopped' && run.transitions.length > 0));
  for (const camera of ['Chase', 'FPV', 'Orbit']) {
    await page.getByRole('button', { name: camera, exact: true }).click();
    await expect(page.getByRole('button', { name: camera, exact: true })).toHaveClass(/on/);
  }
});

test('paused frame capture accepts the exact step and rejects a mismatch', async ({ page }) => {
  await open(page);
  const step = await page.evaluate(() => window.dronelab.getState().state.step);
  await expect(page.evaluate(step => window.droneTools.dispatch('capture_frame', { expectedStep: step }), step)).resolves.toMatchObject({ step, format: 'image/png' });
  await expect(page.evaluate(step => window.droneTools.dispatch('capture_frame', { expectedStep: step + 1 }), step)).rejects.toThrow('Pause at the expected simulation step');
});

test('bounded scripted Hover, Gates, and Landing experiments each complete successfully', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Experiment', exact: true }).click();
  await page.getByLabel('Episode budget').fill('1');
  for (const [scenario, seed] of [['hover', 1001], ['gates', 1002], ['landing', 1003]] as const) {
    const run = await runScriptedExperiment(page, scenario, seed);
    expect(run).toMatchObject({ status: 'completed', config: { scenario, seed }, metrics: { success: true, reason: 'success' } });
  }
});

test('replay slider selects a saved frame without a realtime overwrite', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Experiment', exact: true }).click();
  await page.getByLabel('Episode budget').fill('1');
  await runScriptedExperiment(page, 'hover', 1001);
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('button', { name: /hover · scripted/ }).click();
  await page.getByLabel('Replay position').fill('1');
  const selected = await page.evaluate(() => window.dronelab.getState().state.step);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.dronelab.getState().state.step)).toBe(selected);
});

test('unavailable relay never presents a false connected state', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Connect AI' }).click();
  await expect(page.getByRole('status')).toHaveText('Not connected');
  await page.getByLabel('Relay URL').fill('http://example.invalid');
  await page.getByLabel('Relay access token').fill('123');
  await page.getByRole('button', { name: 'Connect relay' }).click();
  await expect(page.getByRole('status')).toHaveText('Use an HTTPS relay URL');
  await expect(page.getByText('Connected to this browser')).toHaveCount(0);
});

test('mobile primary navigation remains visible and keyboard reachable', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await open(page);
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
  for (const label of ['Fly', 'Experiment', 'Review']) await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
  await page.close();
});

