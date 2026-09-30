import { useEffect, useMemo, useRef, useSyncExternalStore, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Obstacle, PhysicalState, V3 } from "../../../packages/contracts";
import type { FreeWorldDefinition } from "../../../packages/contracts/free-world";
import { stylizedTime } from "./cel-material";
import { navMarker, navStore } from "./nav-store";

export const enu = ([x, y, z]: V3): THREE.Vector3 => new THREE.Vector3(x, z, -y);

/**
 * Camera-facing ribbon geometry (Wind Waker's "thick lines"): the curve is
 * static and all motion lives in the shader, so hundreds of metres of
 * animated line cost one draw call.
 */
export function buildRibbon(curves: { points: THREE.Vector3[]; phase?: number }[], samples = 90) {
  const position: number[] = [], tangent: number[] = [], side: number[] = [], u: number[] = [], metres: number[] = [], phase: number[] = [];
  const index: number[] = [];
  let base = 0;
  for (const curve of curves) {
    const spline = new THREE.CatmullRomCurve3(curve.points, false, "centripetal");
    const length = spline.getLength();
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const p = spline.getPointAt(t), d = spline.getTangentAt(t);
      for (const s of [-1, 1]) {
        position.push(p.x, p.y, p.z); tangent.push(d.x, d.y, d.z); side.push(s); u.push(t); metres.push(t * length); phase.push(curve.phase ?? 0);
      }
      if (i < samples) {
        const a = base + i * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    base += (samples + 1) * 2;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute("aTangent", new THREE.Float32BufferAttribute(tangent, 3));
  geometry.setAttribute("aSide", new THREE.Float32BufferAttribute(side, 1));
  geometry.setAttribute("aU", new THREE.Float32BufferAttribute(u, 1));
  geometry.setAttribute("aMetres", new THREE.Float32BufferAttribute(metres, 1));
  geometry.setAttribute("aPhase", new THREE.Float32BufferAttribute(phase, 1));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  return geometry;
}

const ribbonVertex = /* glsl */ `
attribute vec3 aTangent;
attribute float aSide;
attribute float aU;
attribute float aMetres;
attribute float aPhase;
uniform float uWidth;
uniform float uTime;
uniform float uGust;
varying float vU;
varying float vSide;
varying float vMetres;
varying float vDepth;
varying float vHead;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 t = normalize((modelViewMatrix * vec4(aTangent, 0.0)).xyz);
  vec3 s = normalize(cross(t, normalize(mv.xyz)));
  float width = uWidth;
  vHead = fract(uTime * 0.16 + aPhase) * 1.9 - 0.25;
  if (uGust > 0.5) {
    float k = clamp((aU - (vHead - 0.36)) / 0.36, 0.0, 1.0);
    width *= sin(k * 3.14159) * step(aU, vHead);
  }
  mv.xyz += s * aSide * width * 0.5;
  vU = aU; vSide = aSide; vMetres = aMetres; vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const routeFragment = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uEdge;
uniform float uTime;
uniform float uFade;
uniform float uNear;
varying float vSide;
varying float vMetres;
varying float vDepth;
void main() {
  float across = abs(vSide);
  float chevron = fract(vMetres / 3.2 + across * 0.35 - uTime * 1.1);
  float body = step(chevron, 0.38);
  float rail = step(0.82, across);
  float alpha = max(body * 0.85, rail * 0.55);
  alpha *= smoothstep(uNear, uNear * 3.5, vDepth) * (1.0 - smoothstep(uFade * 0.45, uFade, vDepth));
  if (alpha < 0.02) discard;
  gl_FragColor = vec4(mix(uColor, uEdge, rail), alpha);
  #include <colorspace_fragment>
}`;

const gustFragment = /* glsl */ `
uniform vec3 uColor;
varying float vU;
varying float vSide;
varying float vDepth;
varying float vHead;
void main() {
  float tail = vHead - 0.36;
  float alpha = smoothstep(tail, vHead, vU) * step(vU, vHead) * (1.0 - smoothstep(0.55, 1.0, abs(vSide)));
  alpha *= smoothstep(1.5, 5.0, vDepth) * (1.0 - smoothstep(90.0, 170.0, vDepth));
  if (alpha < 0.02) discard;
  gl_FragColor = vec4(uColor, alpha * 0.9);
  #include <colorspace_fragment>
}`;

function useRibbonMaterial(fragmentShader: string, uniforms: Record<string, THREE.IUniform>, gust = false) {
  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: ribbonVertex,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uTime: stylizedTime, uGust: { value: gust ? 1 : 0 }, ...uniforms },
  }), []);
  useEffect(() => () => material.dispose(), [material]);
  return material;
}

/** A flowing chevron line: the level's primary leading line. */
export function RouteRibbon({ points, color = "#fff1c4", edge = "#ffb083", width = 0.9, fade = 190, near = 5 }: { points: V3[]; color?: string; edge?: string; width?: number; fade?: number; near?: number }) {
  const geometry = useMemo(() => buildRibbon([{ points: points.map(enu) }], points.length * 24), [points]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = useRibbonMaterial(routeFragment, {
    uColor: { value: new THREE.Color(color) },
    uEdge: { value: new THREE.Color(edge) },
    uWidth: { value: width },
    uFade: { value: fade },
    uNear: { value: near },
  });
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={2} />;
}

/** Wind Waker–style gusts: a tapered streak that travels a curling path. */
export function WindGusts({ gusts, color = "#fffbea", width = 0.32 }: { gusts: { from: V3; heading: number; length: number; curl?: boolean }[]; color?: string; width?: number }) {
  const geometry = useMemo(() => buildRibbon(gusts.map((gust, g) => {
    const points: THREE.Vector3[] = [];
    const dir = new THREE.Vector3(Math.cos(gust.heading), 0, -Math.sin(gust.heading));
    const sideways = new THREE.Vector3(-dir.z, 0, dir.x);
    const start = enu(gust.from);
    const steps = 26;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const p = start.clone().addScaledVector(dir, gust.length * t).addScaledVector(sideways, Math.sin(t * 5 + g) * 0.9);
      if (gust.curl !== false && t > 0.52 && t < 0.86) {
        const a = ((t - 0.52) / 0.34) * Math.PI * 2;
        const r = gust.length * 0.07;
        p.addScaledVector(dir, -Math.sin(a) * r * 1.6).add(new THREE.Vector3(0, (1 - Math.cos(a)) * r, 0));
      }
      p.y += Math.sin(t * 3 + g * 1.7) * 0.6;
      points.push(p);
    }
    return { points, phase: (g * 0.618) % 1 };
  }), 70), [gusts]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = useRibbonMaterial(gustFragment, { uColor: { value: new THREE.Color(color) }, uWidth: { value: width } }, true);
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={3} />;
}

const beaconVertex = /* glsl */ `
varying vec2 vUv;
varying float vFacing;
varying float vDepth;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  vFacing = clamp(abs(dot(n, normalize(-mv.xyz))), 0.0, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const beaconFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
uniform float uHeight;
uniform float uTime;
varying vec2 vUv;
varying float vFacing;
varying float vDepth;
void main() {
  float rise = step(0.55, fract(vUv.y * uHeight / 4.5 - uTime * 0.8));
  float alpha = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.4) * (0.35 + 0.65 * rise) * (0.35 + 0.65 * pow(max(1.0 - vFacing, 0.0), 1.5));
  alpha *= smoothstep(3.0, 14.0, vDepth);
  gl_FragColor = vec4(uColor * uIntensity, alpha * uIntensity);
  #include <colorspace_fragment>
}`;

function Beacon({ position, color, height, radius, intensity, active }: { position: THREE.Vector3; color: string; height: number; radius: number; intensity: number; active: boolean }) {
  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: beaconVertex,
    fragmentShader: beaconFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(color) }, uIntensity: { value: intensity }, uHeight: { value: height }, uTime: stylizedTime },
  }), [color, height, intensity]);
  useEffect(() => () => material.dispose(), [material]);
  const ring = useRef<THREE.Mesh>(null);
  const icon = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const t = stylizedTime.value;
    if (ring.current) {
      const k = (t * 0.55) % 1;
      ring.current.scale.setScalar(1 + k * 2.6);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.8;
    }
    if (icon.current) {
      icon.current.rotation.y = t * 1.6;
      icon.current.position.y = height * 0.08 + Math.sin(t * 2.2) * radius * 0.25 + radius * 2.2;
    }
  });
  return (
    <group position={position}>
      {height > 0 && (
        <mesh position={[0, height / 2, 0]} material={material} renderOrder={4}>
          <cylinderGeometry args={[radius, radius, height, 24, 1, true]} />
        </mesh>
      )}
      {active && (
        <>
          <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]} renderOrder={4}>
            <ringGeometry args={[radius * 0.9, radius * 1.15, 40]} />
            <meshBasicMaterial color={color} transparent depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
          </mesh>
          <mesh ref={icon} renderOrder={4} userData={{ ink: true }}>
            <octahedronGeometry args={[radius * 0.55, 0]} />
            <meshBasicMaterial color={color} toneMapped={false} />
          </mesh>
        </>
      )}
    </group>
  );
}

function beaconBase(world: FreeWorldDefinition, [x, y, z]: V3) {
  let top = z;
  for (const o of world.obstacles as Obstacle[]) {
    const [ox, oy, oz] = o.position, [sx, sy, sz] = o.size;
    if (Math.abs(x - ox) < sx / 2 + 0.5 && Math.abs(y - oy) < sy / 2 + 0.5) top = Math.max(top, oz + sz / 2);
  }
  return top;
}

/**
 * Landmark "weenies": light columns that stay legible over the whole map,
 * with the chosen next spot pulsing. Also projects that landmark to screen
 * space for the HUD marker. Non-colliding, visual only.
 */
export function LandmarkBeacons({ world, worldId, height, radius, state }: { world: FreeWorldDefinition; worldId: "valley" | "pizzeria"; height: (base: number) => number; radius: number; state: MutableRefObject<PhysicalState | undefined> }) {
  const nav = useSyncExternalStore(navStore.subscribe, navStore.get);
  const sameWorld = nav.worldId === worldId;
  const bases = useMemo(() => world.landmarks.map((l) => {
    const base = beaconBase(world, l.position);
    return { id: l.id, color: l.color, base, target: enu([l.position[0], l.position[1], base]) };
  }), [world]);
  const active = sameWorld ? nav.waypoint % world.landmarks.length : -1;
  const projected = useMemo(() => new THREE.Vector3(), []);
  const inCamera = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => () => { navMarker.active = false; }, []);
  useFrame(({ camera }) => {
    const target = bases[active];
    if (!target) { navMarker.active = false; return; }
    projected.copy(target.target);
    projected.y += radius * 2.2;
    inCamera.copy(projected).applyMatrix4(camera.matrixWorldInverse);
    projected.project(camera);
    const behind = inCamera.z > 0;
    let { x, y } = projected;
    if (behind) { x = -x; y = -y; }
    const onScreen = !behind && Math.abs(x) < 0.92 && Math.abs(y) < 0.86;
    navMarker.active = true;
    navMarker.onScreen = onScreen;
    navMarker.angle = Math.atan2(-y, x);
    const edge = Math.max(Math.abs(x) / 0.92, Math.abs(y) / 0.86, 1);
    navMarker.x = (x / (onScreen ? 1 : edge) + 1) / 2;
    navMarker.y = (1 - y / (onScreen ? 1 : edge)) / 2;
    const s = state.current;
    const p = world.landmarks[active].position;
    navMarker.distance = s ? Math.hypot(p[0] - s.position[0], p[1] - s.position[1], p[2] - s.position[2]) : 0;
  });
  return (
    <group name="landmark-beacons">
      {bases.map((b, i) => {
        const visited = sameWorld && nav.visited.includes(b.id);
        return (
          <Beacon
            key={b.id}
            position={b.target}
            color={visited && i !== active ? "#d5f595" : b.color}
            height={height(b.base)}
            radius={radius}
            intensity={i === active ? 1 : visited ? 0.28 : 0.5}
            active={i === active}
          />
        );
      })}
    </group>
  );
}
