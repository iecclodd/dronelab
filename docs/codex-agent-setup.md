# Codex agent setup

DroneLab is a Vite/React/TypeScript static site with browser-worker Rapier physics, TFJS CPU training, IndexedDB persistence, and an optional Node 20+ relay. Ownership boundaries are `packages/contracts` (shared interfaces), `packages/sim-core` (DOM-free physics/controllers/tasks), `apps/web/src` (UI/workers/storage), `apps/api` and `packages/mcp-server` (optional authenticated relay), tests (unit/browser acceptance), and `docs` (evidence/specifications).

The primary product is now an FPV game. `flight-controls.ts` owns keyboard/gamepad/mouse state; `Scene.tsx` owns camera transforms; `GameOverlay.tsx` and `game.css` own the flight HUD. Shared `free-world.ts` and `pizzeria-world.ts` definitions connect rendered structures with physical colliders. The original research functionality lives in AI Lab and Flight journal. Keep local assets self-contained and record model provenance. New control changes need real browser input checks and review of ENU/FLU signs, pointer lock, timer lifecycle, and throttle command lifetime.

Browser verification has one exclusive runner: never launch overlapping Playwright commands against the shared ports and artifact directories. Read-only review agents must not start a second browser suite. Three substantial FPV writers used isolated worktrees; parent UI and browser-test edits used disjoint files in the primary checkout. The depth-one/seven-concurrent ceiling remained in force; effective child routing was not observable.

## Working rules

Use bounded depth-one agents with a seven-concurrent ceiling. Reuse the shared repository map and isolated worktrees for disjoint writers; never have two agents edit the same file. Parent owns integration, final validation, and publishing. Report requested and effective model/effort separately; effective routing is unverified unless runtime metadata proves it. Preserve terminal transitions, complete-episode split IDs, and user changes. Store generated runs in browser storage or outputs; do not bulk commit them. Never connect a real drone or bundle provider secrets.

Suggested roles are a Luna scout for exact repository evidence, a Terra implementation agent for isolated changes, and a Sol independent review for architecture/security or release claims. This documentation pass was assigned to a Luna Medium docs writer; effective routing was not observable. The parent validation lane owns real-browser acceptance and deployment truth.

## Commands

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

For the optional relay, from `apps/api`: `npm ci`, configure `.env` from `.env.example`, then `npm run build`, `npm test`, `npx tsx test/browser-smoke.ts`, and `node --env-file=.env dist/index.js`. Set a high-entropy `DRONELAB_RELAY_SECRET` and exact `DRONELAB_ALLOWED_ORIGINS`; provider environment variables remain unset unless deliberately configured. The server is intentionally unconfigured by default. `npm start` only works when the environment has already been exported.

Definition of done is evidence from the appropriate checks: production browser flight/training/reload/replay/export, tests/build/lint/typecheck, truthful relay status, and documented limitations. Known risks include browser/WebGL variance, device-local-only state, the modest game physics model, lack of PPO/RL and image/depth learning pipelines, no execution farm, no live provider verification, and the operator-trusted in-memory relay. RGB frame capture exists in the renderer and is step-guarded; image/depth policy learning does not.

## September 29–30 anime arcade execution

Seven bounded child roles were used across waves: arcade flight and full input audit (requested Terra High); procedural audio (Terra Medium); cel-shaded worlds (Terra Medium); Freddy model (Terra Medium); Blender CLI drone asset (Terra High); exclusive browser regression runner (Terra Medium); independent integration reviewer (Sol High). The harder flight lane spans physical controls and fixed-step collision semantics; the Blender lane handles version-dependent CLI/exporter behavior. Those complexities justified High. Effective routing is unverified for every child; pins/self-reports are not runtime proof. No grandchildren were spawned. Three art/physics writers used isolated existing worktrees; audio, asset and test writers used disjoint files in the primary checkout in separate waves. Parent integrated App/Scene/HUD, refined visual balance, reviewed evidence and owns publication.
