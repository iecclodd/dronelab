# Browser data validation

The browser acceptance suite creates a small real `DroneEnvironment` run through the Vite module graph, then validates IndexedDB persistence, interrupted-recording chunk recovery after a reload, deletion, the 64-run retention limit, and ZIP download contents.

The checkpoint persistence test uses a deliberately **synthetic** shape-valid `bc-v1` fixture. It verifies storage fidelity only; it does not claim that a policy was trained or that its performance was evaluated.

The suite injects an `IndexedDB` `QuotaExceededError` at the object-store write boundary. The storage call must reject and `listRuns()` must remain empty, preventing a false persistence success.
