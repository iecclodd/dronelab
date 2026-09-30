import * as THREE from "three";

/** Shared clock for every stylised shader so ribbons, grass and beacons stay in phase. */
export const stylizedTime = { value: 0 };

/**
 * Breath of the Wild–style rim: a hard fresnel band, limited to surfaces that
 * face the key light so silhouettes pop on the sunlit side only. Intended for
 * curved meshes; flat boxes rely on the screen-space ink instead.
 */
export function addRimLight(shader: THREE.WebGLProgramParametersWithUniforms, strength = 0.42) {
  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <opaque_fragment>",
    /* glsl */ `
    #if NUM_DIR_LIGHTS > 0
      float rimFacing = saturate(dot(normal, directionalLights[0].direction));
      float rimFresnel = 1.0 - saturate(dot(normal, normalize(vViewPosition)));
      float rimBand = smoothstep(0.64, 0.68, rimFresnel * (0.5 + 0.5 * rimFacing));
      outgoingLight += diffuseColor.rgb * directionalLights[0].color * rimBand * ${strength.toFixed(3)};
    #endif
    #include <opaque_fragment>`,
  );
}

export const rimLight: THREE.Material["onBeforeCompile"] = (shader) => addRimLight(shader);

/** Clones every material under `root` into a rim-lit toon variant. */
export function applyRimToToon(material: THREE.MeshToonMaterial) {
  material.onBeforeCompile = rimLight;
  material.customProgramCacheKey = () => "cel-rim";
}

/**
 * Meadow patches: world-space value noise quantised into three discrete
 * greens, like painted colour blocks in Wind Waker / Tunic fields.
 */
export const meadowPatches: THREE.Material["onBeforeCompile"] = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vMeadowWorld;")
    .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvMeadowWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      /* glsl */ `#include <common>
      varying vec3 vMeadowWorld;
      float meadowHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float meadowNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(meadowHash(i), meadowHash(i + vec2(1, 0)), f.x), mix(meadowHash(i + vec2(0, 1)), meadowHash(i + vec2(1, 1)), f.x), f.y);
      }`,
    )
    .replace(
      "#include <map_fragment>",
      /* glsl */ `#include <map_fragment>
      vec2 mp = vMeadowWorld.xz;
      float field = meadowNoise(mp * 0.018) * 0.65 + meadowNoise(mp * 0.061 + 7.3) * 0.35;
      float band = field < 0.4 ? 0.0 : field < 0.6 ? 1.0 : 2.0;
      vec3 meadow = band < 0.5 ? vec3(0.86, 0.93, 0.83) : band < 1.5 ? vec3(1.0) : vec3(1.1, 1.06, 0.86);
      diffuseColor.rgb *= meadow;`,
    );
};

/**
 * Instanced grass sway. Tips bend with a travelling gust wave, so wind reads
 * as one coherent motion across the field rather than per-blade jitter.
 */
export const grassSway: THREE.Material["onBeforeCompile"] = (shader) => {
  shader.uniforms.uTime = stylizedTime;
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nuniform float uTime;")
    .replace(
      "#include <begin_vertex>",
      /* glsl */ `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 root = instanceMatrix[3].xyz;
        float gust = sin(uTime * 1.7 - root.x * 0.09 + root.z * 0.05) * 0.5 + 0.5;
        float flutter = sin(uTime * 5.3 + root.x * 1.3 + root.z * 0.7) * 0.25;
        float tip = clamp(position.y / 0.7, 0.0, 1.0);
        transformed.x += (gust * 0.22 + flutter * 0.06) * tip * tip;
        transformed.z += flutter * 0.05 * tip;
      #endif`,
    );
};
