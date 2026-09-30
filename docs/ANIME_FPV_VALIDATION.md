# Anime arcade validation

Release candidate built September 29–30, 2026. Local release gates passed; the publication receipt is maintained in the sibling `outputs/GITHUB_VERCEL.md` file.

## Changed scope

- Physics/contracts/input: explicit arcade free-flight profile, higher velocity setpoints, faster response, CCD, energetic recoverable contacts, cooldown snapshots and complete keyboard/Mode 2 mapping. Omitted profiles and research entry points retain research behavior.
- Player UI/camera: compact HUD, collapsed minimap, settings/controls, bounded velocity FOV, world-space air streaks, peripheral speed lines, impact frames and camera kick. Motion effects default off for reduced-motion preferences.
- Audio: original four-motor synthesis, wind and impact bus; click/key activation, mute, pause/blur/hidden suspension and cancellation of stale starts. API research starts do not depend on autoplay gestures.
- Art/assets: four-band toon worlds, batched architectural ink contours, faceted clouds, filtered generated surfaces, detailed procedural Freddy with stage lighting, and the original 133,300-byte Blender GLB.

Implementation files are `App.tsx`, `GameOverlay.tsx`, `game.css`, `Scene.tsx`, `flight-controls.ts`, `drone-audio.ts`, `BlenderDrone.tsx`, `OpenWorld.tsx`, `PizzeriaWorld.tsx`, `FreddyModel.tsx`, `WorldDetails.tsx`, `world-materials.ts`, contracts, sim-core, and `tools/build_neon_quad.py`. Tests and guidance accompany those changes. No dependency versions or provider credentials changed.

## Executed checks

- Parent `npm test`: **48/48 passed**, including the six-second zero-thrust settling regression. Existing research terminal collision semantics and shared stabilized camera/steering math remain covered.
- Parent `npm run typecheck`, `npm run lint`, and `git diff --check`: passed on the integrated candidate.
- Exclusive browser tester `npm run test:browser`: production build succeeded and **40/40 Playwright tests passed in 2.9 minutes**. Coverage includes complete directional input, opposing/released inputs, arcade speed, a real nonterminal Pizzeria ground collision, reduced-motion defaults, minimap expansion, and research API/profile isolation.
- Audio browser regression verified a gesture-created running context, oscillator frequency target of at least 65 Hz, and mute/pause fading the gain to zero and suspending the context. This includes the pending-resume cancellation regression discovered during integration.
- Final capture `outputs/anime-speed.png` shows measured 54 km/h, a stable Assisted horizon and peripheral streaks. `outputs/anime-impact.png` captures the Pizzeria ground-contact scenario; these artifacts are outside Git. Collision and impact state are asserted by the browser suite.
- Blender 5.1.2 background CLI: model generation, GLB export and 1440×1000 render succeeded. Re-import inspection found `rotor_0` through `rotor_3` and the intended approximately one-meter envelope. Parent inspected the render and the browser Chase model.
- CUA visual check at local port 5184: both maps, new HUD, complete control guide, stage lighting, Freddy visibility and GLB rendering inspected; no error-level console entries. One existing Three.Clock deprecation warning came from the renderer stack.
- Controlled physics measurement under an 18 m/s requested navigation command: research x-velocity 0.106 m/s and arcade 5.251 m/s after one simulated second; arcade 20.919 m/s after three seconds, decreasing to 9.497 m/s after one second of released-input braking. These are scenario-specific checks, not a real-aircraft accuracy claim.

## Independent review

Requested Sol High; effective routing unverified. The reviewer identified and rechecked research-profile leakage, endless ground rebound, terminal audio loss, and audio stop/start races. Parent and physics agent corrected them. A later browser audio check exposed an additional resume cancellation race; realtime snapshots during pending AudioContext.resume now leave the start generation intact. No open P1/P2 remained in the bounded static recheck before browser completion.

## Orchestration and limitations

Seven roles across execution/review waves: flight/input (Terra High), audio (Terra Medium), worlds (Terra Medium), Freddy (Terra Medium), Blender (Terra High), exclusive browser tester (Terra Medium), independent review (Sol High). Effective child model/effort is unverified; no runtime metadata proved the requested routes. No grandchildren. Parent owns integration and publication. See `codex-agent-setup.md` for file ownership and concurrency rules.

Physical gamepad hardware, cross-device frame rates, Safari/Firefox and speaker/device loudness are unverified. Chromium checks validate browser input, actual simulation state and the audio graph; they do not establish how external speakers sound. Touch-only flight controls remain unavailable. The optional AI provider relay remains unhosted. Runs/policies remain device-local and free-flight recordings last up to two minutes. Source and visual references: `ANIME_FPV_DIRECTION.md`, `FREDDY_VISUAL_REFERENCES.md`, and `BLENDER_ASSETS.md`.
