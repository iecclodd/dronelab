import { useEffect, useMemo, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { PhysicalState } from "../../../packages/contracts";
import { stylizedTime } from "./cel-material";
import { cameraShake } from "./combat-store";
import { visibility } from "./visibility";

/**
 * Per-world art direction for the screen-space ink + grade pass. Values are
 * linear-light multipliers applied before ACES tone mapping.
 */
export interface ToonLook {
  /** Multiplier on the underlying colour that forms the ink (coloured ink, not black). */
  ink: [number, number, number];
  inkStrength: number;
  /** Line fade range in metres; far lines dissolve into the atmosphere. */
  inkFade: [number, number];
  shadowTint: [number, number, number];
  lightTint: [number, number, number];
  saturation: number;
  halftone: number;
  glow: number;
  /** HDR level where glow starts; high outdoors so only emissive fixtures bloom. */
  glowThreshold: number;
  vignette: number;
  /** World-space key light position; faces turned away from it get screentone. */
  sun: [number, number, number];
}

export const LOOKS: Record<"valley" | "pizzeria" | "city" | "lab", ToonLook> = {
  valley: {
    ink: [0.16, 0.13, 0.24], inkStrength: 1, inkFade: [90, 320],
    shadowTint: [0.78, 0.8, 1.22], lightTint: [1.07, 1.01, 0.9],
    saturation: 1.12, halftone: 0.3, glow: 0.55, glowThreshold: 2.4, vignette: 0.22, sun: [-150, 72, 62],
  },
  pizzeria: {
    ink: [0.12, 0.09, 0.2], inkStrength: 1, inkFade: [22, 55],
    shadowTint: [0.86, 0.72, 1.3], lightTint: [1.1, 0.98, 0.84],
    saturation: 1.18, halftone: 0.34, glow: 0.85, glowThreshold: 0.9, vignette: 0.34, sun: [-12, 15, 8],
  },
  city: {
    ink: [0.1, 0.07, 0.12], inkStrength: 1, inkFade: [70, 240],
    shadowTint: [0.95, 0.72, 1.25], lightTint: [1.14, 0.95, 0.8],
    saturation: 1.16, halftone: 0.26, glow: 0.9, glowThreshold: 1.1, vignette: 0.38, sun: [140, -90, 70],
  },
  lab: {
    ink: [0.38, 0.4, 0.42], inkStrength: 0.6, inkFade: [30, 120],
    shadowTint: [0.9, 0.95, 1.08], lightTint: [1.03, 1.01, 0.97],
    saturation: 1.04, halftone: 0, glow: 0.3, glowThreshold: 1.8, vignette: 0.14, sun: [-15, 35, 18],
  },
};

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const fragmentShader = /* glsl */ `
#include <packing>
uniform sampler2D tColor;
uniform sampler2D tNormal;
uniform sampler2D tDepth;
uniform vec2 resolution;
uniform float cameraNear;
uniform float cameraFar;
uniform float thickness;
uniform vec3 inkMul;
uniform float inkStrength;
uniform vec2 inkFade;
uniform vec3 shadowTint;
uniform vec3 lightTint;
uniform float saturation;
uniform float halftone;
uniform float glow;
uniform float glowThreshold;
uniform float vignette;
uniform vec3 sunView;
uniform float speed;
uniform float punch;
uniform float time;
uniform float grain;
varying vec2 vUv;

float hash12(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float viewDepth(vec2 uv) {
  float z = texture2D(tDepth, uv).x;
  return -perspectiveDepthToViewZ(z, cameraNear, cameraFar);
}
vec3 viewNormal(vec2 uv) { return texture2D(tNormal, uv).xyz * 2.0 - 1.0; }

void main() {
  vec2 px = thickness / resolution;
  // Punch-in: a brief zoom toward the centre on kills (replaces flash frames).
  vec2 uv = 0.5 + (vUv - 0.5) * (1.0 - punch * 0.045);
  vec2 fromCenter = uv - 0.5;

  // Velocity streak: a short radial smear that only reaches the periphery.
  vec3 col = texture2D(tColor, uv).rgb;
  if (speed > 0.001) {
    float edge = smoothstep(0.12, 0.62, length(fromCenter));
    vec3 acc = col;
    for (int i = 1; i <= 5; i++) acc += texture2D(tColor, uv - fromCenter * float(i) * 0.011 * speed).rgb;
    col = mix(col, acc / 6.0, edge);
  }

  // Cheap bloom for emissive fixtures that exceed 1.0 in the HDR target.
  if (glow > 0.0) {
    vec3 halo = vec3(0.0);
    for (int ring = 0; ring < 3; ring++) {
      float radius = 3.0 + float(ring) * 5.0;
      float weight = 1.0 - float(ring) * 0.28;
      for (int i = 0; i < 10; i++) {
        float a = float(i) * 0.628318 + float(ring) * 0.31;
        halo += clamp(texture2D(tColor, uv + vec2(cos(a), sin(a)) * px * radius).rgb - glowThreshold, 0.0, 8.0) * weight;
      }
    }
    col += halo * glow * 0.035;
  }

  // Ink. Planar surfaces have screen-affine inverse depth, so the Laplacian
  // of 1/z is zero across them and spikes only at silhouettes/convex creases.
  // Line boil: the ink samples jitter on a held 8 fps clock, like redrawn
  // animation frames, so outlines read as hand-inked rather than computed.
  vec2 boil = (vec2(hash12(floor(gl_FragCoord.xy / 5.0) + floor(time * 8.0)), hash12(floor(gl_FragCoord.yx / 5.0) + floor(time * 8.0) + 3.1)) - 0.5) * px * 1.1;
  vec2 inkUv = uv + boil;
  float d0 = viewDepth(uv);
  bool sky = d0 > cameraFar * 0.98;
  float ink = 0.0;
  if (!sky) {
    float dl = viewDepth(inkUv - vec2(px.x, 0.0));
    float dr = viewDepth(inkUv + vec2(px.x, 0.0));
    float du = viewDepth(inkUv + vec2(0.0, px.y));
    float dd = viewDepth(inkUv - vec2(0.0, px.y));
    float i0 = 1.0 / d0;
    float lx = (i0 - 0.5 * (1.0 / dl + 1.0 / dr)) / i0;
    float ly = (i0 - 0.5 * (1.0 / du + 1.0 / dd)) / i0;
    float depthInk = smoothstep(0.018, 0.06, max(lx, ly));

    vec3 n0 = viewNormal(uv);
    vec3 nr = viewNormal(inkUv + vec2(px.x, 0.0));
    vec3 nd = viewNormal(inkUv - vec2(0.0, px.y));
    float bend = max(1.0 - dot(n0, nr), 1.0 - dot(n0, nd));
    float farSide = step(cameraFar * 0.98, max(dr, dd));
    float normalInk = smoothstep(0.28, 0.55, bend) * (1.0 - farSide);

    float fade = 1.0 - smoothstep(inkFade.x, inkFade.y, d0);
    ink = max(depthInk, normalInk * 0.85) * fade * inkStrength;

    // Manga hatching on faces turned from the key light: single diagonal
    // strokes in shade, cross-hatching where the shade is also dark.
    // Normal-based, so strokes sit evenly on a face instead of tracing
    // luminance contours through fog and light shafts.
    if (halftone > 0.0) {
      float away = smoothstep(0.05, -0.2, dot(n0, sunView)) * (1.0 - smoothstep(18.0, 60.0, d0));
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      vec2 f = gl_FragCoord.xy / thickness;
      float wob = sin(f.y * 0.045 + f.x * 0.013) * 1.4;
      float strokeA = 1.0 - smoothstep(0.1, 0.2, abs(fract((f.x + f.y + wob) / 5.5) - 0.5));
      float strokeB = 1.0 - smoothstep(0.1, 0.2, abs(fract((f.x - f.y - wob) / 5.5) - 0.5));
      float deep = 1.0 - smoothstep(0.02, 0.09, lum);
      float hatch = max(strokeA, strokeB * deep) * away;
      col *= 1.0 - hatch * halftone;
    }
  }

  // Split-tone grade: violet shadows, warm paper highlights.
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, col * shadowTint, 1.0 - smoothstep(0.02, 0.22, l));
  col = mix(col, col * lightTint, smoothstep(0.3, 0.9, l));
  col = mix(vec3(l), col, saturation);
  col = mix(col, col * inkMul, ink);

  gl_FragColor = vec4(clamp(col, 0.0, 64.0), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  float v = smoothstep(0.42, 0.95, length(fromCenter * vec2(1.25, 1.0)));
  gl_FragColor.rgb *= 1.0 - vignette * v;
  // Paper: static fibre grain, a touch warmer in the whites.
  float paper = hash12(floor(gl_FragCoord.xy)) * 0.6 + hash12(floor(gl_FragCoord.xy / 3.0)) * 0.4;
  gl_FragColor.rgb *= 1.0 - grain * (paper - 0.5);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * vec3(1.0, 0.975, 0.93), grain * 2.0 * smoothstep(0.7, 1.0, dot(gl_FragColor.rgb, vec3(0.333))));
}
`;

export type QualityPreference = "auto" | "high" | "balanced" | "performance";
/** 2 = MSAA + glow + ink, 1 = ink only, 0 = direct toon render (no post). */
export type QualityTier = 0 | 1 | 2;
const TIER_FOR: Record<Exclude<QualityPreference, "auto">, QualityTier> = { high: 2, balanced: 1, performance: 0 };
const QUALITY_KEY = "dronelab.visualQuality";

function readPreference(): QualityPreference {
  try {
    const query = new URLSearchParams(window.location.search).get("quality");
    const value = query ?? window.localStorage.getItem(QUALITY_KEY);
    if (value === "high" || value === "balanced" || value === "performance" || value === "auto") return value;
  } catch { /* storage unavailable */ }
  return "auto";
}

/** Software rasterisers (CI, VMs, no GPU) can't afford the post pass; detect them before the first frame. */
function softwareRenderer() {
  try {
    const context = document.createElement("canvas").getContext("webgl2");
    if (!context) return false;
    const info = context.getExtension("WEBGL_debug_renderer_info");
    const renderer = String(info ? context.getParameter(info.UNMASKED_RENDERER_WEBGL) : context.getParameter(context.RENDERER));
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return /swiftshader|llvmpipe|software|basic render/i.test(renderer);
  } catch {
    return false;
  }
}

let preference: QualityPreference = readPreference();
let activeTier: QualityTier = preference === "auto" ? (softwareRenderer() ? 0 : 2) : TIER_FOR[preference];
const qualityListeners = new Set<() => void>();
const emitQuality = () => qualityListeners.forEach((listener) => listener());

const frameStats = { calls: 0, triangles: 0, frameMs: 16.7, tier: 2 as QualityTier };

/** Visual quality preference + the tier actually rendering (Auto adapts to measured frame rate). */
export const visualQuality = {
  get: () => ({ preference, tier: activeTier }),
  setPreference(next: QualityPreference) {
    preference = next;
    try { window.localStorage.setItem(QUALITY_KEY, next); } catch { /* storage unavailable */ }
    activeTier = next === "auto" ? 2 : TIER_FOR[next];
    emitQuality();
  },
  subscribe(listener: () => void) { qualityListeners.add(listener); return () => { qualityListeners.delete(listener); }; },
};
let snapshot = visualQuality.get();
export const qualitySnapshot = () => {
  if (snapshot.preference !== preference || snapshot.tier !== activeTier) snapshot = { preference, tier: activeTier };
  return snapshot;
};

function shouldInk(object: THREE.Object3D) {
  if (object.userData.noInk) return false;
  if ((object as THREE.Line).isLine || (object as THREE.Points).isPoints || (object as THREE.Sprite).isSprite) return false;
  const mesh = object as THREE.Mesh;
  if (!mesh.isMesh) return true;
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  if (!material || material.transparent) return false;
  if ((material as THREE.MeshBasicMaterial).isMeshBasicMaterial && !object.userData.ink) return false;
  if ((material as THREE.ShaderMaterial).isShaderMaterial && !object.userData.ink) return false;
  return true;
}

/**
 * Takes over R3F's render loop (priority 1): colour pass into an MSAA HDR
 * target, a normal+depth pass for ink detection, and a fullscreen composite.
 * Purely presentational; physics state is only read for speed/impact.
 */
export function ToonPipeline({
  look,
  state,
  effectsEnabled,
  firstPerson,
  worldKey,
}: {
  /** Changes when the world's contents change, to precompile its shaders. */
  worldKey: string;
  look: ToonLook;
  state: MutableRefObject<PhysicalState | undefined>;
  effectsEnabled: boolean;
  firstPerson: boolean;
}) {
  const { gl, scene, camera, size } = useThree();

  const pipeline = useMemo(() => {
    const color = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: activeTier === 2 ? 4 : 0 });
    const depthTexture = new THREE.DepthTexture(1, 1);
    depthTexture.type = THREE.UnsignedIntType;
    const normal = new THREE.WebGLRenderTarget(1, 1, {
      depthTexture,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
    const normalMaterial = new THREE.MeshNormalMaterial();
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      toneMapped: true,
      uniforms: {
        tColor: { value: color.texture },
        tNormal: { value: normal.texture },
        tDepth: { value: depthTexture },
        resolution: { value: new THREE.Vector2(1, 1) },
        cameraNear: { value: 0.05 },
        cameraFar: { value: 650 },
        thickness: { value: 1 },
        inkMul: { value: new THREE.Vector3() },
        inkStrength: { value: 1 },
        inkFade: { value: new THREE.Vector2() },
        shadowTint: { value: new THREE.Vector3() },
        lightTint: { value: new THREE.Vector3() },
        saturation: { value: 1 },
        halftone: { value: 0 },
        glow: { value: 0 },
        glowThreshold: { value: 1 },
        vignette: { value: 0 },
        sunView: { value: new THREE.Vector3() },
        speed: { value: 0 },
        punch: { value: 0 },
        time: { value: 0 },
        grain: { value: 0.07 },
      },
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    quad.frustumCulled = false;
    const quadScene = new THREE.Scene();
    quadScene.add(quad);
    const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    return {
      color, normal, normalMaterial, material, quad, quadScene, quadCamera,
      hidden: [] as THREE.Object3D[],
      swapped: [] as [THREE.Mesh, THREE.Material][],
      clippedNormals: new WeakMap<THREE.Material, THREE.MeshNormalMaterial>(),
      clear: new THREE.Color(),
      sun: new THREE.Vector3(),
      buffer: new THREE.Vector2(),
      fx: { speed: 0 },
      governor: { frames: 0, elapsed: 0, fast: 0, samples: activeTier === 2 ? 4 : 0 },
    };
  }, []);

  // Compile every program for the new world up front (in parallel where the
  // driver supports it) so materials don't hitch the first time they scroll into view.
  useEffect(() => {
    const id = window.setTimeout(() => { void gl.compileAsync(scene, camera).catch(() => undefined); }, 60);
    return () => window.clearTimeout(id);
  }, [gl, scene, camera, worldKey]);

  useEffect(() => () => {
    pipeline.color.dispose();
    pipeline.normal.depthTexture?.dispose();
    pipeline.normal.dispose();
    pipeline.normalMaterial.dispose();
    pipeline.material.dispose();
    pipeline.quad.geometry.dispose();
  }, [pipeline]);

  useEffect(() => {
    const u = pipeline.material.uniforms;
    u.inkMul.value.set(...look.ink);
    u.inkStrength.value = look.inkStrength;
    u.inkFade.value.set(...look.inkFade);
    u.shadowTint.value.set(...look.shadowTint);
    u.lightTint.value.set(...look.lightTint);
    u.saturation.value = look.saturation;
    u.halftone.value = look.halftone;
    u.glow.value = look.glow;
    u.glowThreshold.value = look.glowThreshold;
    u.vignette.value = look.vignette;
  }, [look, pipeline]);

  useEffect(() => {
    gl.getDrawingBufferSize(pipeline.buffer);
    const { x, y } = pipeline.buffer;
    pipeline.color.setSize(x, y);
    pipeline.normal.setSize(x, y);
    pipeline.material.uniforms.resolution.value.set(x, y);
    pipeline.material.uniforms.thickness.value = Math.max(1.25, Math.min(3, y / 640));
  }, [gl, size, pipeline]);

  // Frame-total render stats (all passes), read-only, for profiling and tests.
  useEffect(() => {
    gl.info.autoReset = false;
    const hook = {
      stats: () => ({ ...frameStats, culling: { ...visibility.stats } }),
      /** Triangles per top-level group for one pass (visible to the main camera). */
      triangles: () => {
        const out: Record<string, number> = {};
        for (const child of scene.children) {
          let n = 0;
          child.traverseVisible((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh || !mesh.layers.test(camera.layers)) return;
            const g = mesh.geometry;
            const per = (g.index ? g.index.count : g.attributes.position?.count ?? 0) / 3;
            const instances = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : (g as THREE.InstancedBufferGeometry).isInstancedBufferGeometry ? (g as THREE.InstancedBufferGeometry).instanceCount : 1;
            n += per * instances;
          });
          if (n) out[child.name || child.type] = (out[child.name || child.type] ?? 0) + Math.round(n);
        }
        return out;
      },
      /** Visible drawable meshes per top-level scene group (draws per pass, before frustum culling). */
      breakdown: () => {
        const counts: Record<string, number> = {};
        for (const child of scene.children) {
          let n = 0;
          child.traverseVisible((o) => { if ((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints) n++; });
          if (n) counts[child.name || child.type] = (counts[child.name || child.type] ?? 0) + n;
        }
        return counts;
      },
    };
    (window as unknown as { dronelabRender?: typeof hook }).dronelabRender = hook;
    return () => { gl.info.autoReset = true; delete (window as unknown as { dronelabRender?: typeof hook }).dronelabRender; };
  }, [gl, scene]);

  useFrame((_, dt) => {
    frameStats.calls = gl.info.render.calls;
    frameStats.triangles = gl.info.render.triangles;
    frameStats.frameMs = frameStats.frameMs * 0.9 + dt * 1000 * 0.1;
    frameStats.tier = activeTier;
    gl.info.reset();
    const { color, normal, normalMaterial, material, quadScene, quadCamera, hidden, swapped, clippedNormals, fx, governor } = pipeline;
    const u = material.uniforms;
    stylizedTime.value += Math.min(dt, 0.1);
    const perspective = camera as THREE.PerspectiveCamera;
    u.cameraNear.value = perspective.near;
    u.cameraFar.value = perspective.far;
    pipeline.sun.set(...look.sun).normalize().transformDirection(camera.matrixWorldInverse);
    u.sunView.value.copy(pipeline.sun);

    const s = state.current;
    const targetSpeed = s && effectsEnabled && firstPerson ? THREE.MathUtils.clamp((Math.hypot(...s.velocity) - 12) / 24, 0, 1) : 0;
    fx.speed = THREE.MathUtils.lerp(fx.speed, targetSpeed, 1 - Math.exp(-dt * 5));
    u.speed.value = fx.speed;
    u.punch.value = effectsEnabled ? cameraShake.punch : 0;
    cameraShake.punch = Math.max(0, cameraShake.punch - dt * 7);
    u.time.value = stylizedTime.value;

    // Auto quality: step down when sustained frame rate drops below ~24 fps,
    // step back up only after several comfortably fast windows.
    if (preference === "auto" && dt < 0.5) {
      governor.frames++;
      governor.elapsed += dt;
      if (governor.elapsed > 0.9 || (governor.elapsed > 0.4 && governor.frames / governor.elapsed < 10)) {
        const measured = governor.frames / governor.elapsed;
        if (measured < 10 && activeTier > 0) { activeTier = 0; governor.fast = 0; emitQuality(); }
        else if (measured < 24 && activeTier > 0) { activeTier = (activeTier - 1) as QualityTier; governor.fast = 0; emitQuality(); }
        else if (measured > 57 && activeTier < 2 && ++governor.fast >= 4) { activeTier = (activeTier + 1) as QualityTier; governor.fast = 0; emitQuality(); }
        else if (measured <= 57) governor.fast = 0;
        governor.frames = 0; governor.elapsed = 0;
      }
    }
    if (activeTier === 0) {
      gl.setRenderTarget(null);
      gl.render(scene, camera);
      return;
    }
    const samples = activeTier === 2 ? 4 : 0;
    if (governor.samples !== samples) { color.dispose(); color.samples = samples; governor.samples = samples; }
    u.glow.value = activeTier === 2 ? look.glow : 0;

    gl.setRenderTarget(color);
    gl.render(scene, camera);

    const background = scene.background;
    const autoUpdate = gl.shadowMap.autoUpdate;
    gl.getClearColor(pipeline.clear);
    const clearAlpha = gl.getClearAlpha();
    hidden.length = 0;
    swapped.length = 0;
    scene.traverseVisible((object) => {
      if (object === scene) return;
      if (!shouldInk(object)) { hidden.push(object); return; }
      // Clipped materials (collapsed towers) need a normal material with the
      // same planes, or the ink would outline the uncut building.
      const mesh = object as THREE.Mesh;
      const material = mesh.isMesh && !Array.isArray(mesh.material) ? mesh.material : undefined;
      if (material?.clippingPlanes?.length) {
        let clipped = clippedNormals.get(material);
        if (!clipped) {
          clipped = new THREE.MeshNormalMaterial({ side: material.side });
          clipped.clippingPlanes = material.clippingPlanes;
          clipped.clipIntersection = material.clipIntersection;
          clippedNormals.set(material, clipped);
        }
        swapped.push([mesh, material]);
        mesh.material = clipped;
      } else if (mesh.isMesh) {
        swapped.push([mesh, mesh.material as THREE.Material]);
        mesh.material = normalMaterial;
      }
    });
    for (const object of hidden) object.visible = false;
    scene.background = null;
    gl.shadowMap.autoUpdate = false;
    gl.setClearColor(0x8080ff, 1);
    gl.setRenderTarget(normal);
    gl.clear();
    gl.render(scene, camera);
    gl.shadowMap.autoUpdate = autoUpdate;
    gl.setClearColor(pipeline.clear, clearAlpha);
    for (const [mesh, material] of swapped) mesh.material = material;
    scene.background = background;
    for (const object of hidden) object.visible = true;

    gl.setRenderTarget(null);
    gl.render(quadScene, quadCamera);
  }, 1);

  return null;
}
