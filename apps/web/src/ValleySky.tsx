import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { rimLight, stylizedTime } from "./cel-material";
import { qualitySnapshot, visualQuality } from "./toon-pipeline";

/**
 * Everything in this file is scenery outside Aster Valley's ±200 m flight
 * square (or is the sky itself). None of it is reachable, so none of it needs
 * a collider. Coordinates here are Three.js (x east, y up, z south).
 */

export const VALLEY_SUN = new THREE.Vector3(-150, 72, 62);
export const VALLEY_HAZE = "#c7dfd6";

const skyVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const skyFragment = /* glsl */ `
uniform vec3 zenith;
uniform vec3 upper;
uniform vec3 horizon;
uniform vec3 haze;
uniform vec3 sunColor;
uniform vec3 sunDir;
varying vec3 vDir;
void main() {
  vec3 dir = normalize(vDir);
  float h = dir.y;
  float toSun = max(dot(dir, sunDir), 0.0);
  vec3 warmHorizon = mix(horizon, sunColor, pow(toSun, 5.0) * 0.55);
  vec3 col = mix(warmHorizon, upper, smoothstep(0.0, 0.22, h));
  col = mix(col, zenith, smoothstep(0.2, 0.85, h));
  col = mix(col, haze, 1.0 - smoothstep(-0.02, 0.035, h));
  // Anime sun: a hard disc with stepped halo rings rather than a soft bloom.
  float d = dot(dir, sunDir);
  col = mix(col, sunColor, step(0.9935, d) * 0.28);
  col = mix(col, sunColor, step(0.9975, d) * 0.45);
  col = mix(col, vec3(1.0, 0.985, 0.93), step(0.99925, d));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function SkyDome() {
  const mesh = useRef<THREE.Mesh>(null);
  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: skyVertex,
    fragmentShader: skyFragment,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      zenith: { value: new THREE.Color("#3d78bd") },
      upper: { value: new THREE.Color("#86c3de") },
      horizon: { value: new THREE.Color("#e9ecd2") },
      haze: { value: new THREE.Color(VALLEY_HAZE) },
      sunColor: { value: new THREE.Color("#ffd89a") },
      sunDir: { value: VALLEY_SUN.clone().normalize() },
    },
  }), []);
  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ camera }) => mesh.current?.position.copy(camera.position));
  return (
    <mesh ref={mesh} material={material} renderOrder={-10} frustumCulled={false} userData={{ noInk: true }}>
      <sphereGeometry args={[900, 32, 16]} />
    </mesh>
  );
}

const cloudPuffs: [number, number, number, number][] = [
  [0, 0, 0, 1], [1.15, -0.12, 0.1, 0.78], [-1.1, -0.18, -0.05, 0.72],
  [0.4, 0.42, -0.1, 0.7], [-0.45, 0.28, 0.2, 0.62], [2.0, -0.32, 0, 0.5], [-1.9, -0.36, 0.1, 0.46],
];
const cloudBank: { position: [number, number, number]; scale: number; spin: number }[] = [
  { position: [320, 72, -150], scale: 17, spin: 0.2 },
  { position: [300, 88, 170], scale: 21, spin: 1.1 },
  { position: [-330, 80, -60], scale: 19, spin: 2.2 },
  { position: [-290, 64, 190], scale: 14, spin: 0.8 },
  { position: [60, 96, -350], scale: 24, spin: 1.7 },
  { position: [-150, 70, -320], scale: 15, spin: 2.9 },
  { position: [180, 62, 330], scale: 16, spin: 0.4 },
  { position: [-60, 104, 360], scale: 22, spin: 1.3 },
  { position: [380, 110, 30], scale: 26, spin: 2.5 },
];

/** One merged geometry per cloud: all puffs in a single draw. */
function cloudGeometry() {
  const parts = cloudPuffs.map(([x, y, z, r]) => {
    const puff = new THREE.SphereGeometry(1, 16, 11);
    puff.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(r, r * (y < 0 ? 0.7 : 1), r)));
    return puff;
  });
  const merged = mergeGeometries(parts)!;
  parts.forEach((part) => part.dispose());
  return merged;
}

/** Cel clouds: stepped toon puffs lit by the sun, cool violet underside. */
function Clouds({ gradientMap }: { gradientMap: THREE.Texture }) {
  const group = useRef<THREE.Group>(null);
  const geometry = useMemo(cloudGeometry, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame((_, dt) => { if (group.current) group.current.rotation.y += dt * 0.0035; });
  return (
    <group ref={group}>
      {cloudBank.map((cloud, i) => (
        <mesh key={i} geometry={geometry} position={cloud.position} rotation={[0, cloud.spin, 0]} scale={[cloud.scale, cloud.scale * 0.62, cloud.scale * 0.7]}>
          <meshToonMaterial color={i % 3 === 0 ? "#fff4df" : "#fbfbf3"} emissive="#6a6fa6" emissiveIntensity={0.18} gradientMap={gradientMap} fog={false} onBeforeCompile={rimLight} customProgramCacheKey={() => "cel-rim"} />
        </mesh>
      ))}
    </group>
  );
}

/** Seeded ridge silhouette with a hard sunlit band and a hazy foot. */
function ridgeGeometry(radius: number, height: number, seed: number, snow: boolean) {
  const segments = 180;
  const rows = snow ? [-30, 0.18, 0.62, 0.62, 1] : [-30, 0.18, 1];
  const positions: number[] = [];
  const heights: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const ridge = 0.55 + 0.22 * Math.sin(a * 3 + seed) + 0.14 * Math.sin(a * 7.3 + seed * 2.1) + 0.09 * Math.sin(a * 17.1 + seed * 0.7);
    const jag = Math.abs(Math.sin(a * 41 + seed)) * 0.08;
    heights.push(height * Math.max(0.12, ridge + jag));
  }
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    for (const row of rows) {
      const y = row < 0 ? row : heights[i] * row;
      positions.push(Math.cos(a) * radius, y, Math.sin(a) * radius);
    }
  }
  const index: number[] = [];
  const stride = rows.length;
  for (let i = 0; i < segments; i++) for (let r = 0; r < stride - 1; r++) {
    if (snow && r === 2) continue;
    const a = i * stride + r, b = (i + 1) * stride + r;
    index.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  return { geometry, rows };
}

function Ridge({ radius, height, seed, color, haze, snow = false }: { radius: number; height: number; seed: number; color: string; haze: string; snow?: boolean }) {
  const geometry = useMemo(() => {
    const { geometry, rows } = ridgeGeometry(radius, height, seed, snow);
    const base = new THREE.Color(color), foot = new THREE.Color(haze), cap = new THREE.Color("#f4f1ea");
    const colors: number[] = [];
    const count = geometry.attributes.position.count;
    for (let v = 0; v < count; v++) {
      const row = v % rows.length;
      const c = row === 0 ? foot : snow && row >= 3 ? cap : base;
      colors.push(c.r, c.g, c.b);
    }
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    return geometry;
  }, [radius, height, seed, color, haze, snow]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} userData={{ ink: true }}>
      <meshBasicMaterial vertexColors fog={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

function WindTurbine({ position, heading, phase, gradientMap }: { position: [number, number, number]; heading: number; phase: number; gradientMap: THREE.Texture }) {
  const rotor = useRef<THREE.Group>(null);
  useFrame(() => { if (rotor.current) rotor.current.rotation.z = stylizedTime.value * 0.9 + phase; });
  return (
    <group position={position} rotation={[0, heading, 0]}>
      <mesh position={[0, 20, 0]}><cylinderGeometry args={[0.55, 1.1, 40, 10]} /><meshToonMaterial color="#f3efe6" gradientMap={gradientMap} /></mesh>
      <mesh position={[0, 40.4, 0.6]}><boxGeometry args={[1.6, 1.6, 3.6]} /><meshToonMaterial color="#ece6da" gradientMap={gradientMap} /></mesh>
      <group ref={rotor} position={[0, 40.4, 2.6]}>
        <mesh><sphereGeometry args={[0.8, 12, 8]} /><meshToonMaterial color="#e36b4f" gradientMap={gradientMap} /></mesh>
        {[0, 1, 2].map((b) => (
          <group key={b} rotation={[0, 0, (b * Math.PI * 2) / 3]}>
            <mesh position={[0, 7.5, 0.1]}><boxGeometry args={[0.9, 15, 0.25]} /><meshToonMaterial color="#faf7f0" gradientMap={gradientMap} /></mesh>
          </group>
        ))}
      </group>
    </group>
  );
}

const balloonStripes = ["#ef6a5a", "#ffd166", "#54b8a8", "#fff4df"];
const balloonStripesB = ["#8b7be7", "#fff4df", "#ef8f6a", "#fff4df"];
/** Striped envelope merged into one vertex-coloured mesh. */
function balloonGeometry(palette: string[]) {
  const colour = new THREE.Color();
  const parts = palette.concat(palette).map((hex, i) => {
    const stripe = new THREE.SphereGeometry(3, 6, 12, (i * Math.PI) / 4, Math.PI / 4);
    stripe.scale(1, 1.18, 1);
    stripe.translate(0, 4, 0);
    colour.set(hex);
    const count = stripe.attributes.position.count;
    stripe.setAttribute("color", new THREE.Float32BufferAttribute(Array.from({ length: count }, () => [colour.r, colour.g, colour.b]).flat(), 3));
    return stripe;
  });
  const merged = mergeGeometries(parts)!;
  parts.forEach((part) => part.dispose());
  return merged;
}

function Balloon({ orbit, radius, height, speed, palette, gradientMap }: { orbit: number; radius: number; height: number; speed: number; palette: string[]; gradientMap: THREE.Texture }) {
  const group = useRef<THREE.Group>(null);
  const envelope = useMemo(() => balloonGeometry(palette), [palette]);
  useEffect(() => () => envelope.dispose(), [envelope]);
  useFrame(() => {
    const t = stylizedTime.value * speed + orbit;
    group.current?.position.set(Math.cos(t) * radius, height + Math.sin(stylizedTime.value * 0.4 + orbit) * 3, Math.sin(t) * radius);
  });
  return (
    <group ref={group} scale={2.2}>
      <mesh geometry={envelope}>
        <meshToonMaterial vertexColors gradientMap={gradientMap} onBeforeCompile={rimLight} customProgramCacheKey={() => "cel-rim"} />
      </mesh>
      <mesh position={[0, 0.2, 0]}><cylinderGeometry args={[1.25, 0.8, 1.2, 10, 1, true]} /><meshToonMaterial color="#b56b44" gradientMap={gradientMap} side={THREE.DoubleSide} /></mesh>
      <mesh position={[0, -1.4, 0]}><boxGeometry args={[1.1, 0.9, 1.1]} /><meshToonMaterial color="#8a5236" gradientMap={gradientMap} /></mesh>
    </group>
  );
}

function HeroPeak({ east, north, scale, gradientMap }: { east: number; north: number; scale: number; gradientMap: THREE.Texture }) {
  return (
    <group position={[east, scale / 2 - 2, -north]}>
      <mesh castShadow receiveShadow>
        <coneGeometry args={[scale * 0.56, scale, 7]} />
        <meshToonMaterial color="#5a6a94" gradientMap={gradientMap} />
      </mesh>
      <mesh position={[0, scale * 0.34, 0]}>
        <coneGeometry args={[scale * 0.188, scale * 0.321, 7]} />
        <meshToonMaterial color="#f5f1e8" gradientMap={gradientMap} />
      </mesh>
    </group>
  );
}

/** Sky, far ranges and ambient motion for Aster Valley. */
export function ValleySky({ gradientMap }: { gradientMap: THREE.Texture }) {
  const { tier } = useSyncExternalStore(visualQuality.subscribe, qualitySnapshot);
  const ambient = tier > 0;
  return (
    <group name="valley-sky">
      <SkyDome />
      {ambient && <Clouds gradientMap={gradientMap} />}
      <Ridge radius={660} height={120} seed={1.7} color="#a9c4d4" haze={VALLEY_HAZE} snow />
      <Ridge radius={500} height={70} seed={4.2} color="#7e9fb6" haze={VALLEY_HAZE} />
      <Ridge radius={360} height={34} seed={2.9} color="#6f927e" haze={VALLEY_HAZE} />
      <HeroPeak east={255} north={22} scale={88} gradientMap={gradientMap} />
      <HeroPeak east={238} north={-82} scale={70} gradientMap={gradientMap} />
      <HeroPeak east={-242} north={84} scale={80} gradientMap={gradientMap} />
      <HeroPeak east={36} north={255} scale={76} gradientMap={gradientMap} />
      {ambient && <>
        <WindTurbine position={[-262, 0, 120]} heading={0.9} phase={0} gradientMap={gradientMap} />
        <WindTurbine position={[-280, 0, 62]} heading={0.8} phase={1.3} gradientMap={gradientMap} />
        <WindTurbine position={[-255, 0, 4]} heading={1} phase={2.1} gradientMap={gradientMap} />
        <WindTurbine position={[-70, 0, 272]} heading={2.6} phase={0.6} gradientMap={gradientMap} />
        <Balloon orbit={0.6} radius={300} height={52} speed={0.012} palette={balloonStripes} gradientMap={gradientMap} />
        <Balloon orbit={3.4} radius={330} height={70} speed={-0.009} palette={balloonStripesB} gradientMap={gradientMap} />
      </>}
    </group>
  );
}
