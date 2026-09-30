import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';

async function open(page: import('@playwright/test').Page) {
  await page.goto(`http://127.0.0.1:${process.env.DRONELAB_TEST_PREVIEW_PORT ?? 5182}/#experiment`);
  await page.waitForFunction(() => window.dronelab?.policySandbox && !window.dronelab.getState().busy);
}

test('external policy session is isolated, rejects stale steps, preserves terminal journal and reload', async ({ page }) => {
  test.setTimeout(60_000);
  await open(page);
  const before = await page.evaluate(() => window.dronelab.getState().state);
  const result = await page.evaluate(async () => {
    const start = await window.droneTools.dispatch('reset_policy_session', { scenario: 'hover', seed: 30001, maxSeconds: 0.1 });
    const action = { kind: 'nav', velocity: [0, 0, 0], yawRate: 0 };
    const first = await window.droneTools.dispatch('step_policy', { episodeId: start.episodeId, expectedStep: 0, action });
    let rejected = false;
    try { await window.droneTools.dispatch('step_policy', { episodeId: start.episodeId, expectedStep: 0, action }); } catch { rejected = true; }
    let current = first;
    while (!current.terminated && !current.truncated) current = await window.droneTools.dispatch('step_policy', { episodeId: start.episodeId, expectedStep: current.step, action });
    return { current, rejected };
  });
  expect(result.rejected).toBe(true);
  expect(result.current.status).toBe('completed');
  expect(await page.evaluate(() => window.dronelab.getState().state)).toEqual(before);
  await page.getByRole('button', { name: 'Flight journal', exact: true }).click();
  await expect(page.getByRole('button', { name: /hover · manual.*external-policy/ })).toBeVisible();
  await page.getByRole('button', { name: /hover · manual/ }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export ZIP', exact: true }).click();
  const zip = unzipSync(new Uint8Array(await readFile((await (await download).path())!)));
  expect(Object.keys(zip)).toContain('transitions.jsonl');
  const rows = strFromU8(zip['transitions.jsonl']).trim().split('\n').map(line => JSON.parse(line));
  expect(rows.at(-1).truncated || rows.at(-1).terminated).toBe(true);
  await page.reload();
  await page.waitForFunction(() => !window.dronelab.getState().busy);
  const saved = await page.evaluate(id => window.dronelab.getState().runs.find((r: { id: string }) => r.id === id), result.current.episodeId);
  expect(saved.status).toBe('completed');
  expect(saved.transitions.length).toBe(rows.length);
});

test('Auto train saves provenance, exact test configurations, replayable datasets and importable policy', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page);
  await page.getByRole('combobox', { name: 'Scenario', exact: true }).selectOption('hover');
  await page.getByRole('spinbutton', { name: 'Max seconds', exact: true }).fill('2');
  await page.getByRole('button', { name: 'Auto train', exact: true }).click();
  await expect(page.getByText('Auto train complete.', { exact: false })).toBeVisible({ timeout: 100_000 });
  const info = await page.evaluate(() => {
    const s = window.dronelab.getState();
    return { policy: s.policies[0], runs: s.runs, gameStep: s.state.step };
  });
  expect(info.policy.evaluationConfigs).toHaveLength(8);
  expect(info.policy.datasetSources).toHaveLength(16);
  expect(info.runs.filter((r: any) => r.manifest.source === 'auto-train-scripted')).toHaveLength(16);
  expect(info.runs.filter((r: any) => r.manifest.purpose === 'held-out-evaluation')).toHaveLength(24);
  expect(info.gameStep).toBe(0);
  const policyDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download policy', exact: true }).click();
  const policyPath = (await (await policyDownload).path())!;
  await page.getByLabel('Import policy JSON', { exact: true }).setInputFiles(policyPath);
  await expect(page.getByText('Policy imported.', { exact: false })).toBeVisible();
  await page.getByText('Select journal episodes (0)', { exact: true }).click();
  for (const checkbox of await page.locator('label').filter({ hasText: 'auto-train-scripted' }).getByRole('checkbox').all()) await checkbox.check();
  const datasetDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export selected dataset', exact: true }).click();
  const datasetPath = (await (await datasetDownload).path())!;
  const zip = unzipSync(new Uint8Array(await readFile(datasetPath)));
  const manifest = JSON.parse(strFromU8(zip['manifest.json']));
  expect(manifest.splits.train.episodes).toBe(12);
  expect(manifest.splits.validation.episodes).toBe(4);
  expect(manifest.splits.test.episodes).toBe(0);
  const exchange = zip['exchange.json'];
  expect(exchange).toBeDefined();
  await page.getByLabel('Import dataset JSON', { exact: true }).setInputFiles({ name: 'exchange.json', mimeType: 'application/json', buffer: Buffer.from(exchange) });
  await expect(page.getByText('16 external episodes imported', { exact: false })).toBeVisible({ timeout: 40_000 });
  await page.reload();
  await page.waitForFunction(() => window.dronelab?.getState().policies.length === 1);
  await page.getByRole('combobox', { name: 'Saved policy', exact: true }).selectOption(info.policy.id);
  await page.getByRole('button', { name: 'Evaluate paired 8 seeds', exact: true }).click();
  await page.waitForFunction(() => !window.dronelab.getState().busy);
  const configs = await page.evaluate(() => window.dronelab.getState().runs.filter((r: any) => r.manifest.purpose === 'held-out-evaluation').map((r: any) => r.config));
  for (const config of configs) expect(info.policy.evaluationConfigs).toContainEqual(config);
});

test('paired local-policy UI completes an episode and persists model lineage', async ({ page }) => {
  test.setTimeout(60_000);
  const origin = 'http://127.0.0.1:58787';
  let calls = 0;
  await page.route(`${origin}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    const body = path === '/sessions' ? { sessionId: 'fixture-session', browserToken: 'fixture-browser', mcpToken: 'fixture-mcp', expiresAt: Date.now() + 60_000 }
      : path.endsWith('/poll') ? { commands: [] }
      : path === '/policies/action' ? (++calls, { action: { kind: 'nav', velocity: [0, 0, 0], yawRate: 0 }, metadata: { model: 'fixture-zero-policy', datasetVersion: 'test-no-training', mappingVersion: 'enu-v1' } }) : {};
    await route.fulfill({ json: body, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
  });
  await open(page);
  await page.getByRole('button', { name: 'Connect AI ↗', exact: true }).click();
  await page.getByRole('textbox', { name: 'Relay URL', exact: true }).fill(origin);
  await page.getByLabel('Relay access token', { exact: true }).fill('fixture-only-relay-secret');
  await page.getByRole('button', { name: 'Connect relay', exact: true }).click();
  await expect(page.getByText('Connected to this browser', { exact: true })).toBeVisible();
  await page.getByRole('spinbutton', { name: 'Evaluation seconds', exact: true }).fill('1');
  await page.getByRole('button', { name: 'Run policy evaluation', exact: true }).click();
  await expect(page.getByText(/Policy evaluation saved/)).toBeVisible({ timeout: 30_000 });
  const run = await page.evaluate(() => window.dronelab.getState().runs.find((r: any) => r.manifest.source === 'external-policy'));
  expect(calls).toBeGreaterThan(0);
  expect(run.status).toBe('completed');
  expect(run.manifest.policyRuntime.model).toBe('fixture-zero-policy');
  expect(run.manifest.policyRuntime.datasetVersion).toBe('test-no-training');
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
});
