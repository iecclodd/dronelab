import { expect, test } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';

async function resetDatabase(page: import('@playwright/test').Page) {
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('dronelab');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('dronelab database remained open'));
    });
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/worker-harness.html');
  // Warm Vite's first-time dependency optimization before evaluating a test.
  await page.evaluate(async () => { await import('/apps/web/src/storage.ts'); await import('/packages/sim-core/index.ts'); });
  await resetDatabase(page);
  await page.reload();
});

test('persists, reload-recovers chunks, deletes, and bounds run history', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { DroneEnvironment, initPhysics } = await import('/packages/sim-core/index.ts');
    const { DEFAULT_CONFIG, ZERO_ACTION } = await import('/packages/contracts/index.ts');
    const store = await import('/apps/web/src/storage.ts');
    await initPhysics();
    const env = new DroneEnvironment({ ...DEFAULT_CONFIG, scenario: 'free' as const, maxSeconds: 2 });
    const transitions = [env.step(ZERO_ACTION, 4).transition, env.step(ZERO_ACTION, 4).transition];
    env.dispose();
    const run = {
      id: 'recover-me', createdAt: '2026-01-01T00:00:00.000Z', status: 'recording' as const,
      config: { ...DEFAULT_CONFIG, scenario: 'free' as const, maxSeconds: 2 }, controller: 'manual' as const,
      manifest: { schema: 'run-v1' }, transitions: [],
      metrics: { success: false, reason: 'running', seconds: 0, collisions: 0, trackingError: 0, energy: 0, reward: 0, steps: 0, wallSeconds: 0, throughput: 0 },
    };
    await store.saveRun(run);
    await store.appendChunk(run.id, 0, [transitions[0]!]);
    await store.appendChunk(run.id, 1, [transitions[1]!]);
    return { expected: transitions.length };
  });
  await page.reload();
  const recovered = await page.evaluate(async () => (await (await import('/apps/web/src/storage.ts')).listRuns()));
  expect(recovered).toHaveLength(1);
  expect(recovered[0]).toMatchObject({ id: 'recover-me', status: 'interrupted' });
  expect(recovered[0]!.transitions).toHaveLength(result.expected);

  await page.evaluate(async () => (await import('/apps/web/src/storage.ts')).deleteRun('recover-me'));
  expect(await page.evaluate(async () => (await (await import('/apps/web/src/storage.ts')).listRuns()))).toEqual([]);

  const count = await page.evaluate(async () => {
    const { DEFAULT_CONFIG } = await import('/packages/contracts/index.ts');
    const { saveRun, listRuns } = await import('/apps/web/src/storage.ts');
    for (let index = 0; index < 65; index++) {
      await saveRun({ id: `bounded-${index}`, createdAt: `2026-02-01T00:00:${String(index).padStart(2, '0')}.000Z`, status: 'completed', config: DEFAULT_CONFIG, controller: 'manual', manifest: { schema: 'run-v1' }, transitions: [], metrics: { success: false, reason: '', seconds: 0, collisions: 0, trackingError: 0, energy: 0, reward: 0, steps: 0, wallSeconds: 0, throughput: 0 } });
    }
    return listRuns();
  });
  expect(count).toHaveLength(64);
  expect(count.map(run => run.id)).not.toContain('bounded-0');
});

test('exports a validated real sim-core run as complete ZIP artifacts', async ({ page }) => {
  const downloadPromise = page.waitForEvent('download');
  await page.evaluate(async () => {
    const { DroneEnvironment, initPhysics } = await import('/packages/sim-core/index.ts');
    const { DEFAULT_CONFIG } = await import('/packages/contracts/index.ts');
    const store = await import('/apps/web/src/storage.ts');
    await initPhysics();
    const env = new DroneEnvironment({ ...DEFAULT_CONFIG, scenario: 'free' as const, maxSeconds: 2 });
    const transition = env.step(env.scriptedAction(), 4).transition;
    const run = { id: 'exported-run', createdAt: '2026-03-01T00:00:00.000Z', status: 'completed' as const, config: { ...DEFAULT_CONFIG, scenario: 'free' as const, maxSeconds: 2 }, controller: 'scripted' as const, manifest: { schema: 'run-v1' }, transitions: [transition], metrics: { success: false, reason: '', seconds: transition.state.time, collisions: 0, trackingError: 0, energy: 0, reward: transition.reward, steps: transition.endStep, wallSeconds: 0, throughput: 0 } };
    store.exportRun(run);
    env.dispose();
  });
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const parts: Buffer[] = [];
  for await (const part of stream!) parts.push(part as Buffer);
  const contents = unzipSync(new Uint8Array(Buffer.concat(parts)));
  expect(Object.keys(contents).sort()).toEqual(['events.jsonl', 'manifest.json', 'summary.csv', 'transitions.jsonl']);
  const manifest = JSON.parse(strFromU8(contents['manifest.json']!));
  expect(manifest).toMatchObject({ id: 'exported-run', manifest: { schema: 'run-v1' } });
  const transition = JSON.parse(strFromU8(contents['transitions.jsonl']!).trim());
  expect(transition).toMatchObject({ startStep: 0, endStep: 4, ticks: 4 });
  expect(strFromU8(contents['summary.csv']!)).toContain('run_id,controller,seed');
});

test('surfaces IndexedDB write failures and does not falsely report persistence', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { DEFAULT_CONFIG } = await import('/packages/contracts/index.ts');
    const { saveRun, listRuns } = await import('/apps/web/src/storage.ts');
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () { throw new DOMException('quota injected', 'QuotaExceededError'); };
    let error = '';
    try { await saveRun({ id: 'quota-run', createdAt: '2026-04-01T00:00:00.000Z', status: 'completed', config: DEFAULT_CONFIG, controller: 'manual', manifest: { schema: 'run-v1' }, transitions: [], metrics: { success: false, reason: '', seconds: 0, collisions: 0, trackingError: 0, energy: 0, reward: 0, steps: 0, wallSeconds: 0, throughput: 0 } }); }
    catch (cause) { error = String(cause); }
    finally { IDBObjectStore.prototype.put = original; }
    return { error, runs: await listRuns() };
  });
  expect(result.error).toContain('quota injected');
  expect(result.runs).toEqual([]);
});

test('stores and reloads a clearly synthetic checkpoint fixture byte-for-byte', async ({ page }) => {
  const saved = await page.evaluate(async () => {
    const { DEFAULT_CONFIG } = await import('/packages/contracts/index.ts');
    const { checkpointHash } = await import('/packages/learning/index.ts');
    const { savePolicy } = await import('/apps/web/src/storage.ts');
    const shapes = [[20, 32], [32], [32, 32], [32], [32, 4], [4]];
    const checkpoint: any = { version: 'bc-v1', id: 'synthetic-checkpoint', createdAt: '2026-05-01T00:00:00.000Z', trainingSeed: 1, trainingSeeds: [1], validationSeeds: [2], testSeeds: [3], scenario: 'hover' as const, config: DEFAULT_CONFIG, mean: Array(20).fill(0), std: Array(20).fill(1), layers: shapes.map(shape => ({ shape, data: Array(shape.reduce((n, x) => n * x, 1)).fill(0) })), loss: [1], validationLoss: [1], samples: 1, epochs: 1, parityMaxError: 0, hash: '' };
    checkpoint.hash = checkpointHash(checkpoint);
    await savePolicy(checkpoint);
    return JSON.stringify(checkpoint);
  });
  await page.reload();
  const restored = await page.evaluate(async () => JSON.stringify((await (await import('/apps/web/src/storage.ts')).listPolicies())[0]));
  expect(restored).toBe(saved);
});

