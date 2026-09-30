import { useEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Scenario } from "../../../packages/contracts";
import { CITY_AVENUES, CITY_BOUNDS, CITY_MODEL_BOUNDS, CITY_PLACEMENTS, CITY_RUBBLE, CITY_STREETS, CITY_WORLD, placementBox, type CityPlacement } from "../../../packages/contracts/city-world";
import { rimLight, stylizedTime } from "./cel-material";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { HIDDEN_LAYER, isSphereVisible, visibility, type Cullable } from "./visibility";
import { qualitySnapshot, visualQuality } from "./toon-pipeline";
import { useSyncExternalStore } from "react";
import { createCelGradientMap } from "./world-materials";

/**
 * Lumina District — a burning, collapsing Manhattan-style grid inside a
 * Hollow. Buildings are Kenney City Kit models (CC0) on the shared collider
 * layout from contracts/city-world.ts; everything else here is scenery or
 * non-solid effects (fire, smoke, ash, sky). Three.js coords: (x, up, -north).
 */

const BASE = import.meta.env.BASE_URL;
export const CITY_MODEL_URL = (name: string) => `${BASE}models/city/${name}.glb`;
const FOG = "#3a1a26";

/** Convert a Kenney scene clone to toon materials (shared map), optionally clipped. */
function toonClone(source: THREE.Object3D, gradient: THREE.Texture, clip?: { planes: THREE.Plane[] }) {
  const clone = source.clone(true);
  clone.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const original = mesh.material as THREE.MeshStandardMaterial;
    const toon = new THREE.MeshToonMaterial({ map: original.map, color: original.color?.clone().multiplyScalar(0.9), gradientMap: gradient });
    if (clip) {
      toon.clippingPlanes = clip.planes;
      toon.clipIntersection = true;
      toon.side = THREE.DoubleSide;
      toon.emissive = new THREE.Color("#2a0806");
    }
    mesh.material = toon;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
  return clone;
}

/** Two tilted planes (intersection) leave a jagged V-notched break line. */
function breakPlanes(p: CityPlacement) {
  const { height } = placementBox(p);
  const cut = Math.max(2, height - 2);
  const centre = new THREE.Vector3(p.x, cut, -p.y);
  const tilt = (a: number, b: number) => {
    const normal = new THREE.Vector3(a, -1, b).normalize();
    return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, centre);
  };
  const s = (p.x * 13 + p.y * 7) % 2 ? 1 : -1;
  return [tilt(0.42 * s, 0.18), tilt(-0.36 * s, -0.24)];
}

function Buildings({ gradient }: { gradient: THREE.Texture }) {
  const models = useGLTF(Object.keys(CITY_MODEL_BOUNDS).map(CITY_MODEL_URL));
  const byName = useMemo(() => new Map(Object.keys(CITY_MODEL_BOUNDS).map((name, i) => [name, models[i]!.scene])), [models]);
  const groups = useMemo(() => CITY_PLACEMENTS.map((p) => {
    const source = byName.get(p.model)!;
    const object = toonClone(source, gradient, p.keep < 1 ? { planes: breakPlanes(p) } : undefined);
    object.position.set(p.x, 0, -p.y);
    object.rotation.y = (p.rot * Math.PI) / 2;
    object.scale.setScalar(p.scale);
    return object;
  }), [byName, gradient]);
  useEffect(() => () => groups.forEach((g) => g.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh) (m.material as THREE.Material).dispose(); })), [groups]);
  // Towers are both occluders and cullables (occluded by *other* towers).
  useEffect(() => {
    const boxes = CITY_PLACEMENTS.map((p) => {
      const b = placementBox(p);
      return new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(b.position[0], b.position[2], -b.position[1]), new THREE.Vector3(b.size[0], b.size[2], b.size[1]));
    });
    visibility.setOccluders(boxes);
    const entries: Cullable[] = groups.map((g, i) => {
      const box = boxes[i]!;
      const size = box.getSize(new THREE.Vector3());
      const centre = box.getCenter(new THREE.Vector3());
      const half = size.clone().multiplyScalar(0.5);
      // Sample the box's corners, mid-edges and centre so partly visible towers stay drawn.
      const samples: THREE.Vector3[] = [new THREE.Vector3()];
      for (const y of [-0.95, 0, 0.95]) for (const x of [-1, 1]) for (const z of [-1, 1]) samples.push(new THREE.Vector3(x * half.x * 1.02, y * half.y, z * half.z * 1.02));
      for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) samples.push(new THREE.Vector3(x * half.x * 1.02, half.y * 0.95, z * half.z * 1.02));
      return visibility.register({ object: g, center: centre, radius: half.length(), samples, selfOccluder: i });
    });
    return () => { entries.forEach((e) => visibility.unregister(e)); visibility.clearOccluders(); };
  }, [groups]);
  return <group name="city-buildings">{groups.map((g, i) => <primitive key={CITY_PLACEMENTS[i]!.id} object={g} />)}</group>;
}

/** NYC rooftop water tanks (solid; matches tank colliders), instanced: 5 draws for all tanks. */
function WaterTanks({ gradient }: { gradient: THREE.Texture }) {
  const tanks = useMemo(() => CITY_PLACEMENTS.filter((p) => p.tank).map((p) => ({ p, h: placementBox(p).height })), []);
  const parts = useMemo(() => {
    const m = new THREE.Matrix4();
    const at = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => m.clone().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));
    const legs: THREE.Matrix4[] = [], decks: THREE.Matrix4[] = [], bodies: THREE.Matrix4[] = [], hoops: THREE.Matrix4[] = [], roofs: THREE.Matrix4[] = [];
    for (const { p, h } of tanks) {
      const x = p.x, z = -p.y;
      for (const [dx, dz] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]] as const) legs.push(at(x + dx, h + 1.1, z + dz));
      decks.push(at(x, h + 2.35, z));
      bodies.push(at(x, h + 4.4, z));
      for (const y of [3.2, 4.4, 5.6]) hoops.push(at(x, h + y, z));
      roofs.push(at(x, h + 6.8, z));
    }
    return [
      { key: "legs", list: legs, geometry: new THREE.BoxGeometry(0.25, 2.2, 0.25), color: "#2c2328", rim: false },
      { key: "decks", list: decks, geometry: new THREE.BoxGeometry(4.2, 0.2, 4.2), color: "#3a2e2c", rim: false },
      { key: "bodies", list: bodies, geometry: new THREE.CylinderGeometry(2.1, 2.1, 3.9, 14), color: "#8a5a3a", rim: true },
      { key: "hoops", list: hoops, geometry: new THREE.CylinderGeometry(2.16, 2.16, 0.12, 14), color: "#2c2328", rim: false },
      { key: "roofs", list: roofs, geometry: new THREE.ConeGeometry(2.3, 1.2, 14), color: "#4a3a36", rim: false },
    ];
  }, [tanks]);
  useEffect(() => () => parts.forEach((part) => part.geometry.dispose()), [parts]);
  return (
    <group name="water-tanks">
      {parts.map((part) => (
        <instancedMesh key={part.key} args={[part.geometry, undefined, part.list.length]} castShadow ref={(mesh) => { if (!mesh) return; part.list.forEach((mat, i) => mesh.setMatrixAt(i, mat)); mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); }}>
          <meshToonMaterial color={part.color} gradientMap={gradient} {...(part.rim ? { onBeforeCompile: rimLight, customProgramCacheKey: () => "cel-rim" } : {})} />
        </instancedMesh>
      ))}
    </group>
  );
}

const billboardFragment = /* glsl */ `
uniform sampler2D map;
uniform float uTime;
uniform float uSeed;
varying vec2 vUv;
void main() {
  vec2 uv = vUv;
  float band = floor(uv.y * 18.0);
  float glitch = step(0.93, fract(sin(band * 12.9 + floor(uTime * 9.0 + uSeed) * 78.2) * 43758.5));
  uv.x += glitch * (fract(sin(band + uTime) * 91.3) - 0.5) * 0.25;
  vec3 col = texture2D(map, uv).rgb;
  float scan = 0.82 + 0.18 * step(0.5, fract(vUv.y * 90.0));
  float flicker = 0.85 + 0.15 * step(0.2, fract(sin(floor(uTime * 12.0) + uSeed) * 437.5));
  float dead = step(0.8, fract(sin(uSeed * 3.1) * 91.7)) * step(0.5, fract(uTime * 0.7 + uSeed));
  col = mix(col, vec3(0.03, 0.02, 0.05), dead * 0.85);
  gl_FragColor = vec4(col * 2.4 * scan * flicker, 1.0);
  #include <colorspace_fragment>
}`;

function billboardTexture(kind: number) {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 320;
  const g = c.getContext("2d")!;
  const sets = [
    ["#ff2a6d", "#12031a", "EVACUATE", "HOLLOW ALERT · ZONE 6"],
    ["#05d9e8", "#051024", "LUMINA", "NEWS 24 · LIVE"],
    ["#ffd23f", "#1a0f03", "!! DANGER !!", "ETHEREAL ACTIVITY"],
    ["#c04bff", "#0f0520", "NEON RUSH", "ENERGY DRINK"],
  ][kind % 4]!;
  const [ink, bg, big, small] = sets;
  g.fillStyle = bg; g.fillRect(0, 0, 512, 320);
  g.strokeStyle = ink; g.lineWidth = 10; g.strokeRect(12, 12, 488, 296);
  for (let i = 0; i < 9; i++) { g.fillStyle = `${ink}22`; g.fillRect(0, i * 38, 512, 14); }
  g.fillStyle = ink; g.font = "900 italic 78px Arial"; g.textAlign = "center";
  g.fillText(big, 256, 175);
  g.font = "700 30px monospace"; g.fillText(small, 256, 245);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function Billboards() {
  const textures = useMemo(() => [0, 1, 2, 3].map(billboardTexture), []);
  const materials = useMemo(() => textures.map((map, i) => new THREE.ShaderMaterial({
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: billboardFragment,
    uniforms: { map: { value: map }, uTime: stylizedTime, uSeed: { value: i * 1.7 } },
  })), [textures]);
  useEffect(() => () => { textures.forEach((t) => t.dispose()); materials.forEach((m) => m.dispose()); }, [textures, materials]);
  const boards = useMemo(() => CITY_PLACEMENTS.filter((p) => p.billboards).flatMap((p, i) => {
    const box = placementBox(p);
    const [sx, sy] = box.size;
    const faces: { pos: [number, number, number]; rotY: number; w: number }[] = [
      { pos: [box.position[0], 0, -(box.position[1] - sy / 2 - 0.15)], rotY: 0, w: sx * 0.8 },
      { pos: [box.position[0], 0, -(box.position[1] + sy / 2 + 0.15)], rotY: Math.PI, w: sx * 0.8 },
      { pos: [box.position[0] + (p.x > 0 ? -1 : 1) * (sx / 2 + 0.15), 0, -box.position[1]], rotY: p.x > 0 ? -Math.PI / 2 : Math.PI / 2, w: sy * 0.8 },
    ];
    return faces.flatMap((f, k) => [0.35, 0.62].map((level, n) => ({ key: `${i}-${k}-${n}`, ...f, y: box.height * level, mat: materials[(i + k + n) % 4]! })));
  }), [materials]);
  // One merged mesh per billboard material: ~24 draws become 4.
  const merged = useMemo(() => materials.map((mat) => {
    const parts = boards.filter((b) => b.mat === mat).map((b) => {
      const g = new THREE.PlaneGeometry(b.w, b.w * 0.62);
      g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(b.pos[0], b.y, b.pos[2]), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, b.rotY, 0)), new THREE.Vector3(1, 1, 1)));
      return g;
    });
    const geometry = parts.length ? mergeGeometries(parts)! : new THREE.BufferGeometry();
    parts.forEach((g) => g.dispose());
    return { mat, geometry };
  }), [boards, materials]);
  useEffect(() => () => merged.forEach((m) => m.geometry.dispose()), [merged]);
  return (
    <group name="billboards">
      {merged.map((m, i) => <mesh key={i} geometry={m.geometry} material={m.mat} userData={{ noInk: true }} />)}
    </group>
  );
}

function Streets({ gradient }: { gradient: THREE.Texture }) {
  const dashes = useRef<THREE.InstancedMesh>(null);
  const cracks = useRef<THREE.InstancedMesh>(null);
  const slabs = useMemo(() => {
    const list: [number, number][] = [];
    for (const x of [-66, -22, 22, 66]) for (const y of [-80, -48, -16, 16, 48, 80]) list.push([x, y]);
    return list;
  }, []);
  const slabGeometry = useMemo(() => {
    const parts = slabs.map(([x, y]) => new THREE.PlaneGeometry(30, 22).rotateX(-Math.PI / 2).translate(x, 0, -y));
    const merged = mergeGeometries(parts)!;
    parts.forEach((g) => g.dispose());
    return merged;
  }, [slabs]);
  useEffect(() => () => slabGeometry.dispose(), [slabGeometry]);
  useEffect(() => {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    let n = 0;
    const flat = new THREE.Euler(-Math.PI / 2, 0, 0);
    for (const x of CITY_AVENUES) for (let y = -106; y <= 106; y += 9) {
      if (CITY_STREETS.some((sy) => Math.abs(sy - y) < 8)) continue;
      m.compose(p.set(x, 0.03, -y), q.setFromEuler(flat), s.set(0.3, 3.6, 1)); dashes.current?.setMatrixAt(n++, m);
    }
    for (const y of CITY_STREETS) for (let x = -106; x <= 106; x += 9) {
      if (CITY_AVENUES.some((ax) => Math.abs(ax - x) < 10)) continue;
      m.compose(p.set(x, 0.03, -y), q.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, Math.PI / 2)), s.set(0.3, 3.6, 1)); dashes.current?.setMatrixAt(n++, m);
    }
    // Crosswalk zebra bars at every intersection.
    for (const x of CITY_AVENUES) for (const y of CITY_STREETS) for (let k = -3; k <= 3; k++) {
      for (const side of [-1, 1]) {
        m.compose(p.set(x + k * 2, 0.035, -(y + side * 7.5)), q.setFromEuler(flat), s.set(1.1, 3, 1)); dashes.current?.setMatrixAt(n++, m);
      }
    }
    if (dashes.current) { dashes.current.count = n; dashes.current.instanceMatrix.needsUpdate = true; }
    let c = 0;
    for (let i = 0; i < 90; i++) {
      const r = (k: number) => { const v = Math.sin(i * 91.3 + k * 17.7) * 43758.5; return v - Math.floor(v); };
      const onAvenue = r(1) < 0.5;
      const x = onAvenue ? CITY_AVENUES[Math.floor(r(2) * 5)]! + (r(3) - 0.5) * 12 : (r(3) - 0.5) * 210;
      const y = onAvenue ? (r(4) - 0.5) * 210 : CITY_STREETS[Math.floor(r(2) * 7)]! + (r(4) - 0.5) * 9;
      m.compose(p.set(x, 0.04, -y), q.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, r(5) * Math.PI)), s.set(0.25 + r(6) * 0.3, 3 + r(7) * 7, 1));
      cracks.current?.setMatrixAt(c++, m);
    }
    if (cracks.current) { cracks.current.count = c; cracks.current.instanceMatrix.needsUpdate = true; }
  }, []);
  return (
    <group name="streets">
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[CITY_BOUNDS * 2 + 220, CITY_BOUNDS * 2 + 220]} />
        <meshToonMaterial color="#39323c" gradientMap={gradient} />
      </mesh>
      <mesh geometry={slabGeometry} position={[0, 0.015, 0]} receiveShadow>
        <meshToonMaterial color="#5a5058" gradientMap={gradient} />
      </mesh>
      <instancedMesh ref={dashes} args={[undefined, undefined, 900]} userData={{ noInk: true }} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color="#c9b98a" />
      </instancedMesh>
      <instancedMesh ref={cracks} args={[undefined, undefined, 90]} userData={{ noInk: true }} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color="#120c10" />
      </instancedMesh>
    </group>
  );
}

/** Rubble chunks, one instanced draw with per-chunk colour. */
function Rubble({ gradient }: { gradient: THREE.Texture }) {
  const chunks = useMemo(() => CITY_RUBBLE.flatMap((r, i) => Array.from({ length: 9 }, (_, k) => {
    const v = (n: number) => { const x = Math.sin((i + 1) * 12.9 + k * 7.3 + n * 3.1) * 43758.5; return x - Math.floor(x); };
    const scale = Math.min(r.size[0], r.size[1]) * (0.22 + v(1) * 0.2);
    return {
      position: new THREE.Vector3(r.position[0] + (v(2) - 0.5) * r.size[0] * 0.7, scale * 0.6 + (k > 5 ? r.size[2] * 0.45 : 0), -(r.position[1] + (v(3) - 0.5) * r.size[1] * 0.7)),
      rotation: new THREE.Euler(v(4) * 3, v(5) * 3, v(6) * 3),
      scale,
      color: new THREE.Color(["#6a5e62", "#524850", "#7a6a60", "#8a4a3a"][k % 4]!),
    };
  })), []);
  const geometry = useMemo(() => new THREE.DodecahedronGeometry(1, 0), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <instancedMesh name="rubble" args={[geometry, undefined, chunks.length]} castShadow receiveShadow ref={(mesh) => {
      if (!mesh) return;
      const m = new THREE.Matrix4();
      chunks.forEach((c, i) => { mesh.setMatrixAt(i, m.compose(c.position, new THREE.Quaternion().setFromEuler(c.rotation), new THREE.Vector3().setScalar(c.scale))); mesh.setColorAt(i, c.color); });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }}>
      <meshToonMaterial gradientMap={gradient} />
    </instancedMesh>
  );
}

/** Fire sources (Three coords) and their size — tower breaks, rubble, streets, windows. */
export const CITY_FIRES: { position: [number, number, number]; size: number; plume: boolean }[] = (() => {
  const out: { position: [number, number, number]; size: number; plume: boolean }[] = [];
  CITY_PLACEMENTS.forEach((p, i) => {
    const box = placementBox(p);
    if (p.keep < 1) {
      for (let k = 0; k < 3; k++) out.push({ position: [box.position[0] + (k - 1) * box.size[0] * 0.25, box.height - 0.5, -box.position[1] + ((k % 2) - 0.5) * box.size[1] * 0.3], size: 4.5 + (k % 2) * 2, plume: k === 1 });
    } else if (i % 3 === 0) {
      out.push({ position: [box.position[0] + box.size[0] * 0.3, box.height * 0.45, -(box.position[1] - box.size[1] / 2 - 0.6)], size: 2.6, plume: false });
    }
  });
  CITY_RUBBLE.forEach((r) => out.push({ position: [r.position[0], r.size[2] + 0.2, -r.position[1]], size: 3.6, plume: true }));
  [[-30, 32], [10, 64], [60, -32], [-80, -32], [30, 96], [-10, -96]].forEach(([x, y]) => out.push({ position: [x!, 0.2, -y!], size: 3, plume: false }));
  return out;
})();

const flameVertex = /* glsl */ `
attribute vec3 aOffset;
attribute float aSize;
attribute float aSeed;
varying vec2 vUv;
varying float vSeed;
void main() {
  vUv = uv; vSeed = aSeed;
  vec4 centre = viewMatrix * vec4(aOffset, 1.0);
  // Cylindrical billboard: always upright, always facing the camera.
  vec3 right = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
  vec3 world = aOffset + right * position.x * aSize + vec3(0.0, 1.0, 0.0) * (position.y + 0.5) * aSize * 1.6;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`;
const flameFragment = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
float n2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(n2(i), n2(i + vec2(1, 0)), f.x), mix(n2(i + vec2(0, 1)), n2(i + vec2(1, 1)), f.x), f.y); }
void main() {
  // Held 12 fps clock: flames flicker like hand-drawn animation frames.
  float t = floor(uTime * 12.0) / 12.0 + vSeed * 10.0;
  vec2 uv = vUv;
  float wob = (noise(vec2(uv.y * 4.0 - t * 3.0, vSeed * 9.0)) - 0.5) * 0.35 * uv.y;
  float x = abs(uv.x - 0.5 + wob) * 2.0;
  float tongue = noise(vec2(uv.x * 5.0 + vSeed, uv.y * 3.0 - t * 4.0));
  float shape = (1.0 - uv.y) * (1.15 - x * x * 1.6) + tongue * 0.35 - 0.25;
  if (shape < 0.0) discard;
  vec3 ink = vec3(0.09, 0.03, 0.05);
  vec3 col = shape < 0.06 ? ink : shape < 0.22 ? vec3(0.95, 0.22, 0.08) : shape < 0.42 ? vec3(1.0, 0.55, 0.12) : vec3(1.0, 0.92, 0.45);
  float glow = shape < 0.06 ? 1.0 : 2.4;
  gl_FragColor = vec4(col * glow, 1.0);
  #include <colorspace_fragment>
}`;

function Flames({ lean }: { lean: boolean }) {
  const { geometry, material, fires } = useMemo(() => {
    const quad = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = quad.index;
    geometry.setAttribute("position", quad.attributes.position!);
    geometry.setAttribute("uv", quad.attributes.uv!);
    const fires = CITY_FIRES.map((f, i) => {
      const tongues = lean ? 1 : f.size > 3 ? 3 : 2;
      return {
        centre: new THREE.Vector3(f.position[0], f.position[1] + f.size * 0.8, f.position[2]),
        radius: f.size * 1.6,
        tongues: Array.from({ length: tongues }, (_, k) => ({
          offset: [f.position[0] + (k - (tongues - 1) / 2) * f.size * 0.35, f.position[1], f.position[2] + ((k * 7) % 3 - 1) * 0.4] as const,
          size: f.size * (k === Math.floor(tongues / 2) ? 1 : 0.7),
          seed: i * 0.37 + k * 0.61,
        })),
      };
    });
    const total = fires.reduce((n, f) => n + f.tongues.length, 0);
    geometry.setAttribute("aOffset", new THREE.InstancedBufferAttribute(new Float32Array(total * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aSize", new THREE.InstancedBufferAttribute(new Float32Array(total), 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(new Float32Array(total), 1).setUsage(THREE.DynamicDrawUsage));
    geometry.instanceCount = 0;
    const material = new THREE.ShaderMaterial({ vertexShader: flameVertex, fragmentShader: flameFragment, uniforms: { uTime: stylizedTime }, side: THREE.DoubleSide });
    return { geometry, material, fires };
  }, [lean]);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  const next = useRef(0);
  // Occlusion-culled batching: every few frames, pack only visible fires into
  // the instance buffers, so fires behind towers cost no fill at all.
  useFrame(() => {
    const t = performance.now();
    if (t < next.current) return;
    next.current = t + 120;
    const offset = geometry.getAttribute("aOffset") as THREE.InstancedBufferAttribute;
    const size = geometry.getAttribute("aSize") as THREE.InstancedBufferAttribute;
    const seed = geometry.getAttribute("aSeed") as THREE.InstancedBufferAttribute;
    let n = 0;
    for (const fire of fires) {
      if (!isSphereVisible(fire.centre, fire.radius)) continue;
      for (const tongue of fire.tongues) { offset.setXYZ(n, ...tongue.offset); size.setX(n, tongue.size); seed.setX(n, tongue.seed); n++; }
    }
    geometry.instanceCount = n;
    offset.needsUpdate = size.needsUpdate = seed.needsUpdate = true;
  });
  return <mesh geometry={geometry} material={material} frustumCulled={false} userData={{ noInk: true }} />;
}

/** Inked smoke balls rising from the big fires and drifting downwind. */
function Smoke({ gradient, lean }: { gradient: THREE.Texture; lean: boolean }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const plumes = useMemo(() => CITY_FIRES.filter((f) => f.plume).slice(0, lean ? 5 : undefined), [lean]);
  const plumeCentre = useMemo(() => plumes.map((f) => new THREE.Vector3(f.position[0] + 6, f.position[1] + f.size + 16, f.position[2])), [plumes]);
  const PER = 9;
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), s: new THREE.Vector3(), p: new THREE.Vector3() }), []);
  useFrame(() => {
    const t = stylizedTime.value;
    plumes.forEach((f, i) => {
      if (!isSphereVisible(plumeCentre[i]!, 24)) {
        for (let k = 0; k < PER; k++) mesh.current?.setMatrixAt(i * PER + k, tmp.m.makeScale(0, 0, 0));
        return;
      }
      for (let k = 0; k < PER; k++) {
        const life = ((t * 0.09 + k / PER + i * 0.13) % 1);
        const rise = life * (26 + f.size * 4);
        tmp.p.set(f.position[0] + life * life * 14 + Math.sin(k * 2.1 + t * 0.3) * 1.2, f.position[1] + f.size + rise, f.position[2] + Math.cos(k * 1.7) * 1.2);
        const grow = f.size * (0.5 + life * 1.6) * Math.min(1, life * 6) * (1 - Math.max(0, life - 0.8) * 5);
        tmp.m.compose(tmp.p, tmp.q, tmp.s.setScalar(Math.max(0.001, grow)));
        mesh.current?.setMatrixAt(i * PER + k, tmp.m);
      }
    });
    if (mesh.current) mesh.current.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, plumes.length * PER]} frustumCulled={false}>
      <icosahedronGeometry args={[1, 1]} />
      <meshToonMaterial color="#2e2530" emissive="#3a1208" emissiveIntensity={0.35} gradientMap={gradient} />
    </instancedMesh>
  );
}

const particleVertex = /* glsl */ `
uniform float uTime;
uniform float uFall;
attribute float aSeed;
varying float vSeed;
void main() {
  vSeed = aSeed;
  vec3 p = position;
  float speed = mix(3.0, 7.0, fract(aSeed * 7.3));
  p.y = mod(p.y + uTime * speed * (uFall > 0.5 ? -0.35 : 1.0), 90.0);
  p.x += sin(uTime * 0.7 + aSeed * 30.0) * 3.0 + uTime * (uFall > 0.5 ? 1.5 : 0.6);
  p.x = mod(p.x + 130.0, 260.0) - 130.0;
  p.z += cos(uTime * 0.5 + aSeed * 20.0) * 3.0;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = clamp((uFall > 0.5 ? 3.0 : 2.4) * 80.0 / -mv.z, 1.0, 5.0);
  gl_Position = projectionMatrix * mv;
}`;
const particleFragment = /* glsl */ `
uniform float uFall;
varying float vSeed;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  vec3 col = uFall > 0.5 ? vec3(0.55, 0.5, 0.52) : mix(vec3(1.0, 0.45, 0.1), vec3(1.0, 0.85, 0.3), fract(vSeed * 13.1)) * 2.5;
  gl_FragColor = vec4(col, uFall > 0.5 ? 0.7 : 1.0);
}`;

function Particles({ count, fall }: { count: number; fall: boolean }) {
  const { geometry, material } = useMemo(() => {
    const positions = new Float32Array(count * 3), seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const r = (k: number) => { const v = Math.sin(i * 12.9 + k * 78.2 + (fall ? 3 : 0)) * 43758.5; return v - Math.floor(v); };
      positions.set([(r(1) - 0.5) * 260, r(2) * 90, (r(3) - 0.5) * 260], i * 3);
      seeds[i] = r(4);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    const material = new THREE.ShaderMaterial({
      vertexShader: particleVertex, fragmentShader: particleFragment, transparent: true, depthWrite: false,
      blending: fall ? THREE.NormalBlending : THREE.AdditiveBlending,
      uniforms: { uTime: stylizedTime, uFall: { value: fall ? 1 : 0 } },
    });
    return { geometry, material };
  }, [count, fall]);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  return <points geometry={geometry} material={material} frustumCulled={false} />;
}

const skyVertex = /* glsl */ `
varying vec3 vDir;
void main() { vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`;
const skyFragment = /* glsl */ `
uniform float uFlash;
uniform float uTime;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(vec3(0.95, 0.32, 0.12), vec3(0.32, 0.06, 0.16), smoothstep(0.0, 0.18, h));
  col = mix(col, vec3(0.07, 0.03, 0.12), smoothstep(0.18, 0.7, h));
  col = mix(col, vec3(0.23, 0.1, 0.12), 1.0 - smoothstep(-0.03, 0.03, h));
  // Stepped Hollow bands swirling around the zenith.
  float a = atan(d.z, d.x);
  float swirl = step(0.72, fract(a * 1.6 + h * 5.0 - uTime * 0.03)) * smoothstep(0.3, 0.8, h) * 0.18;
  col += vec3(0.5, 0.15, 0.7) * swirl;
  col += vec3(0.8, 0.75, 1.0) * uFlash * smoothstep(-0.1, 0.5, h);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const riftFragment = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float a = atan(p.y, p.x);
  float spiral = fract(a / 6.2831 * 3.0 + r * 2.2 - uTime * 0.25);
  vec3 core = vec3(0.02, 0.0, 0.04);
  vec3 arm = mix(vec3(0.75, 0.2, 1.0), vec3(1.0, 0.35, 0.65), r);
  float band = step(0.55, spiral) * smoothstep(0.15, 0.5, r);
  vec3 col = mix(core, arm * 2.2, band);
  col = mix(col, vec3(1.6, 0.8, 2.2), smoothstep(0.9, 0.97, r));
  col = mix(col, vec3(0.05, 0.0, 0.06), step(0.985, r));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

function Sky() {
  const dome = useRef<THREE.Mesh>(null);
  const rings = useRef<THREE.Group>(null);
  const flash = useMemo(() => ({ value: 0 }), []);
  const next = useRef(3);
  const skyMaterial = useMemo(() => new THREE.ShaderMaterial({ vertexShader: skyVertex, fragmentShader: skyFragment, side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { uFlash: flash, uTime: stylizedTime } }), [flash]);
  const riftMaterial = useMemo(() => new THREE.ShaderMaterial({ vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }", fragmentShader: riftFragment, side: THREE.DoubleSide, fog: false, uniforms: { uTime: stylizedTime } }), []);
  useEffect(() => () => { skyMaterial.dispose(); riftMaterial.dispose(); }, [skyMaterial, riftMaterial]);
  const { scene } = useThree();
  useFrame(({ camera }) => {
    dome.current?.position.copy(camera.position);
    const t = stylizedTime.value;
    if (t > next.current) { next.current = t + 4 + Math.random() * 6; flash.value = 1; }
    flash.value = Math.max(0, flash.value - 0.06);
    const f = flash.value > 0.6 || (flash.value > 0.25 && flash.value < 0.4) ? flash.value : 0;
    scene.userData.lightning = f;
    if (rings.current) { rings.current.children.forEach((c, i) => { c.rotation.z = t * (i % 2 ? -0.2 : 0.14) + i; }); }
  });
  return (
    <group name="city-sky">
      <mesh ref={dome} material={skyMaterial} renderOrder={-10} frustumCulled={false} userData={{ noInk: true }}>
        <sphereGeometry args={[900, 32, 16]} />
      </mesh>
      <group position={[0, 105, 0]} rotation={[-Math.PI / 2 + 0.12, 0, 0]}>
        <mesh material={riftMaterial} userData={{ noInk: true }}><circleGeometry args={[46, 64]} /></mesh>
        <group ref={rings}>
          {[52, 60, 70].map((r, i) => (
            <mesh key={r} rotation={[0.2 * i, 0.15 * i, 0]} userData={{ noInk: true }}>
              <torusGeometry args={[r, 0.5 + i * 0.3, 6, 96]} />
              <meshBasicMaterial color={i % 2 ? "#ff4fa0" : "#b44bff"} toneMapped={false} fog={false} />
            </mesh>
          ))}
        </group>
      </group>
      <mesh position={[0, 52, 0]} userData={{ noInk: true }}>
        <cylinderGeometry args={[1.8, 7, 104, 24, 1, true]} />
        <meshBasicMaterial color="#b44bff" transparent opacity={0.16} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} fog={false} />
      </mesh>
    </group>
  );
}

/** Ruined skyline beyond the playable grid, inked against the burning sky. */
function DistantSkyline() {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const COUNT = 140;
  useEffect(() => {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
    for (let i = 0; i < COUNT; i++) {
      const r = (k: number) => { const v = Math.sin(i * 45.7 + k * 12.3) * 43758.5; return v - Math.floor(v); };
      const a = (i / COUNT) * Math.PI * 2 + r(1) * 0.04;
      const d = 160 + r(2) * 170;
      const h = 30 + r(3) ** 2 * 140;
      const w = 10 + r(4) * 18;
      m.compose(p.set(Math.cos(a) * d, h / 2, Math.sin(a) * d), q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), (r(5) - 0.5) * (r(6) < 0.2 ? 0.25 : 0)), s.set(w, h, w));
      mesh.current?.setMatrixAt(i, m);
      mesh.current?.setColorAt(i, c.set(d > 260 ? "#3a1c2e" : "#24121e"));
    }
    if (mesh.current) { mesh.current.instanceMatrix.needsUpdate = true; if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true; }
  }, []);
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, COUNT]} frustumCulled={false} userData={{ ink: true }}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial fog={false} />
    </instancedMesh>
  );
}

const SHADOW_EXTENT = 90;
const SHADOW_MAP = 2048;
const SUN_DIR = new THREE.Vector3(140, 70, 90).normalize();

function Lights() {
  const hemi = useRef<THREE.HemisphereLight>(null);
  const key = useRef<THREE.DirectionalLight>(null);
  const fires = useRef<THREE.PointLight[]>([]);
  const { scene, camera } = useThree();
  const { tier } = useSyncExternalStore(visualQuality.subscribe, qualitySnapshot);
  const lightCount = tier === 0 ? 1 : 3;
  const plumes = useMemo(() => CITY_FIRES.filter((f) => f.plume), []);
  const tmp = useMemo(() => ({ right: new THREE.Vector3(), up: new THREE.Vector3(), centre: new THREE.Vector3(), next: 0 }), []);
  useEffect(() => {
    // Hidden (occlusion-culled) towers must still cast shadows.
    key.current?.shadow.camera.layers.enable(HIDDEN_LAYER);
    if (key.current) scene.add(key.current.target);
    return () => { if (key.current) scene.remove(key.current.target); };
  }, [scene]);
  useFrame(() => {
    const flash = (scene.userData.lightning as number) ?? 0;
    if (hemi.current) hemi.current.intensity = 0.95 + flash * 2.5;
    const light = key.current;
    if (light) {
      light.intensity = 2.1 + flash * 1.8;
      // Shadow camera follows the view, snapped to whole shadow texels in
      // light space so edges don't shimmer as you fly.
      const texel = (SHADOW_EXTENT * 2) / SHADOW_MAP;
      tmp.right.crossVectors(SUN_DIR, THREE.Object3D.DEFAULT_UP).normalize();
      tmp.up.crossVectors(tmp.right, SUN_DIR).normalize();
      tmp.centre.copy(camera.position);
      tmp.centre.y = 0;
      const r = Math.round(tmp.centre.dot(tmp.right) / texel) * texel;
      const u = Math.round(tmp.centre.dot(tmp.up) / texel) * texel;
      const f = tmp.centre.dot(SUN_DIR);
      tmp.centre.copy(tmp.right).multiplyScalar(r).addScaledVector(tmp.up, u).addScaledVector(SUN_DIR, f);
      light.target.position.copy(tmp.centre);
      light.position.copy(tmp.centre).addScaledVector(SUN_DIR, 220);
      light.target.updateMatrixWorld();
    }
    // Light LOD: a few dynamic lights re-assigned to the fires nearest you.
    const t = stylizedTime.value;
    if (t > tmp.next) {
      tmp.next = t + 0.4;
      const nearest = [...plumes].sort((a, b) => camera.position.distanceToSquared(new THREE.Vector3(...a.position)) - camera.position.distanceToSquared(new THREE.Vector3(...b.position)));
      fires.current.forEach((l, i) => { const fire = nearest[i]; if (l && fire) l.position.set(fire.position[0], fire.position[1] + fire.size, fire.position[2]); });
    }
    fires.current.forEach((l, i) => { if (l) l.intensity = 900 * (0.8 + 0.2 * Math.sin(t * 13 + i * 2) * Math.sin(t * 7.3 + i)); });
  });
  return (
    <>
      <color attach="background" args={[FOG]} />
      <fog attach="fog" args={[FOG, 70, 280]} />
      <hemisphereLight ref={hemi} args={["#b08a9a", "#2a1418", 0.95]} />
      <directionalLight
        ref={key}
        intensity={2.1}
        color="#ffb27a"
        castShadow
        shadow-mapSize={[tier === 0 ? 1024 : SHADOW_MAP, tier === 0 ? 1024 : SHADOW_MAP]}
        shadow-camera-left={-SHADOW_EXTENT}
        shadow-camera-right={SHADOW_EXTENT}
        shadow-camera-top={SHADOW_EXTENT}
        shadow-camera-bottom={-SHADOW_EXTENT}
        shadow-camera-near={20}
        shadow-camera-far={420}
        shadow-bias={-0.0004}
        shadow-normalBias={0.05}
      />
      <directionalLight position={[-90, 40, -120]} intensity={0.45} color="#7a5cff" />
      {Array.from({ length: lightCount }, (_, i) => (
        <pointLight key={`${tier}-${i}`} ref={(l) => { if (l) fires.current[i] = l; }} color="#ff7a2a" intensity={900} distance={60} decay={2} />
      ))}
    </>
  );
}

export function CityWorld({ scenario }: { scenario?: Scenario }) {
  const gradient = useMemo(createCelGradientMap, []);
  useEffect(() => () => gradient.dispose(), [gradient]);
  const { gl } = useThree();
  useEffect(() => {
    const previous = gl.localClippingEnabled;
    gl.localClippingEnabled = true;
    return () => { gl.localClippingEnabled = previous; };
  }, [gl]);
  void scenario;
  void CITY_WORLD;
  // Performance tier: fewer effects particles, capped smoke, one flame tongue, no far skyline.
  const { tier } = useSyncExternalStore(visualQuality.subscribe, qualitySnapshot);
  const lean = tier === 0;
  return (
    <>
      <Lights />
      <Sky />
      {!lean && <DistantSkyline />}
      <Streets gradient={gradient} />
      <Buildings gradient={gradient} />
      <WaterTanks gradient={gradient} />
      <Billboards />
      <Rubble gradient={gradient} />
      <Flames lean={lean} />
      <Smoke key={lean ? "lean" : "full"} gradient={gradient} lean={lean} />
      <Particles key={lean ? "e-lean" : "e-full"} count={lean ? 220 : 700} fall={false} />
      <Particles key={lean ? "a-lean" : "a-full"} count={lean ? 260 : 900} fall />
    </>
  );
}

