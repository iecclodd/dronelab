# Architecture

The product is split into a static browser application and an optional Node relay.

```text
React/Vite UI
  ├─ Three/R3F renderer
  ├─ simulation worker ── packages/sim-core ── Rapier
  ├─ training worker ──── TFJS CPU / pure TS predictor
  └─ IndexedDB storage (runs, transition chunks, policies)
                         │ optional paired polling
apps/api Node relay ─────┴─ MCP transport and provider adapters
```

`packages/contracts` is the versioned boundary. The current version is `dronelab-0.1.0`; the fixed physics step is `1/120` seconds and the default action repeat is four ticks. `apps/web/src/simulation.ts` sends worker requests with generation, epoch, request ID, and optional expected step. The worker is the simulation authority. Reset/stop advances authority and stale requests are rejected. The relay forwards validated commands and results but never starts, steps, reconstructs, or simulates a world.

## Executor frames and behavior

The physics executor is renderer-free Rapier. World coordinates are right-handed ENU (`x` east, `y` north, `z` up); the body is FLU; quaternions are `[x,y,z,w]`. Rendering converts ENU to Three coordinates `[x,z,-y]` and quaternions `[x,z,-y,w]`. The model is a 1 kg quad with explicit inertia `[0.025,0.025,0.045]`, four clamped 5.8 N rotors, 45 ms motor lag, drag, wind, ground contact, and seeded noise/delay. Gates are four collision bars, not invisible solid walls.

Actions are either navigation `{kind:"nav", velocity:[x,y,z], yawRate}` bounded to ±3 m/s and ±1.5 rad/s, or normalized rate `{kind:"rate", rates:[x,y,z], thrust}`. Navigation feeds velocity, attitude/rate, and motor loops. The scripted controller consumes the policy-visible delayed/noisy observation; random is a baseline. A step applies a bounded action for up to four physics ticks and stops early at terminal or timeout, reporting actual `ticks`, start/end steps, requested/applied action, observations, state, and reward components.

Observations are `state-v1`: relative target (3), velocity (3), quaternion (4), angular velocity (3), six normalized axis ranges, battery (1), prior action, timing, and source/delivery steps. Rewards sum per-tick tracking, progress, energy, collision, and success terms. Terminal transitions remain in the run, including the transition that causes collision, success, or timeout.

The training worker is TensorFlow.js 4.22 on CPU: Dense `20→32→32→4`, tanh activations, navigation outputs, capped at 20,000 transitions per split and batches of at most 128. Complete episodes with seeds `<20000` train; `20000–29999` validate; `30001–30008` are the frozen closed-loop test manifest. The checkpoint stores preprocessing, split IDs, loss arrays, serialized weights, and a content hash. Pure TypeScript inference is checked against TFJS on up to 32 validation observations before saving.

The optional relay uses authenticated long polling and Streamable HTTP MCP. Browser pairing carries generation and authority epoch. Polling renews a short heartbeat; commands have bounded queue/deadline/response size and request-id idempotency. Long jobs return a job ID for later status or cancellation. The relay is operator-trusted and in-memory; it is not a simulation authority or a durable job store.
