# Worker browser validation

`npm run test:browser -- --config playwright.config.ts` starts the isolated Vite harness on port 5181 and runs one browser worker at a time.

The harness imports the production `SimulationClient` and `sim.worker.ts`; it does not stub Rapier, the worker protocol, or scheduling. The suite exercises physics readiness, generation/epoch authority, request-id replay, clock-mode gating, serial concurrent advances, snapshot/restore, terminal stability, realtime stop responsiveness, and cancellation of a yielding batch.

The visibility-suspension branch depends on an actual delayed worker timer, which Playwright cannot reliably force while a foreground page remains active. The realtime stop test covers the feasible cancellation policy: once stopped, subsequent timer intervals do not advance the simulation.
