import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { V3 } from "../../../packages/contracts";
import { stylizedTime } from "./cel-material";
import { RouteRibbon } from "./WorldFx";

/**
 * Non-colliding atmosphere for the pizzeria: light shafts, dust, spotlights,
 * animated cabinet screens and original posters. Nothing here is solid; the
 * posters sit flush on existing wall colliders. Three.js coordinates.
 */

/** Indoor leading line: aisle → stage → arcade → office → exit. Clear of every collider. */
export const PARTY_ROUTE: V3[] = [
  [-12, 0, 1.6], [-4, 0, 1.7], [5, 0, 1.9], [11.5, 0, 2.3], [12, 6, 2.2], [8, 10.5, 2], [2, 11.5, 2],
  [-5, 10, 2], [-9, 8.5, 1.9], [-13, 7.8, 1.8], [-13, 5, 1.6], [-14, 2, 1.6], [-19, 0, 1.7],
];

const shaftVertex = /* glsl */ `
varying float vV;
varying float vFacing;
void main() {
  vV = uv.y;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vFacing = clamp(abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz))), 0.0, 1.0);
  gl_Position = projectionMatrix * mv;
}`;
const shaftFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uStrength;
varying float vV;
varying float vFacing;
void main() {
  float a = pow(clamp(vV, 0.0, 1.0), 1.8) * pow(clamp(vFacing, 0.0, 1.0), 1.6) * uStrength;
  gl_FragColor = vec4(uColor * a, a);
  #include <colorspace_fragment>
}`;

function useShaft(color: string, strength: number) {
  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: shaftVertex, fragmentShader: shaftFragment,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(color) }, uStrength: { value: strength } },
  }), [color, strength]);
  useEffect(() => () => material.dispose(), [material]);
  return material;
}

function LightShafts() {
  const material = useShaft("#ffd98a", 0.16);
  return (
    <group name="light-shafts">
      {[-13, -5, 3, 11].flatMap((x) => [-10, 0, 10].map((z) => (
        <mesh key={`${x}-${z}`} position={[x, 2.9, z]} material={material} renderOrder={5}>
          <cylinderGeometry args={[1.1, 3.1, 5.8, 20, 1, true]} />
        </mesh>
      )))}
    </group>
  );
}

function StageSpots() {
  const pink = useShaft("#ff6fa8", 0.32);
  const cyan = useShaft("#61e3f0", 0.28);
  const spots = useRef<THREE.Group[]>([]);
  const down = useMemo(() => new THREE.Vector3(0, -1, 0), []);
  const aim = useMemo(() => new THREE.Vector3(), []);
  const origins = useMemo(() => [new THREE.Vector3(12.6, 5.75, -4), new THREE.Vector3(12.6, 5.75, 4)], []);
  useFrame(() => {
    const t = stylizedTime.value;
    spots.current.forEach((g, i) => {
      if (!g) return;
      aim.set(16.8, 1.4 + Math.sin(t * 0.9 + i) * 0.5, Math.sin(t * 0.6 + i * 2.4) * 1.6).sub(origins[i]).normalize();
      g.quaternion.setFromUnitVectors(down, aim);
    });
  });
  return (
    <group name="stage-spots">
      {[pink, cyan].map((material, i) => (
        <group key={i} position={origins[i]} ref={(g) => { if (g) spots.current[i] = g; }}>
          <mesh position={[0, -2.9, 0]} material={material} renderOrder={5}>
            <cylinderGeometry args={[0.16, 1.2, 5.8, 18, 1, true]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

const dustVertex = /* glsl */ `
uniform float uTime;
attribute float aSeed;
varying float vTwinkle;
varying float vNear;
void main() {
  vec3 p = position;
  p.x += sin(uTime * 0.21 + aSeed * 11.0) * 0.6;
  p.y = mod(p.y + uTime * (0.05 + fract(aSeed * 7.1) * 0.08), 5.6) + 0.2;
  p.z += cos(uTime * 0.17 + aSeed * 5.0) * 0.6;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vTwinkle = 0.5 + 0.5 * sin(uTime * 2.0 + aSeed * 40.0);
  vNear = smoothstep(0.8, 3.0, -mv.z);
  gl_PointSize = min((2.0 + fract(aSeed * 3.3) * 2.5) * (9.0 / -mv.z), 5.0);
  gl_Position = projectionMatrix * mv;
}`;
const dustFragment = /* glsl */ `
varying float vTwinkle;
varying float vNear;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = (1.0 - smoothstep(0.2, 0.5, d)) * (0.25 + 0.5 * vTwinkle) * vNear;
  gl_FragColor = vec4(vec3(1.0, 0.9, 0.7) * a, a);
}`;

function Dust() {
  const { geometry, material } = useMemo(() => {
    const count = 520;
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const r = (n: number) => ((Math.sin(i * 91.7 + n * 13.3) * 43758.5453) % 1 + 1) % 1;
      positions.set([(r(1) - 0.5) * 42, r(2) * 5.6, (r(3) - 0.5) * 34], i * 3);
      seeds[i] = r(4);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    const material = new THREE.ShaderMaterial({
      vertexShader: dustVertex, fragmentShader: dustFragment,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: stylizedTime },
    });
    return { geometry, material };
  }, []);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  return <points geometry={geometry} material={material} frustumCulled={false} />;
}

const screenFragment = /* glsl */ `
uniform float uTime;
uniform vec3 uGlow;
uniform float uSeed;
varying vec2 vUv;
void main() {
  vec2 grid = floor(vUv * vec2(12.0, 20.0));
  float t = uTime * (1.3 + uSeed * 0.4) + uSeed * 10.0;
  float paddle = step(abs(grid.x - (6.0 + floor(sin(t) * 4.0))), 1.0) * step(grid.y, 1.0);
  vec2 ball = vec2(6.0 + floor(sin(t * 1.7) * 5.0), 10.0 + floor(sin(t * 2.3) * 8.0));
  float dotLit = step(distance(grid, ball), 0.5);
  float rows = step(17.0, grid.y) * step(0.5, fract(sin(dot(grid, vec2(12.9, 78.2)) + uSeed) * 43758.5));
  float scan = 0.75 + 0.25 * step(0.5, fract(vUv.y * 60.0 - uTime * 2.0));
  float lit = max(max(paddle, dotLit), rows);
  vec3 col = mix(vec3(0.02, 0.03, 0.08), uGlow * 2.2, lit) * scan;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

function ArcadeScreens() {
  const materials = useMemo(() => ["#35d5e5", "#f15b92", "#ffd35c", "#7fe690"].map((glow, i) => new THREE.ShaderMaterial({
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: screenFragment,
    uniforms: { uTime: stylizedTime, uGlow: { value: new THREE.Color(glow) }, uSeed: { value: i * 0.73 } },
  })), []);
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);
  return (
    <group name="arcade-screens">
      {[-1, 1.2, 3.4, 5.6].map((x, i) => (
        <mesh key={x} position={[x, 1.72, -14.265]} material={materials[i]}>
          <planeGeometry args={[0.62, 0.72]} />
        </mesh>
      ))}
    </group>
  );
}

function posterTexture(kind: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 256; canvas.height = 360;
  const g = canvas.getContext("2d")!;
  const palettes = [["#f3c14b", "#d84467", "#281c3a"], ["#62d9d4", "#8b5cf6", "#1b1d3a"], ["#ff8a5b", "#ffe38a", "#2b1a2e"], ["#9ee37d", "#f15b92", "#1d2a2c"]];
  const [a, b, ink] = palettes[kind % palettes.length];
  g.fillStyle = a; g.fillRect(0, 0, 256, 360);
  g.save(); g.translate(128, 150); g.fillStyle = b;
  for (let i = 0; i < 16; i++) { g.rotate(Math.PI / 8); g.beginPath(); g.moveTo(0, 0); g.lineTo(200, -22); g.lineTo(200, 22); g.closePath(); if (i % 2) g.fill(); }
  g.restore();
  g.fillStyle = "#fff6e6"; g.strokeStyle = ink; g.lineWidth = 8;
  g.beginPath(); g.arc(128, 150, 62, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = ink;
  if (kind % 2 === 0) { g.beginPath(); g.moveTo(128, 104); g.lineTo(176, 190); g.lineTo(80, 190); g.closePath(); g.fill(); g.fillStyle = b; g.beginPath(); g.arc(128, 104, 10, 0, Math.PI * 2); g.fill(); }
  else { for (let i = 0; i < 5; i++) { const t = (i / 5) * Math.PI * 2 - Math.PI / 2; g.beginPath(); g.arc(128 + Math.cos(t) * 34, 150 + Math.sin(t) * 34, 11, 0, Math.PI * 2); g.fill(); } }
  g.fillStyle = ink; g.fillRect(0, 262, 256, 98);
  g.fillStyle = "#fff6e6"; g.font = "bold 40px Arial, sans-serif"; g.textAlign = "center";
  const words = [["PARTY", "TIME!"], ["HIGH", "SCORE"], ["PIZZA", "NIGHT"], ["BIRTHDAY", "CLUB"]][kind % 4];
  g.fillText(words[0], 128, 305); g.font = "bold 32px Arial, sans-serif"; g.fillStyle = a; g.fillText(words[1], 128, 345);
  g.strokeStyle = ink; g.lineWidth = 10; g.strokeRect(5, 5, 246, 350);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

const POSTERS: { position: [number, number, number]; rotation: number; kind: number }[] = [
  { position: [-12.95, 3.35, -17.73], rotation: 0, kind: 0 },
  { position: [-5.55, 3.35, -17.73], rotation: 0, kind: 1 },
  { position: [5.55, 3.35, -17.73], rotation: 0, kind: 2 },
  { position: [12.95, 3.35, -17.73], rotation: 0, kind: 3 },
  { position: [-8, 3.35, 17.73], rotation: Math.PI, kind: 3 },
  { position: [-14, 3.35, 17.73], rotation: Math.PI, kind: 0 },
  { position: [-21.73, 3.35, 8], rotation: Math.PI / 2, kind: 1 },
  { position: [-21.73, 3.35, -8], rotation: Math.PI / 2, kind: 2 },
];

function Posters() {
  const textures = useMemo(() => [0, 1, 2, 3].map(posterTexture), []);
  useEffect(() => () => textures.forEach((t) => t.dispose()), [textures]);
  return (
    <group name="posters">
      {POSTERS.map((p, i) => (
        <mesh key={i} position={p.position} rotation={[0, p.rotation, (i % 2 ? 1 : -1) * 0.03]}>
          <planeGeometry args={[1.21, 1.7]} />
          <meshToonMaterial map={textures[p.kind]} color="#ffffff" />
        </mesh>
      ))}
    </group>
  );
}

export function PizzeriaDressing() {
  return (
    <group name="pizzeria-dressing">
      <LightShafts />
      <StageSpots />
      <Dust />
      <ArcadeScreens />
      <Posters />
      <RouteRibbon points={PARTY_ROUTE} width={0.42} fade={34} near={1.2} color="#ffe7b0" edge="#ff7aa8" />
    </group>
  );
}
