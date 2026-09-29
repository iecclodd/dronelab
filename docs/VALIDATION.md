# Validation record

This record separates executed evidence from checks still owned by the parent integration lane. Effective child model routing was unverified for every role.

## Executed evidence

The unit suite reported 28 tests: 19 physics, 4 learning, and 5 dispatcher checks. The API lane reported 12 tests, a TypeScript build, SDK fixture smoke, and an actual production-browser MCP bridge test. The browser bridge exercised 15 tool calls, 5 jobs, 3 authority changes, and rejected a disconnect correctly. The exact API browser smoke command is:

```powershell
cd apps/api
npx tsx test/browser-smoke.ts
```

Independent physics review covered 48/48 scripted Hover, Gates, and Landing runs over seeds 0–15 with zero collisions. The reviewed fixes covered ordered gate completion, pre-impact hard landing behavior, body torque, and frame conversion.

The committed `examples/evaluation.json` records a real browser training/persistence/evaluation run. It used 661 samples and 24 epochs with training seed 41001; training seeds were 10001–10012, validation seeds 20001–20004, and the frozen test seeds 30001–30008. Loss moved from `0.097643` to `0.000562`, validation loss from `0.333354` to `0.250561`, pure/TF parity maximum error was `8.12e-8`, and the persisted policy hash was `5094e435`. Held-out results were scripted 8/8, random 1/8, and learned 5/8; learned evaluation included 3 collisions. These are observed experiment results, not a claim of aircraft performance.

The compatibility audit recorded Firefox at 56 FPS and Edge at 122 FPS on a 1280×800 viewport using an Intel i7-14700F and RTX 4060 Ti. It was a headless smoke audit, not a stable benchmark; startup throughput values of 17,385 and 3,767 are likewise not stable benchmarks. Both browsers completed train, persist, learned flight, and step 88 with zero errors.

## Commands

Root scripts are `npm ci`, `npm run build`, `npm test`, `npm run typecheck`, `npm run lint`, `npx playwright install chromium`, and `npm run test:browser`. The optional API uses `npm ci`, `npm run build`, `npm test`, `npx tsx test/browser-smoke.ts`, and `node --env-file=.env dist/index.js` after setting the secret and allowed origin. The parent owns the final rerun of the stable production app and Vite harness browser checks.

## Pending and limits

The final browser rerun is pending at the time of this record. The deployment URL is pending parent confirmation; no URL is asserted here. No live provider keys were configured, and the relay code was tested locally rather than hosted. PPO/RL, image/depth learning, farm execution, and shared durable run storage remain deferred. All effective model routes are unverified. The optional relay remains operator-trusted and in-memory.
