# Optimization proposal — awaiting user approval

No optimization pass is applied on this branch. Game design, mechanics, renderer, physics cadence, asset loading and existing quality tiers are left unchanged. The optional local runtime is an integration boundary: no new PyTorch, ONNX or connectome engine is bundled into the game.

Before changing implementation, measure production build transfer size, idle/flight/AI-Lab memory, frame time p50/p95, worker step throughput, training latency and IndexedDB write/export cost on the user's machine. Measure with identical scene, seed and quality setting; repeat with a local policy process enabled.

| Proposed change (not applied) | Benefit to measure | Acceptance gate |
| --- | --- | --- |
| Initialize the existing training runtime only when used | Reduced startup memory and CPU work | Identical training results and responsive first-use progress |
| Separate existing game and laboratory bundles | Smaller initial payload for game-only visits | No regressions in either entry path or offline navigation |
| Stream dataset import/export and IndexedDB batches | Lower peak memory for larger external datasets | Exact transition counts, terminal flags and split hashes preserved |
| Transfer packed observation arrays to a local runtime | Lower serialization cost | Bitwise or bounded numeric parity and stale-response checks preserved |
| Profile local inference batching/caching | Faster evaluation | No action reused across incompatible steps or episodes |
| Make research rendering optional while collecting episodes | Lower GPU load during training | No changes to simulation time, dynamics or gameplay behavior |

Do not change game art, controls or physics as an optimization. Do not reduce observation fidelity or silently drop failed episodes. Report baseline and after measurements and obtain approval before implementing any row.

## Measured build baseline

Before the Lumina District rebase, on the same machine/toolchain, Vite reported these production artifacts for original
commit `6ffa7e8` and the integration patch on that base (decimal kB; no optimization applied):

| Artifact | Original | Integrations |
| --- | ---: | ---: |
| Main JavaScript | 1,656.66 kB | 1,691.00 kB |
| Main JavaScript gzip | 477.32 kB | 487.54 kB |
| Training worker | 1,618.83 kB | 1,623.21 kB |
| Simulation worker | 4,369.20 kB | 4,372.78 kB |
| CSS | 42.83 kB | 42.83 kB |

The main compressed payload increased by about 10.22 kB. Worker changes include
shared checkpoint validation; the simulation implementation was not edited. These
are artifact sizes, not measured startup latency, GPU load or peak memory. The
profiling and changes above still require approval.

After incorporating Claude's Lumina District commit `6119376`, the combined main
JavaScript is 1,722.55 kB (498.13 kB gzip), CSS is 46.17 kB, and simulation worker
is 4,376.05 kB. This is a different game baseline; do not attribute its additional
art, geometry or rendering payload to the AI patch. No optimization was applied.
