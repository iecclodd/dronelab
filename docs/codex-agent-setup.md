# Codex agent setup

DroneLab is a Vite/React/TypeScript static site with browser-worker Rapier physics, TFJS CPU training, IndexedDB persistence, and an optional Node 20+ relay. Ownership boundaries are `packages/contracts` (shared interfaces), `packages/sim-core` (DOM-free physics/controllers/tasks), `apps/web/src` (UI/workers/storage), `apps/api` and `packages/mcp-server` (optional authenticated relay), tests (unit/browser acceptance), and `docs` (evidence/specifications).

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

For the optional relay, from `apps/api`: `npm ci`, configure `.env` from `.env.example`, then `npm run build`, `npm test`, `npm run smoke`, and `npm start`. Set a high-entropy `DRONELAB_RELAY_SECRET` and exact `DRONELAB_ALLOWED_ORIGINS`; provider environment variables remain unset unless deliberately configured. The server is intentionally unconfigured by default.

Definition of done is evidence from the appropriate checks: production browser flight/training/reload/replay/export, tests/build/lint/typecheck, truthful relay status, and documented limitations. Known risks include browser/WebGL variance, device-local-only state, the modest game physics model, lack of PPO/RL and image/depth pipelines, no execution farm, no live provider verification, and the operator-trusted in-memory relay.
