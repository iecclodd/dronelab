# Validation record

For the subsequent FPV game redesign and two new worlds, see [FPV validation](FPV_VALIDATION.md). The evidence below describes the original research-workbench release.

Executed locally on 2026-09-29. Effective child model routing was unverified for every role; the runtime exposed agent status but no authoritative child model/effort metadata.

## Executed evidence

The unit suite passed 29 tests: 20 physics, 4 learning, and 5 dispatcher checks. The Chromium browser suite passed 26 tests: 8 production UI flows, 14 worker contract checks, and 4 IndexedDB/export checks. A subsequent focused storage rerun verified recovered interruption metrics. Root lint, TypeScript checking, and production build passed. The API passed 12 tests, a TypeScript build, SDK fixture smoke, and an actual production-browser MCP bridge test. The browser bridge listed 15 tools, executed 5 calls, accepted 3 authority updates, and rejected calls after disconnection. The MCP helper package typecheck passed. Production dependency audits reported zero vulnerabilities for both root and API packages. The exact API browser smoke command is:

```powershell
cd apps/api
npx tsx test/browser-smoke.ts
```

Independent physics review covered 48/48 scripted Hover, Gates, and Landing runs over seeds 0–15 with zero collisions. The reviewed fixes covered ordered gate completion, pre-impact hard landing behavior, body torque, and frame conversion.

The committed `examples/evaluation.json` records a real browser training/persistence/evaluation run. It used 661 samples and 24 epochs with training seed 41001; training seeds were 10001–10012, validation seeds 20001–20004, and the frozen test seeds 30001–30008. Loss moved from `0.097643` to `0.000562`, validation loss from `0.333354` to `0.250561`, pure/TF parity maximum error was `8.12e-8`, and the persisted policy hash was `5094e435`. Held-out results were scripted 8/8, random 1/8, and learned 5/8; learned evaluation included 3 collisions. These are observed experiment results, not a claim of aircraft performance.

The compatibility audit in `examples/compatibility.json` recorded Firefox at 56 FPS and Edge at 122 FPS on a 1280×800 viewport using an Intel i7-14700F and RTX 4060 Ti. It was a headless smoke audit, not a stable benchmark; startup throughput values of 17,385 and 3,767 physics ticks/s are likewise not stable benchmarks. Both browsers completed training, persistence, and learned flight to step 88 with zero page/console errors. The differing Firefox and Chromium checkpoint hashes demonstrate why cross-browser bit-identical training is not promised.

The independent final reviewer reproduced and verified fixes for six issues: 4 MB/60-second result-cache bounds (oversized replay returns `result_replay_unavailable`); failed operations become failed jobs; cancellation of completed jobs cannot stop unrelated flight; valid 120-second/240-Hz episodes reach 7,200 decisions and a timeout terminal state; tool pause synchronizes UI and renderer; and a WebGL-disabled browser reports RGB unavailable. The reviewer also verified that `set_mission` starts the scripted controller. Free flight remains open until a failure, Stop, or timeout; the manual Stop test uses that scenario so an early Hover success does not invalidate its precondition.

The production bundle includes local fonts and embedded Rapier WASM inside the simulation worker. Final assets include a roughly 1.44 MB main JS bundle (410 KB gzip), 4.36 MB simulation worker, and 1.62 MB CPU training worker. Optional AI endpoints were unavailable throughout core browser acceptance. A Three.js `Clock` deprecation warning comes from the rendering dependency; it did not produce page errors.

## Commands

Root scripts are `npm ci`, `npm run build`, `npm test`, `npm run typecheck`, `npm run lint`, `npx playwright install chromium`, and `npm run test:browser`. The browser script builds first, serves UI tests from the production bundle on port 5182, and uses a Vite module harness on port 5181 for worker/storage probes. This prevents dev dependency-reload events from invalidating UI tests. The optional API uses `npm ci`, `npm run build`, `npm test`, `npm run smoke`, `npx tsx test/browser-smoke.ts`, and `node --env-file=.env dist/index.js` after setting the secret and allowed origin.

## Pending and limits

Deployment is tracked separately in `docs/DEPLOYMENT.md`. No live provider keys were configured, and the relay code was tested locally rather than hosted. OpenAI, Anthropic, and Gemini adapters passed offline contract fixtures; none has a live successful provider-driven episode. Provider planning is an explicit one-shot request with visible telemetry and validated mission/stop calls; continuous replanning and persistent agent decision traces remain future work. PPO/RL, image/depth learning, farm execution, and shared durable run storage remain deferred. Gamepad mapping/calibration is implemented but no physical gamepad was available for hardware validation. Mobile navigation was tested; keyboard/gamepad are required for flight. IndexedDB is device-local, quota-limited, and may be evicted; simultaneous editing across tabs is not validated. The optional relay is operator-trusted, in-memory, and needs its own persistent TLS host. Evaluation covers a single trained checkpoint, with episode-level Wilson success intervals in the UI; no superiority claim or training-seed uncertainty is asserted.

## Agent work and changed files

Fourteen agents contributed across discovery, implementation, and independent verification waves. The runtime enforced seven concurrent agents including the parent, so later work reused slots. All writers had isolated Git worktrees and explicit ownership; depth remained one. Requested routes below are not evidence of effective routing.

| Agent | Requested model / effort | Exclusive scope or independent check |
|---|---|---|
| sim_design | Sol / Medium | Simulation architecture and contracts |
| learning_design | Sol / High | Split, normalization, evaluation methodology |
| physics_impl | Terra / High | `packages/sim-core`, physics notes |
| learning_impl | Terra / Medium | `packages/learning`, training worker/client |
| relay_impl | Terra / High | `apps/api`, `packages/mcp-server`, SDK tests |
| interface_impl | Terra / Medium | Initial App/UI; later dispatcher repair |
| worker_tests | Terra / High | Worker tests; bounded worker/client fixes |
| training_validation | Terra / Medium | Independent training contract review |
| security_review | Sol / High | Authentication, origin, TTL, provider budget review |
| data_validation | Terra / Medium | IndexedDB and export browser tests |
| physics_review | Sol / High | Torque, gate, landing regression reproduction |
| browser_acceptance | Terra / Medium | Real training, reload, evaluation, browser compatibility |
| product_docs | Luna / Medium | Architecture, data formats, launch/evidence documentation |
| final_review | Sol / High | Independent six-finding integration review/retest |

The parent integrated all modules, implemented the renderer/storage/connection flow, repaired cross-module state handling, and owns publication. The new repository contains the complete `apps/web`, `packages/contracts`, `packages/sim-core`, `packages/learning`, optional `apps/api`/`packages/mcp-server`, `tests`, `docs`, `public` assets, locked package/configuration files, project `AGENTS.md`, and deliberate `examples`. No unrelated existing project files were replaced.
