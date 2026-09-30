# Rendering optimisation (Lumina District)

Measured September 30, 2026. The "Apple M4" rows were taken in Chromium in the desktop browser pane at 1024×768, DPR 2, High quality. The "SwiftShader" rows use headless Chromium's software renderer, a CPU rasteriser at 1280×720, as a stand-in for very weak GPUs. `window.dronelabRender.stats()` reports draw calls and triangles summed across every pass: shadow map, colour, and the ink normal pass.

| Scene | Metric | Before | After |
|---|---|---|---|
| City spawn canyon (M4) | draw calls / frame | 1,213 | 381 |
| City 75 m overview (M4) | draw calls / frame | 1,127 | 402 |
| City spawn (M4) | triangles / frame | 567k | 476k |
| City (M4) | frame rate | 60 (vsync) | 60 (vsync), now with headroom |
| City, High (SwiftShader) | fps | 3.0 | 4.3 |
| City, Performance (SwiftShader) | fps | 5.8 | 8.8 |

## What was done, and why

**Draw calls before triangles.** Each mesh costs CPU and driver overhead in every pass. Kenney's buildings are only 1–5k triangles each, so triangles weren't the problem ([three.js performance guidance](https://www.utsubo.com/blog/threejs-best-practices-100-tips)). The fixes:

- Water tanks: 100 meshes became 5 `InstancedMesh`es.
- Rubble: 72 chunks became 1 instanced draw with per-instance colour.
- Billboards: merged per material, 24 draws to 4.
- Street slabs: merged, 24 draws to 1.
- Cars: each Kenney car's 5–7 parts are baked into one geometry shared by every car of that model. Each burning car's fire is one merged, vertex-coloured mesh.

**Visibility culling** (`apps/web/src/visibility.ts`).

- *Frustum:* bounding-sphere tests. Skinned monsters can't use three's automatic culling because their geometry bounds don't follow the skeleton, so they were drawn even behind you.
- *Occlusion:* CPU software occluders. The towers are axis-aligned boxes. Each candidate casts rays from the camera to a few sample points on its bounds, and is hidden if every ray hits a tower. This is the coarse, conservative end of the occlusion-culling family: [hierarchical-Z](https://www.rastergrid.com/blog/2010/10/hierarchical-z-map-based-occlusion-culling/), rooms and portals, and software occluders ([overview](https://www.gamedeveloper.com/programming/occlusion-culling-algorithms), [Unreal's approach](https://dev.epicgames.com/documentation/en-us/unreal-engine/visibility-and-occlusion-culling-in-unreal-engine)). A Manhattan grid is its ideal case.
- *Details:* Towers are both occluders and cullables, and skip themselves in their own tests. Occluder boxes are shrunk slightly so rays that graze an edge count as visible. A 0.25 s show-hysteresis prevents popping.
- *Shadows:* culled objects move to a hidden render layer rather than `visible = false`. The main camera doesn't draw them, but the shadow camera still does, so hidden towers keep casting the shadows you can see.
- *Batched effects:* flames and smoke are culled per fire source. Visible fires are re-packed into the flame instance buffer every 120 ms, so fires behind towers cost no fill.

**Animation update-rate LOD.** Hidden monsters don't advance their animation mixer. Visible ones tick every frame within 40 m, every 2nd frame to 80 m, and every 3rd beyond, passing the accumulated time. This is the standard update-rate optimisation for distant characters ([Unreal URO / animation budget](https://www.coconutlizard.co.uk/blog/animation-budget-allocator/)).

**Shadow and light LOD.**

- The sun's shadow camera follows the view, covering ±90 m instead of ±130 m. It is snapped to whole shadow-map texels in light space so edges don't shimmer ([texel snapping](https://alextardif.com/shadowmapping.html)).
- Hidden targets, and targets beyond 90 m, stop casting shadows. Towers always cast.
- Fire point lights dropped from 6 static lights to 3 (1 on the Performance tier). They are re-assigned to the fires nearest the camera every 0.4 s.

**Performance-tier city trims.** 1024 shadow map, 1 fire light, about a third of the embers and ash, at most 5 smoke plumes, one flame tongue per fire, and no distant skyline.

## Not done (and why)

- **`THREE.LOD` for buildings.** Kenney's low-detail versions exist for the 8 low-rise models, but those buildings are few and already cheap. The skyscrapers (most towers) have no low-detail version. Culling removed far more work than LOD would.
- **`BatchedMesh` for intact towers.** It would collapse the remaining building draws further, but it doesn't combine well with per-tower occlusion. Collapsed towers would also need their clip-plane breaks baked into geometry first.
- **GPU occlusion queries / hierarchical-Z.** WebGL2 has occlusion queries, but three.js doesn't expose them, and the CPU box test is sufficient for this map.
