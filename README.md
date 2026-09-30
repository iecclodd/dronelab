# DroneLab

DroneLab is an FPV browser playground with Assisted and Acro handling, mouse look, and two explorable worlds. Fly Aster Valley's hangars, container yard, canyon and viaduct, or thread the party tables in Freddy’s Pizzeria, an unofficial fan map with an original procedural Freddy model. The React/Vite UI renders a Three.js scene while a browser worker owns the Rapier simulation. Runs and behavior cloning policies stay in IndexedDB on the current device; no backend is required for the core experience.

## Use the product

Open [DroneLab](https://dronelab-dun.vercel.app/), choose a world and press **Take flight**. Assisted movement follows your view and brakes when released. Acro uses body rates and manual throttle without automatic leveling. Mouse look captures the cursor; dragging on the world also works. FPV, Chase and Orbit cameras are available. Flight setup adjusts field of view, camera tilt and mouse sensitivity, and contains the Hover, Gates and Landing practice missions plus controller settings.

Flight journal replays saved transitions and exports a run ZIP. AI Lab runs bounded seeded episodes, trains a behavior-cloning policy from scripted Hover demonstrations, and evaluates scripted, random and learned controllers on frozen test seeds. Capture frame is available while paused at the expected simulation step. [FPV research](docs/FPV_RESEARCH.md) records the game/design references; [pizzeria provenance](docs/PIZZERIA_ASSETS.md) documents the original geometry.

The browser stores up to 64 runs and records up to 14,400 transitions per run. A recording interrupted by reload is recovered as `interrupted` from IndexedDB chunks. Exported runs contain `manifest.json`, `transitions.jsonl`, `events.jsonl`, and `summary.csv`; see [data formats](docs/data-formats.md).

The Connect AI panel is optional. It requires an operator-configured HTTPS relay and short-lived browser pairing; the static game, experiments, recording, replay, and training work when the relay is absent. Provider keys remain server-side and are never frontend `VITE_*` values.

## Develop

From this directory:

```powershell
npm ci
npm run dev
npm run build
npm run preview
npm test
npm run typecheck
npm run lint
npx playwright install chromium
npm run test:browser
```

`npm run dev` serves Vite on `127.0.0.1`; `preview` uses port 4173. The browser suite needs Playwright's Chromium installation.

The optional relay is independent:

```powershell
cd apps/api
npm ci
Copy-Item .env.example .env
# Set DRONELAB_RELAY_SECRET and exact DRONELAB_ALLOWED_ORIGINS in .env.
npm run build
npm test
npm run smoke
node --env-file=.env dist/index.js
```

It requires Node 20+, a high-entropy `DRONELAB_RELAY_SECRET`, and exact allowed HTTPS origins. Provider credentials and models are unset by default, so the server is intentionally unconfigured until an operator supplies them. See [AI/MCP relay](docs/ai-mcp.md).

## Evidence and scope

The latest executed checks and limitations are in [VALIDATION.md](docs/VALIDATION.md). The repository includes a real [trained checkpoint](examples/hover-bc-checkpoint.json), its [evaluation](examples/evaluation.json), a [scripted hover run](examples/hover-run.json), and [browser compatibility measurements](examples/compatibility.json). These are deliberate small examples, not synthetic training results. The checkpoint was trained in Chromium with TFJS CPU on 661 demonstration samples; its held-out success rate was 5/8 versus 8/8 for scripted control. Use the website's Train policy button to create and save a new policy on your device.

Keyboard controls are W/S forward/back, A/D strafe, Space/Shift climb/descend, Q/E yaw left/right, and Ctrl boost in Assisted. Acro changes W/S to pitch, A/D to roll and Space/Shift to throttle. R retries, C cycles cameras, P pauses and Escape releases mouse capture and pauses. A standard Mode 2 gamepad layout is supported. The game pauses when the window loses focus; resume explicitly. Free-flight recordings last up to two minutes before retry. Valley limits are ±200 m and 100 m altitude; pizzeria limits are ±25 m and 6 m altitude. Open `#experiment` or `#review` to link directly to a view. Touch-only flight controls are not provided.

The simulation uses ENU coordinates and FLU body axes, fixed-step transitions, seeded sensor noise/delay, explicit reward components, and terminal transition preservation. It is a browser gameplay model, not a real aircraft model. PPO/RL, image/depth observations, farm execution, and live provider verification are not implemented. See [architecture](docs/architecture.md) and [roadmap](docs/roadmap.md).
