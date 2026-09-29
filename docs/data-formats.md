# Data formats

The shared TypeScript contracts in `packages/contracts/index.ts` are authoritative. Formats below describe the current `0.1.0` implementation.

## Run manifest and transitions

Each run is a `RunRecord` with `id`, `createdAt`, `status`, `config`, `controller`, optional `policyId`, `manifest`, `transitions`, and `metrics`. The manifest has `version: "dronelab-0.1.0"`, `schema: "run-v1"`, `configHash`, `physics: "rapier3d-0.21.0"`, `frame: "ENU / body FLU / xyzw"`, `action` (`nav-v1` or `rate-v1`), `observation: "state-v1"`, `reward: "mission-v1"`, `dt`, `actionRepeat: 4`, `aggregation: "sum of per-tick components"`, seed, wall start, and wind/noise/delay randomization. Learned runs also carry `policyHash`.

Each `Transition` contains `observation`, `requestedAction`, `appliedAction`, `nextObservation`, scalar `reward`, `components` (`tracking`, `progress`, `energy`, `collision`, `success`, `total`), physical `state`, `startStep`, `endStep`, actual `ticks`, decision number, terminal/truncated flags, reason, wall time, and `validThroughStep`. Export validation requires monotonic timing, `ticks === endStep - startStep`, finite reward, reward equal to component total, and observation source step no later than delivery step.

## ZIP export

The Review view exports `dronelab-<first-eight-id>.zip` after validation:

* `manifest.json` is the run metadata with transitions omitted.
* `transitions.jsonl` has one JSON `Transition` per line, including terminal transitions.
* `events.jsonl` contains terminal/truncated/collision events with `step`, `reason`, and collision component.
* `summary.csv` has one row and the columns `run_id,controller,seed,success,reason,seconds,collisions,tracking_error_m,energy_proxy,reward`.

Runs are persisted in IndexedDB database `dronelab` version 1: `runs`, `chunks` (indexed by `runId`), and `policies`. At most 64 runs are retained; active recordings are chunked and recovered after reload.

## Policy checkpoint

Saved policy JSON is `PolicyCheckpoint` version `bc-v1`: `id`, `createdAt`, `trainingSeed`, `trainingSeeds`, `validationSeeds`, `testSeeds`, `scenario`, `config`, 20-value `mean` and `std`, six serialized layer arrays with shapes `[20,32]`, `[32]`, `[32,32]`, `[32]`, `[32,4]`, `[4]`, training and validation loss arrays, `samples`, `epochs`, `parityMaxError`, and `hash`. Normalization floors standard deviation at `1e-3` and clips features to `[-5,5]`; the content hash excludes display ID and creation time.

## Relay envelopes

The optional relay uses `POST /sessions` with `{generation,authorityEpoch}` and returns session/browser/MCP tokens, identity, expiry, and `pollAfterMs`. Browser polls return commands with `id`, `requestId`, `name`, `args`, generation, authority epoch, and expiry. Results return command/request IDs, the old envelope authority, `ok`, and `result` or `error`; successful reset/stop may include the newer `{generation,epoch}` authority. Pair tokens are sent in `X-DroneLab-Pair-Token`, never query strings.
