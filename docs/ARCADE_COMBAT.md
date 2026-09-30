# Arcade combat and manga pass

Implemented September 30, 2026. Explore (`flightFeel: "arcade"`) is now a bouncy, explosive action game. The Hover, Gates and Landing practice missions, the AI Lab, recorded research runs and behaviour-cloning training all keep the research quadrotor dynamics unchanged.

## Movement: not a drone simulator any more

`packages/sim-core` gives arcade free flight its own drive model, replacing the rotor model:

- **Hover ball.** A rotation-locked sphere collider (0.24 m) with full gravity compensation. It chases the commanded velocity with a hard acceleration cap (60 m/s² moving, 38 braking). There's no motor lag and no attitude control loop, so it reacts on the next tick.
- **Expressive orientation.** The airframe banks into horizontal acceleration like a kart. A damped spring tumble spins it on big hits and rights it again. Orientation is cosmetic and can never snag a wall.
- **Bouncy.** Every energetic contact reflects the pre-impact velocity about the contact normal: restitution 0.9 plus a 2.4 m/s pop, with a tumble kick. Normals come from the ground or the nearest face of the obstacle box. The map edge and the ceiling are springy force fields; they no longer end the run.
- **Kicks.** Actions may carry a one-shot `impulse` (m/s) with an integer `pulse` id, so a held command applies it exactly once. Dash, recoil, blast knockback and ram rebounds all arrive this way, so they are recorded with the action. The research profile ignores them.
- **Speeds.** 20 m/s cruise and 32 m/s boost outdoors (11/17 indoors). The sustained cap is 40 m/s; kicks may briefly reach 58.

## Controls follow the camera

Movement is camera-relative. W/S travel along the full aim ray, so looking up and pressing W climbs. A/D strafe along the camera's horizontal right, and Space/C are world up and down. The airframe's heading chases the camera heading at up to 9 rad/s. The camera holds still while the drone turns underneath it: its yaw change is handed back to the look offset every frame.

The Chase camera is now a third-person action camera that orbits with your aim. Mouse look (pointer lock or drag) works in FPV and Chase.

| Key | Explore (arcade) | Practice missions (research) |
|---|---|---|
| Mouse | Aim; the drone turns to follow | Look |
| W A S D / arrows | Move relative to the camera | Move relative to the view |
| Space / C | Rise / sink | Space climbs (C = camera) |
| Shift | Tap: dash (19 m/s kick, 0.6 s cooldown) · hold: boost | Descend |
| F or left click (captured) | Machine gun | Boost (F) |
| Q / E | Turn the camera | Yaw |
| V | Cycle camera | Cycle camera (C also works) |

Acro keeps body rates and manual throttle. In arcade free flight it runs on the same hover-ball body, with the attitude integrated kinematically.

## Machine gun, targets and explosions (`CombatLayer.tsx`)

- **Gun.** Hitscan from the camera's crosshair at 13 rounds/s, with slight spread. It raycasts world obstacle boxes, the ground and the pizzeria ceiling. Tracers travel from the muzzle at 420 m/s and there's a muzzle flash. Each shot adds heat; at full heat the gun overheats until it cools to 30 %. Recoil is a tiny backward kick.
- **Targets.** 18 "Hollow" bots plus 7 explosive barrels in the valley, and 7 bots plus 3 barrels in the pizzeria. The bots are original designs: TV heads with glowing eyes, a hazard halo, antennae and a jet. They bob, face you, flash on hit, pop back in after 8 s, and are drawn with the same ink pipeline as the world.
- **Explosions.** A pooled manga blast with:
  - a white flash, then inked toon fireballs that step yellow, orange, red and finally smoke
  - dark ink smoke puffs, a shockwave ring, tumbling debris, and a black ink impact star facing the camera
- **Reactions.**
  - **Chain reactions:** nearby targets detonate a beat later, and barrels are lethal.
  - **Knockback:** kicks the drone in proportion to distance.
  - **Ramming:** flying into a bot detonates it and bounces you off.
- **Camera.** Trauma-based shake (shake = trauma², after Vlambeer) and a brief punch-in zoom in the post pass. These replace the old full-screen impact frames, which were removed.
- **Scoring.** Combo hits with a ZZZ-style rank (D → C → B → A → S → SS) and a decay bar. Score scales with the combo, and multi-kills within 2.6 s trigger cut-ins.
- **Audio.** Synthesized in `drone-audio.ts`: gunshot crack and thump, hit tick, dash whoosh, bounce "boing" and explosion rumble. They share the existing mute, pause and gesture gating.

## Manga look

- Ink lines are thicker and darker, and they **boil**: the edge samples jitter on a held 8 fps clock, like redrawn animation frames.
- **Hatching** replaces the screentone dots. Single diagonal strokes go on faces turned from the key light, with cross-hatching where that shade is also dark. It is normal-based, so it never traces fog or light-shaft contours.
- **Paper grain**, slightly warmer in the whites.
- **Manga focus lines** replace the old speed lines. They are tapered black wedges that redraw ("boil") above 55 km/h, with a white burst on dash.
- **Onomatopoeia** pops from the world: ドカーン/BOOM, ズドン/KA-BLAM and ボカン/KRAK on kills, ボヨン/BOING on hard bounces, シュッ on dash. There are also yellow damage numbers, CRIT tags, and a hazard-striped OVERHEAT banner.

## References

- **[Zenless Zone Zero](https://en.wikipedia.org/wiki/Zenless_Zone_Zero)** (HoYoverse). Urban-neon, graphic-design-forward HUD. The source for the combo rank letters, yellow and black hazard accents, and slanted sticker panels ([Behance UI concept study](https://www.behance.net/gallery/188673799/zenless-zone-zero-ZZZ-UI-Concept-Design)).
- **[NTE: Neverness to Everness](https://www.unrealengine.com/developer-interviews/crafting-the-urban-open-world-of-nte-neverness-to-everness-with-ue5-across-pc-playstation-5-and-mobile)** (Hotta Studio). Animation that favours silhouette and "visual tension" over physical realism. That is the justification for the non-physical bank/tumble and exaggerated rebounds.
- **Manga effect language.** [Focus lines, speed lines and screentone](https://tips.clip-studio.com/en-us/articles/10098), and [onomatopoeia conventions](https://www.1stopasia.com/blog/sound-effects-and-visual-language-translating-the-untranslatable-in-manga/).
- **Game feel.** [Juice and screen-shake principles](https://www.gamedeveloper.com/design/squeezing-more-juice-out-of-your-game-design-).

All bots, barrels, effects and sounds are original and procedural. No third-party game assets are included.
