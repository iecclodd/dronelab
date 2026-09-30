# Anime FPV art and input direction

Implemented September 29–30, 2026. This pass makes Explore a fast arcade FPV game while retaining the research simulator profile for Hover, Gates and Landing. The artwork, textures, audio synthesis and Blender quad are original implementations. Reference screenshots informed composition and style; no commercial game assets were copied.

## Visual references and decisions

- [Bomb Rush Cyberfunk screenshots](https://www.gematsu.com/2021/02/bomb-rush-cyberfunk-delayed-to-2022-official-trailer-and-screenshots): warm/cool blocks, readable silhouettes, selective dark contours. Applied to cream/coral/teal architecture, four discrete light bands and a single batched outline draw for the valley's main structures.
- [TRYP FPV screenshots](https://steamdb.info/app/1881200/screenshots/): close industrial structures and repeated ground landmarks make speed legible. Runway stripes, roadside posts, arches and container details now provide passing references.
- [Art of Rally visual reference](https://www.pcgames.de/Art-of-Rally-Spiel-73098/Tests/Review-Fazit-Wertung-Meinung-Rennspiel-Arcade-Einzelspieler-Rallye-1360243/): restrained HUD and a clear view of the route. The minimap collapses, frame-rate diagnostics live in Controls, and the flying header shrinks.
- [Freddy reference notes](FREDDY_VISUAL_REFERENCES.md): original procedural animatronic with segmented jaw, block teeth, blue eyes, seams, hat, bowtie, joints and microphone. A warm stage pool separates him from the cooler room.

![Cel-shaded city composition reference](https://www.gematsu.com/wp-content/uploads/2021/02/Bomb-Rush-Cyberfunk_2021_02-24-21_003.jpg)

The outdoor palette uses muted mint ground, blue-gray asphalt, coral rock and teal steel. Generated surface textures use mipmaps and moderate anisotropy to prevent distracting distant shimmer. The indoor map uses worn checker tiles, burgundy curtains and colored arcade light pools. Toon ramps contain non-color intensity data; purple fill lighting supplies the cool shadow color. [Three.js MeshToonMaterial](https://threejs.org/docs/pages/MeshToonMaterial.html) specifies nearest filtering for the ramp; surface textures use different filtering as described in the [texture manual](https://threejs.org/manual/pages/textures.html).

## Motion language

Actual simulated velocity drives a bounded FPV FOV increase of up to 16 degrees, peripheral illustrated streaks, sparse world-space air streaks, motor pitch and filtered wind. The HUD's speed is measured velocity, not a decorative counter. Real collision increments trigger a brief angular ink/cream impact frame, a warm edge flash, a small damped camera kick and a synthesized thump. Impact visuals have a 750 ms cooldown and a 280 ms lifetime; the strong impact frame is limited to the first 24% of that animation. Motion effects can be disabled in Flight setup and start disabled for reduced-motion preferences. These are visual effects; collision counts, physical time and recorded transitions are unchanged by them.

## Flight and inputs

A previous simulator navigation limit of 3 m/s was clamping larger requested inputs. The explicit arcade profile now permits outdoor Assisted setpoints of 18 m/s cruise and 30 m/s boost, with 10/16 m/s indoors. These are requested setpoints, not guarantees of instantaneous physical speed. Stronger stabilization and motor response make direction changes more reactive. Arcade free-flight collisions remain recorded but bounce instead of ending the run; out-of-bounds and timeout still end it. Continuous collision detection and a 36 m/s vector-speed cap bound the faster profile.

| Input | Assisted | Acro |
|---|---|---|
| W/S or up/down arrows | Forward/backward relative to view | Pitch forward/back |
| A/D or left/right arrows | Strafe left/right relative to view | Roll left/right |
| Space / either Shift | Climb/descend | Raise/lower throttle |
| Q/E | Yaw left/right | Yaw left/right |
| F | Boost | No extra action |
| Mouse drag / Mouse look | Look around | Look around |
| R / C / P / Esc | Retry / camera / pause / release and pause | Same |

Opposing keyboard inputs cancel, including Space with either or both Shift keys. Gamepad Mode 2 uses left X yaw, left Y throttle, right X roll and right Y pitch. Plug in, press a button or move a stick, and fly; center calibration is optional in Flight setup. Browser tests use simulated gamepad axes; physical transmitter and controller hardware compatibility is not established by those tests.

## GitHub research

- [MSubham06/Drone_Simulator](https://github.com/MSubham06/Drone_Simulator): inspected repository metadata and README. MIT metadata, browser Three.js/Gamepad API implementation, explicit Mode 2 table and throttle-reactive procedural audio. Useful architectural precedent for a self-contained web experience; no source was copied.
- [travisdetert/openkb-drone-godot](https://github.com/travisdetert/openkb-drone-godot): inspected README's complete keyboard/gamepad matrix, FPV camera and crash-effects structure. Godot is not a drop-in web renderer dependency. README says MIT but GitHub API license metadata was null; no code or assets imported.
- [Betaflight rc_controls.c](https://github.com/betaflight/betaflight/blob/master/src/main/fc/rc_controls.c): control-channel semantics reference used during the input audit. This game's Assisted velocity control is intentionally distinct from manual Acro body rates; neither is a hardware flight controller.
- [Three.js](https://github.com/mrdoob/three.js): existing runtime supplies toon materials and GLTFLoader. No extra postprocessing package is needed for this pass.

The custom drone was designed, exported and rendered with Blender 5.1.2's background CLI. See [the reproducible asset pipeline](BLENDER_ASSETS.md). Runtime GLB: 133,300 bytes, no external textures. Editable .blend and rendered PNG stay in the sibling outputs directory rather than repository history.

Audio uses four detuned oscillator voices, motor harmonics, filtered noise and bounded impact envelopes. It is gesture-gated and fades on pause, termination, blur and hidden tabs. It does not request microphone permissions or download sounds. Browser autoplay behavior follows [MDN Web Audio guidance](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices).

Arcade Assisted now shares a horizon-level yaw attitude between camera and steering so acceleration cannot hide the route under the nose. Acro keeps the full body-mounted view. Boost is F to avoid the browser's reserved Ctrl+W tab-close shortcut.
