# AI integrations validation

Branch: `codex/ai-training-integrations`, rebased onto Claude's Lumina District commit `6119376` (original base `6ffa7e8`). The rebase was conflict-free. A diff against `6119376` confirmed no changes to Claude's game implementation or assets.

## Scope boundary

No changes to sim-core dynamics, simulation worker, player input/controls, cameras, rendering, maps, models, audio, combat or visual styling. `App.tsx` edits are confined to laboratory/journal operations and their optional controls. Shared contract changes add optional checkpoint provenance fields. Existing game tests only gained configurable preview URLs so they cannot accidentally run against Claude's checkout.

No optimization pass was applied. [Optimization proposal](OPTIMIZATION_PROPOSAL.md) requires user approval before implementation.

## Executed checks

- TypeScript typecheck, ESLint and production Vite build passed.
- Main unit suite after rebase: 63 tests passed, including strict exchange import, real-physics dataset roundtrip and full checkpoint validation.
- Relay build and 17 API tests passed, including loopback restrictions, paired-browser enforcement, bridge budgets and response contracts.
- Python bridge smoke passed using the explicitly labelled example mapping: returned bounded action/provenance and rejected an invalid token. No neural model was used.
- SDK/terminal smoke passed: official MCP initialize/list/call and two successive Python CLI calls with transport cleanup. The test uses a labelled browser fixture, not a provider account.
- New production-browser integration tests passed: isolated policy reset/step with stale-step rejection, terminal preservation, journal export/replay/reload; Auto train and saved provenance/configurations; policy and dataset imports; paired policy UI with a labelled local-policy response fixture.
- Full 44-test browser regression initially passed 39 and failed 5. Two pointer-lock tests also failed unchanged on original commit `6ffa7e8` in this Chromium environment. A ground-bounce assertion passed on both the baseline and branch when rerun (intermittent). The remaining failures were test setup issues: Vite's dependency-discovery reload interrupted storage setup, and a synthetic checkpoint fixture used seeds outside the validated split ranges. Test setup/fixture corrections do not modify gameplay.
- Before rebase, final targeted production/browser regression: all 8 passed after the final source changes, covering all 3 new workflows, all 4 storage tests and the ground-bounce rerun. Existing example checkpoint also passed the stricter validator. The full suite is not claimed green because the two baseline pointer-lock failures remain.

After rebasing, typecheck, lint, all 63 unit tests and the production build passed. All 7 integration/storage browser tests passed on the combined version. The earlier full-game suite findings above were measured before the Lumina rebase.

A manual production-preview Hover run with a two-second episode budget trained 24 epochs on 720 samples: scripted 8/8, random 0/8, learned 2/8 held-out successes. These are measured results for that configuration, not promised training quality. The screenshot was saved as a handoff artifact; generated run data was not bulk committed.

## Limits and unverified integrations

No Ollama service responded at `127.0.0.1:11434`; no LM Studio service responded at `127.0.0.1:1234`. Real provider keys were not used. Local/cloud model protocols have fixture coverage, but a user-supplied model still needs live compatibility validation.

The connectome adapter is a validated runtime boundary. No full FlyWire brain dataset or neural simulator was installed. Its included rate-mapping example is a protocol demonstration, not a biological brain emulation. Neural populations, sensory encoding, timing and motor readout remain model-specific configuration.

Dataset imports require explicit ENU/SI/state-v1/nav-v1 mapping, complete episodes and real fields. The importer rejects unknown layouts, missing signals, interrupted/rate/arcade episodes and invalid timing. Limits are 25 MiB, 32 episodes, 100,000 transitions total and 14,400 per run. The browser journal's existing 64-run retention remains in place. Export important runs before collecting more. Large exports can exceed the import size limit; split them into smaller train/validation groups when re-importing.

External-policy episodes checkpoint every 120 transitions; an abrupt tab crash can lose the unflushed tail. API timeouts, pairing expiry and budget failures stop the policy loop and preserve an interrupted journal entry. The Python runtime executes the operator-selected local callable; it is not an OS-level VM. No real-drone/hardware connection is provided.

Published only as an isolated branch/draft PR. The production site is not intentionally redeployed or merged by this work. Repository hosting automation may create its own branch preview.
