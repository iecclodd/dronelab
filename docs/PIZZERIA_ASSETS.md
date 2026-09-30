# Pizzeria fan-map assets

`Freddy’s Pizzeria` is an unofficial fan map. Its room geometry, props,
lighting, checker tiles, signs, and stage bear are original procedural React
Three Fiber geometry in this repository; no model, texture, audio, or mesh was
downloaded or copied from a game or a third-party fan project.

## Focused GitHub research

On 2026-09-29, the implementation reviewed these GitHub sources before deciding
whether an external stage-bear model was appropriate:

* [0rbianta/FNAFONE3D](https://github.com/0rbianta/FNAFONE3D) — the repository
  describes its project as CC BY but identifies several separately sourced
  Sketchfab character assets. That provenance is unsuitable for a compact,
  self-contained web scene without pulling and validating every upstream asset.
* [agentkaerf/FreeModels](https://github.com/agentkaerf/FreeModels) — a CC0
  collection, useful as a general source for generic props, but it does not
  provide a character that fits the requested recognizable stage bear.

The scene therefore uses the original primitive-based `FreddyModel.tsx` instead
of external assets. This keeps the map lightweight, inspectable, and avoids
ripping or reusing game/fan-project model files.
