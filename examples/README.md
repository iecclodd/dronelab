# Measured examples

- `hover-bc-checkpoint.json`: actual TFJS CPU behavior-cloning weights, training seed 41001, 661 training samples from 12 whole Hover episodes and 4 separate validation episodes, 24 epochs. Hash `5094e435`.
- `evaluation.json`: recorded Chromium cancellation, training, pure-inference parity, IndexedDB reload, and paired held-out evaluation. Scripted 8/8, random 1/8, learned 5/8 successes. Every tested episode is included in the aggregate; the learned model had 3 collisions.
- `hover-run.json`: actual scripted Hover rollout with seed 90001, 57 transitions and a preserved success terminal state, generated through the production browser worker.
- `compatibility.json`: actual Firefox/Edge smoke results. Short headless FPS and throughput samples are not sustained performance benchmarks.
- `flight.png`: screenshot of the functioning production renderer and UI; telemetry reflects the current paused state.

These are small intentional source-controlled artifacts. Larger user recordings and training checkpoints remain in IndexedDB until explicitly exported. These experimental simulator results do not establish real-aircraft performance or learned-controller superiority.
