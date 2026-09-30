# FPV redesign validation

Executed 2026-09-29. This update makes Explore the default FPV game, preserves Flight journal and AI Lab, and adds Aster Valley and Freddy’s Pizzeria. [Research](FPV_RESEARCH.md) covers Liftoff, Uncrashed, DRL Simulator, TRYP FPV, world-design references and real FPV camera references. [Asset provenance](PIZZERIA_ASSETS.md) records the original procedural fan-map geometry. Blender and downloaded model assets were not needed.

## Changes

- `App.tsx`, `GameOverlay.tsx`, `game.css`, `main.tsx`, `index.html`: full-viewport flight layout, world selection, minimap/landmarks, telemetry, Assisted/Acro, camera settings, retries, replay restoration, and secondary research navigation.
- `flight-controls.ts`, `Scene.tsx`: camera-relative Assisted movement, body-rate Acro, persistent throttle, standard Mode 2 axes, pointer-lock/drag look, FOV and tilt, and input lifecycle handling.
- `packages/contracts/free-world.ts`, `pizzeria-world.ts`, `packages/sim-core`: shared map geometry/collisions, optional backward-compatible map IDs, map-specific limits and reachable scripted targets.
- `OpenWorld.tsx`, `WorldDetails.tsx`, `PizzeriaWorld.tsx`, `FreddyModel.tsx`: original stylized world geometry, lights, surfaces and character.
- `agent-tools.ts`, `sim.worker.ts`, unit/browser tests: map selection through agent tools, authoritative state restoration, and regression coverage.
- Project guidance, README and research/provenance documents updated. Dependencies and lockfile did not change.

## Executed checks

- `npm run build`: passed TypeScript checking and Vite production build.
- `npm test`: 41/41 passed, including 26 simulation tests and 6 flight-control helper tests. The pizzeria scripted regression runs 30 simulated seconds, reaches within 2 m of its indoor target and times out with zero collisions. Other new checks cover the clear aisle, stage-bear collision, ceiling and outdoor bounds.
- `npm run lint`: passed.
- `npx playwright test`: 35/35 passed in 1.8 minutes against the production build and worker/storage harnesses. Nine FPV checks cover both maps, real drag and pointer-lock input, Assisted movement, Acro pitch/throttle beyond command expiry, retry/form isolation, camera switching while captured, replay exit/resume and agent-started indoor flight. Original recording, export, worker and AI Lab flows remain covered. The movement check waits for physical displacement instead of assuming instantaneous acceleration in a 450 ms window.
- `npm run typecheck`: passed after browser-test updates.
- Independent review found and drove fixes for input timer churn, FLU signs, gamepad axes, Acro command expiry, sensitivity units, banked camera direction, pointer-lock lifecycle, replay restoration and indoor scripted guidance.
- Release review: no credential-shaped values or new runtime external assets found; `git diff --check` passed. Generated dependencies/builds/results remain ignored. No LFS uploads required.
- Visual inspection in the Codex browser confirmed both worlds, the HUD and the lit Freddy stage. Hidden-tab FPS readings are not used as a performance benchmark.

## Agents and routing

Agents worked in discovery, implementation and verification waves. Each had bounded ownership and no grandchildren; the runtime ceiling was respected. Requested routes below were not runtime-verifiable, so effective routing is **unverified** for every role.

| Role | Requested route | Owned scope / reason for parallel work |
|---|---|---|
| fpv_controls_scout | Luna / Medium | Input and camera discovery |
| fpv_world_scout | Luna / Medium | World/physics integration discovery |
| fpv_game_research | Luna / Medium | Primary-source FPV/game research and brief |
| fpv_controls_impl | Terra / High | Input/camera implementation; timer and coordinate correctness |
| fpv_world_impl | Terra / High | Outdoor world, shared colliders and surface details |
| fpv_pizzeria_impl | Terra / High | Indoor map, original Freddy, props and lighting |
| fpv_controls_review | Sol / High | Independent control and integration review |
| fpv_browser_tests | Terra / Medium | Production browser acceptance and regression tests |
| fpv_release_review | Terra / Medium | Independent Git, assets, secrets and deployment hygiene |

The parent integrated the modules, built the HUD, repaired integration findings, ran unit/build/lint checks and owns publication. Initial overlapping browser invocations invalidated one trial run; those results were discarded and the verification lane was made exclusive.

## Limits

This is a stylized browser flight game, not an aircraft-validated simulator. Free-flight recordings last two minutes; retry starts a fresh recording. Valley bounds are ±200 m with a 100 m ceiling; indoor bounds are ±25 m with a 6 m ceiling. Major objects have collision geometry; decorative surface details do not add colliders. Freddy is a static original procedural model in an unofficial fan map.

Keyboard and gamepad are required for flight. Physical gamepad hardware was unavailable; mapping has automated coverage. No touch flight controls or multiplayer are included. Current visual/performance checks do not establish cross-device frame-rate guarantees. Core runs and policies remain device-local in IndexedDB. The optional external AI relay remains unhosted and live provider episodes remain unverified; browser experiments, local training, replay and export are available without it. Earlier research-pipeline evidence is preserved in [VALIDATION.md](VALIDATION.md).
