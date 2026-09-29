# DroneLab
Vite + React + TypeScript static website; Three/R3F render browser-worker Rapier ENU physics. TFJS CPU worker trains navigation behavior cloning; IndexedDB stores device-local runs and policies. No visitor backend requirement.

Ownership: packages/contracts = shared versioned interfaces; packages/sim-core = DOM-free physics/controllers/tasks; apps/web/src = UI, workers, storage; apps/api and packages/mcp-server = optional authenticated relay; tests = unit/browser acceptance; docs = evidence/specifications.

Commands: npm install; npm run dev; npm run typecheck; npm run lint; npm test; npm run build; npm run preview; npm run test:browser. Deploy dist as static HTTPS assets. Never bundle provider keys. No real-drone connections. No state fabrication. Preserve terminal transitions and entire-episode evaluation splits. Store generated runs in browser or outputs, never bulk commit.

Use bounded depth-one agents; no grandchildren. Parent owns integration and publishing; only disjoint files may be written concurrently. Prefer Terra Medium implementation, Sol High independent review. Report effective routes as unverified unless runtime metadata proves them. Done means executed production browser flight/training/reload/replay/export checks, tests/build/lint passing, limits documented, deployment truthfully reported.
