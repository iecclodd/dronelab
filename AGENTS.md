# DroneLab
The main experience is an FPV browser playground: Explore defaults to free flight, first-person camera, and Assisted handling; Acro is a distinct body-rate/manual-throttle mode. Flight journal and AI Lab preserve replay, experiments, training, and browser-agent tools as secondary features.
Vite + React + TypeScript static website; Three/R3F render browser-worker Rapier ENU physics. TFJS CPU worker trains navigation behavior cloning; IndexedDB stores device-local runs and policies. No visitor backend requirement.

Ownership: packages/contracts = shared versioned interfaces; packages/sim-core = DOM-free physics/controllers/tasks; apps/web/src = UI, workers, storage; apps/api and packages/mcp-server = optional authenticated relay; tests = unit/browser acceptance; docs = evidence/specifications.

FPV boundaries: packages/contracts/free-world.ts and pizzeria-world.ts define ENU map geometry shared with physics; OpenWorld/PizzeriaWorld render the matching world, Scene owns the camera/drone, flight-controls owns input, and GameOverlay/game.css own the player HUD. Keep optional mapId backward compatible. Significant playable objects must match colliders. Use original or clearly licensed assets, record provenance, and avoid adding runtime external asset dependencies. Pointer-lock loss, blur, and visibility changes must release controls and pause. Test real browser input, not only pure input helpers.

Commands: npm install; npm run dev; npm run typecheck; npm run lint; npm test; npm run build; npm run preview; npm run test:browser. Deploy dist as static HTTPS assets. Never bundle provider keys. No real-drone connections. No state fabrication. Preserve terminal transitions and entire-episode evaluation splits. Store generated runs in browser or outputs, never bulk commit.

Use bounded depth-one agents; no grandchildren. Parent owns integration and publishing; only disjoint files may be written concurrently. Prefer Terra Medium implementation, Sol High independent review. Report effective routes as unverified unless runtime metadata proves them. Done means executed production browser flight/training/reload/replay/export checks, tests/build/lint passing, limits documented, deployment truthfully reported.

## Anime arcade pass

Explore explicitly selects `flightFeel: arcade`. Omitted profiles and practice missions retain research behavior; don't silently apply arcade physics to scientific comparisons. `drone-audio.ts` owns gesture-gated synthesized playback. `BlenderDrone.tsx` loads the self-contained `public/models/neon-quad.glb`; `tools/build_neon_quad.py` is its reproducible Blender CLI source. Keep large editable .blend/render artifacts in sibling outputs. `Scene.tsx` and `GameOverlay.tsx` own velocity/impact effects; respect the Motion effects setting and reduced-motion default. Use one Playwright runner at a time.

## Cel visual pass

`toon-pipeline.tsx` owns rendering (priority-1 `useFrame`): colour pass → normal/depth pass → ink/grade composite, with Auto/High/Balanced/Performance tiers. New meshes are inked unless they are transparent, Basic/Shader materials, lines or points; opt in with `userData.ink` or out with `userData.noInk`. `ValleySky`/`ValleyDressing`/`PizzeriaDressing`/`WorldFx` hold non-colliding dressing only: keep scenery outside the flight bounds or flush with or inside existing colliders. `nav-store.ts` shares next-spot state between GameOverlay and the beacons. Research and sources: docs/CEL_SHADING_RESEARCH.md.

## Arcade combat pass

Explore's arcade profile is a hover-ball model (sim-core `arcadeDrive`): camera-relative velocity chase, reflective bounces, springy map edges, and one-shot `impulse`/`pulse` kicks on actions. Never apply it to research or missions. `combat-store.ts` connects input, `CombatLayer.tsx` (gun, targets, explosions, ramming) and `CombatHud.tsx`. `window.dronelabCombat` is a read-only test hook. Keep new bindings consistent with docs/ARCADE_COMBAT.md.
