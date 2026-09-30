# Cel-shading, map and motion research

Researched and implemented September 30, 2026. This pass is presentation only: no collider, physics profile, input mapping or recorded transition changed. Every new object is either sky/scenery outside the ±200 m valley square, flush on an existing collider face, drawn inside an existing collider box, or a non-solid effect (light, ribbon, particle, UI).

## What makes cel shading work

The references agree on a small set of rules. The look comes from *controlling* light, not from removing it.

| Principle | Where it comes from | How DroneLab applies it |
|---|---|---|
| **Few, hard light bands.** Two or three steps read instantly at speed; more starts to look like bad Gouraud shading. | [Breath of the Wild](https://nintendoeverything.com/zelda-breath-of-the-wild-art-director-on-how-the-wind-waker-hd-shaped-the-games-art-style/) uses two bands plus rim/spec ([toon shader breakdown](https://roystan.net/articles/toon-shader/)); [Guilty Gear Xrd GDC](https://www.ggxrd.com/Motomura_Junya_GuiltyGearXrd.pdf) uses a single step threshold. | `createCelGradientMap` now has 3 bands (shade / mid / lit) instead of 4. |
| **Shadows are a colour, not black.** Shade shifts hue (cool/violet) while highlights warm. | [Hi-Fi Rush GDC notes](https://www.foth.top/article/gdc-2024-hifirush-toonrendering-notes/) (colourful shadow volumes, per-area ambient); [torchinsky cel tricks](https://torchinsky.me/cel-shading/) (shadow tinting). | Violet hemisphere fill + a split-tone grade in the post pass (`shadowTint` / `lightTint` per world). |
| **Ink lines define form.** Silhouettes and creases, drawn in a *darker version of the local colour*, not pure black. | [Borderlands](https://news.ycombinator.com/item?id=19896529) (Sobel on depth); [Sable / Moebius](https://coleslow.dev/blog/moebius-shaders-1/) (depth + normal + colour buffers); [Maxime Heckel's Moebius post-process](https://blog.maximeheckel.com/posts/moebius-style-post-processing/). | `toon-pipeline.tsx`: a normal+depth pass and a fullscreen composite. Depth ink uses the Laplacian of **1/z**, which is exactly zero on planes, so big grazing floors don't produce false lines. Normal ink catches concave creases. Lines are coloured (`ink` multiplier), a constant pixel width, and fade with distance into the atmosphere. |
| **Rim light on the lit side only.** It pops silhouettes without flattening the shade side. | BotW rim ([breakdown](https://roystan.net/articles/toon-shader/)). | `cel-material.ts → addRimLight`: a hard fresnel band gated by N·L, applied to curved meshes (drone, trees, clouds, balloons). Flat boxes rely on ink instead, because fresnel on a flat face lights the whole face at once. |
| **Screentone in shade.** Comic halftone gives the shaded side texture and reads as "drawn". | [Hi-Fi Rush comic shader](https://www.foth.top/article/gdc-2024-hifirush-toonrendering-notes/) (dots in light, hatching in shadow); Sable crosshatch thresholds. | Normal-based screentone on faces turned away from the key light, near range only. (A luminance-threshold version was tried first; it traced contours through fog and light cones, so it was replaced.) |
| **Conserve visual noise.** Flat colour blocks and restrained texture; detail goes where the player looks. | [Tunic](https://www.gamedeveloper.com/design/designing-content-for-no-one-an-interview-with-the-team-behind-tunic) ("conservation of visual noise"); [Wind Waker](https://sourcegaming.info/2017/08/10/holism-the-wind-wakers-cel-shaded-graphics/) holism. | Ground uses three quantised meadow tones (world-space noise) rather than a busy texture. Surface textures (strata, corrugation, hazard, solar) are large, simple and stepped. |
| **Atmospheric perspective in layers.** Distant ranges step toward the sky colour instead of fading smoothly. | Ghibli/Genshin-style skies ([Genshin sky pipeline notes](https://parsers.vc/news/250124-the-art-of-game-rendering--a-deep-dive-into/)); Wind Waker's graphic horizon. | `ValleySky.tsx`: a gradient sky dome with a hard-edged anime sun and stepped halo rings, three ridge rings that lighten with distance, snow-capped hero peaks, and toon clouds with violet undersides. |
| **Motion lives in the shader.** Animate UV/time on static geometry, not the geometry. | [Wind Waker graphics analysis: wind](https://medium.com/@gordonnl/wind-f4fc7a3b366a) ("thick lines" ribbons). | `WorldFx.tsx → buildRibbon`: camera-facing ribbons whose chevrons and gust heads are animated in the fragment shader. One draw call for all gusts, one for the route. |

## Map design references

| Principle | Source | Applied |
|---|---|---|
| **Weenies / landmarks** orient the player across an open map. | [Level design: 35 ways to guide the player](https://jacobryanwheeler.medium.com/game-level-design-35-ways-to-guide-the-player-4bbc324204f4) (Disney "weenie"); [Level Design Book: composition](https://book.leveldesignbook.com/process/blockout/massing/composition). | Every landmark gets a light column. The chosen "next spot" pulses, with a spinning diamond icon and ground ripples. Visited spots dim to mint. |
| **Leading lines / breadcrumbs** pull the eye along a route. | Same sources; [Follow the breadcrumbs](https://medium.com/my-games-company/follow-the-breadcrumbs-the-basic-techniques-of-level-design-754820499a1b). | **The Skyline**: a flowing chevron line from the airfield through Gates A–C, down Sundial canyon, under the arch and viaduct, and between the lookout legs. Each point was checked against the collider list. The pizzeria has an equivalent indoor loop. The runway has a sequenced "rabbit" light lead-in. |
| **Read the track at speed:** landmark to landmark, varied rhythm, clear sightlines. | [Racing level design: the rally case (WRC7)](https://www.gamedeveloper.com/design/racing-level-design-the-rally-case). | Gate frames get glowing inner lips and letter plates (FPV race-gate language, cf. [VelociDrone](https://www.velocidrone.com/features) / [Liftoff](https://www.liftoff-game.com/liftoff-fpv-drone-racing) gate markers). Runway piano keys, numbers and edge lines give passing references. |
| **Long-range landmarks for direction.** | WRC7 ("mountains to the east tell the player where they're going"). | Four hero peaks, wind turbines to the west, balloons drifting outside the boundary. |

## Motion graphics and HUD ("juice")

Sources: [Juice it or lose it / Art of Screenshake summary](https://www.gamedeveloper.com/design/squeezing-more-juice-out-of-your-game-design-), [game feel on the web](https://valdemird.com/blog/game-feel-on-the-web/).

- **Compass tape** with landmark pips (the active one pulses), so direction to the next spot reads without opening the map.
- **Waypoint pin** projected from the 3D beacon. It clamps to the screen edge with a direction arrow when off-screen, and shows live distance.
- **Discovery toast** on reaching a landmark, a **LIFT OFF** stamp on launch, and an ink-bar **title wipe** when switching worlds.
- **Segmented speed gauge.** Segments past cruise speed light coral, and the reticle opens with speed.
- Sticker-style offset shadows, eased press/hover states, panel entrances, and a minimum 9 px text size (previously 6–7 px in places).
- Post-process speed smear on the periphery, a chromatic split on real collision increments, and an emissive glow.
- All motion respects the existing Motion effects setting and `prefers-reduced-motion`.

## Performance and quality tiers

Flight setup has a new **Visual quality** option: Auto / High / Balanced / Performance.

- **High:** ink, 4× MSAA HDR target, glow, screentone.
- **Balanced:** ink without MSAA or glow.
- **Performance:** direct toon render with no post pass, no meadow, clouds, balloons or turbines, and a 1024 shadow map.

Auto starts at High (Performance on detected software rasterisers such as SwiftShader or llvmpipe) and steps down when measured frame rate stays below about 24 fps.

Measured on an Apple M4 in Chromium: a locked 60 fps at High, with a 19 ms worst frame over 3 s. On headless SwiftShader, Auto runs the Performance tier. The browser suite result matches the pre-change baseline (38 pass; the same two pointer-lock tests fail in headless Chromium before and after).

## Files

`toon-pipeline.tsx` (post pass, looks, quality tiers) · `cel-material.ts` (rim, meadow, grass sway, shared shader clock) · `ValleySky.tsx` · `ValleyDressing.tsx` · `PizzeriaDressing.tsx` · `WorldFx.tsx` (ribbons, beacons, screen projection) · `nav-store.ts` (next-spot state shared by HUD and scene) · `world-materials.ts` (new procedural textures). Posters, textures and models are original and procedural. No external runtime assets were added.
