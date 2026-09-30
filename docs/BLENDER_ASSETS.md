# Blender asset pipeline

`public/models/neon-quad.glb` is an original low-poly FPV quad made for DroneLab. It contains no external textures or assets. Its forward direction is +X in Blender, with a roughly 0.95 m motor-to-motor span. The glTF exporter converts Blender's Z-up scene to glTF's Y-up convention.

Build it with Blender 5.1 or later:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe' --background --python tools/build_neon_quad.py
```

The script saves the editable source outside the repository at `outputs/neon-quad.blend`, renders `outputs/neon-quad-render.png`, and writes the runtime model to `public/models/neon-quad.glb`. It names the animated rotor parents `rotor_0` through `rotor_3`; `BlenderDrone.tsx` rotates those groups from the simulation motor values.

The `.blend` uses EEVEE Next and creates optional Shader-to-RGB / three-band ramp nodes when that node is supported by the installed EEVEE build. The glTF retains portable PBR base-color materials; the browser loader applies a compact four-band toon gradient at runtime.

References: [Blender glTF 2.0 exporter manual](https://docs.blender.org/manual/en/latest/addons/import_export/scene_gltf2.html) and [three.js GLTFLoader](https://threejs.org/docs/#examples/en/loaders/GLTFLoader).
