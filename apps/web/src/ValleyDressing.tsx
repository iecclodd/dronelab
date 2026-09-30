import { useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox, Text } from "@react-three/drei";
import * as THREE from "three";
import type { Obstacle, V3 } from "../../../packages/contracts";
import { FREE_WORLD } from "../../../packages/contracts/free-world";
import { grassSway, rimLight, stylizedTime } from "./cel-material";
import { RouteRibbon, WindGusts } from "./WorldFx";
import { qualitySnapshot, visualQuality } from "./toon-pipeline";
import { createSolarMap, createWindowMap } from "./world-materials";

const font = `${import.meta.env.BASE_URL}fonts/IBMPlexMono-Regular.woff`;
const visual = ([x, y, z]: V3): [number, number, number] => [x, z, -y];
const byId = (id: string) => FREE_WORLD.obstacles.find((o) => o.id === id)!;

/**
 * The Skyline: a single readable racing line from the airfield, through the
 * three Mica Yard frames, down Sundial canyon, under the arch and viaduct,
 * and through the legs of Kestrel Lookout. Every point was checked against
 * the collider list to sit in open air. Visual only.
 */
export const SKYLINE: V3[] = [
  [16, -2, 3.4], [26, -6, 4], [33, -11, 4.4], [36, -18, 4.6], [40, -24, 4.8], [50, -26, 5.4],
  [55, -30, 5.6], [60, -36, 5.8], [70, -38, 6.2], [74, -43, 6.5], [77, -49, 6.8], [96, -44, 7.4],
  [110, -18, 8], [120, 18, 8], [123, 44, 8], [123, 62, 8], [124, 78, 8], [126, 92, 7],
  [133, 102, 6.5], [137, 108, 7.4], [146, 106.5, 9], [151, 106, 9.5], [160, 106, 10.5], [174, 102, 16],
];

const GUSTS = [
  { from: [-40, 30, 9] as V3, heading: 0.1, length: 26 },
  { from: [10, 40, 14] as V3, heading: -0.2, length: 30 },
  { from: [60, 10, 18] as V3, heading: 0.35, length: 24 },
  { from: [-90, -40, 11] as V3, heading: 0.05, length: 32 },
  { from: [80, 60, 26] as V3, heading: 0.6, length: 28 },
  { from: [-10, -70, 8] as V3, heading: 0.15, length: 22 },
  { from: [120, -80, 16] as V3, heading: 1.2, length: 26 },
  { from: [-130, 60, 20] as V3, heading: -0.35, length: 34 },
  { from: [30, 90, 30] as V3, heading: 0.25, length: 30, curl: false },
  { from: [150, 20, 22] as V3, heading: 1.7, length: 24 },
  { from: [-60, 120, 16] as V3, heading: -0.1, length: 28 },
  { from: [0, -120, 24] as V3, heading: 0.4, length: 30, curl: false },
];

function mulberry(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clearOfStructures(x: number, y: number, margin: number) {
  if (Math.abs(y) < 11 && Math.abs(x) < 86) return false;
  for (const o of FREE_WORLD.obstacles) {
    if (Math.abs(x - o.position[0]) < o.size[0] / 2 + margin && Math.abs(y - o.position[1]) < o.size[1] / 2 + margin) return false;
  }
  return true;
}

function bladeGeometry() {
  const g = new THREE.BufferGeometry();
  const v: number[] = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI, c = Math.cos(a) * 0.09, s = Math.sin(a) * 0.09;
    const lean = (k - 1) * 0.08;
    v.push(-c, 0, -s, c, 0, s, lean, 0.7, 0);
  }
  g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  // Blades light like the ground under them rather than as thin cards.
  const n = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

/** ~2.6k swaying tufts and ~600 flowers in two instanced draws (skipped on the Performance tier). */
function Meadow({ gradientMap }: { gradientMap: THREE.Texture }) {
  const grass = useRef<THREE.InstancedMesh>(null);
  const flowers = useRef<THREE.InstancedMesh>(null);
  const blade = useMemo(bladeGeometry, []);
  const bloom = useMemo(() => new THREE.OctahedronGeometry(0.11, 0), []);
  useEffect(() => () => { blade.dispose(); bloom.dispose(); }, [blade, bloom]);
  const GRASS = 2600, FLOWERS = 600;
  useEffect(() => {
    const rand = mulberry(42);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
    const greens = ["#7fb58f", "#93c49a", "#6aa383", "#a9cf96"];
    const clusters = Array.from({ length: 150 }, () => [(rand() - 0.5) * 380, (rand() - 0.5) * 380] as const);
    let placed = 0;
    for (let attempt = 0; placed < GRASS && attempt < GRASS * 4; attempt++) {
      const [cx, cy] = clusters[attempt % clusters.length];
      const x = cx + (rand() - 0.5) * 16, y = cy + (rand() - 0.5) * 16;
      if (Math.abs(x) > 198 || Math.abs(y) > 198 || !clearOfStructures(x, y, 1.2)) continue;
      const k = 0.6 + rand() * 0.9;
      m.compose(p.set(x, 0, -y), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rand() * Math.PI), s.set(k, k * (0.8 + rand() * 0.6), k));
      grass.current?.setMatrixAt(placed, m);
      grass.current?.setColorAt(placed, c.set(greens[Math.floor(rand() * greens.length)]));
      placed++;
    }
    if (grass.current) { grass.current.count = placed; grass.current.instanceMatrix.needsUpdate = true; if (grass.current.instanceColor) grass.current.instanceColor.needsUpdate = true; }
    const petals = ["#ffd166", "#fff4df", "#ef8fa0", "#b9a4f0", "#ffd166"];
    let bloomed = 0;
    for (let attempt = 0; bloomed < FLOWERS && attempt < FLOWERS * 5; attempt++) {
      const [cx, cy] = clusters[(attempt * 7) % clusters.length];
      const x = cx + (rand() - 0.5) * 10, y = cy + (rand() - 0.5) * 10;
      if (Math.abs(x) > 198 || Math.abs(y) > 198 || !clearOfStructures(x, y, 1.5)) continue;
      m.compose(p.set(x, 0.32 + rand() * 0.18, -y), q.setFromEuler(new THREE.Euler(rand(), rand(), rand())), s.setScalar(0.8 + rand() * 0.7));
      flowers.current?.setMatrixAt(bloomed, m);
      flowers.current?.setColorAt(bloomed, c.set(petals[Math.floor(rand() * petals.length)]));
      bloomed++;
    }
    if (flowers.current) { flowers.current.count = bloomed; flowers.current.instanceMatrix.needsUpdate = true; if (flowers.current.instanceColor) flowers.current.instanceColor.needsUpdate = true; }
  }, []);
  return (
    <group name="meadow">
      <instancedMesh ref={grass} args={[blade, undefined, GRASS]} userData={{ noInk: true }} frustumCulled={false}>
        <meshToonMaterial gradientMap={gradientMap} side={THREE.DoubleSide} onBeforeCompile={grassSway} customProgramCacheKey={() => "grass-sway"} />
      </instancedMesh>
      <instancedMesh ref={flowers} args={[bloom, undefined, FLOWERS]} userData={{ noInk: true }} frustumCulled={false}>
        <meshToonMaterial gradientMap={gradientMap} emissive="#3a2a1a" emissiveIntensity={0.15} />
      </instancedMesh>
    </group>
  );
}

/** Two-tier cel tree that fills the trunk + crown collider boxes. */
export function CelTree({ trunk, crown, index, gradientMap }: { trunk: Obstacle; crown: Obstacle; index: number; gradientMap: THREE.Texture }) {
  const [cx, cy, cz] = crown.position;
  const [w, d, h] = crown.size;
  const tone = ["#4f8b62", "#5c9a68", "#467e5c"][index % 3];
  const top = ["#79b979", "#88c47f", "#6fae76"][index % 3];
  return (
    <group>
      <mesh position={visual(trunk.position)} castShadow>
        <cylinderGeometry args={[trunk.size[0] * 0.42, trunk.size[0] * 0.5, trunk.size[2], 8]} />
        <meshToonMaterial color="#6b4c38" gradientMap={gradientMap} />
      </mesh>
      <group position={visual([cx, cy, cz])}>
        <RoundedBox args={[w, h * 0.62, d]} radius={0.9} smoothness={3} position={[0, -h * 0.19, 0]} castShadow receiveShadow>
          <meshToonMaterial color={tone} gradientMap={gradientMap} onBeforeCompile={rimLight} customProgramCacheKey={() => "cel-rim"} />
        </RoundedBox>
        <RoundedBox args={[w * 0.74, h * 0.38, d * 0.74]} radius={0.7} smoothness={3} position={[0, h * 0.31, 0]} castShadow>
          <meshToonMaterial color={top} gradientMap={gradientMap} onBeforeCompile={rimLight} customProgramCacheKey={() => "cel-rim"} />
        </RoundedBox>
      </group>
    </group>
  );
}

/** A flush decal on one face of a collider box. Face: +y north, -y south, +x east, -x west, top. */
function FaceDecal({ box, face, width, height, offset = [0, 0], children }: { box: Obstacle; face: "north" | "south" | "east" | "west" | "top"; width: number; height: number; offset?: [number, number]; children: ReactNode }) {
  const [x, y, z] = box.position, [sx, sy, sz] = box.size;
  const e = 0.02;
  let position: V3, rotation: [number, number, number];
  switch (face) {
    case "north": position = [x + offset[0], y + sy / 2 + e, z + offset[1]]; rotation = [0, Math.PI, 0]; break;
    case "south": position = [x - offset[0], y - sy / 2 - e, z + offset[1]]; rotation = [0, 0, 0]; break;
    case "east": position = [x + sx / 2 + e, y - offset[0], z + offset[1]]; rotation = [0, Math.PI / 2, 0]; break;
    case "west": position = [x - sx / 2 - e, y + offset[0], z + offset[1]]; rotation = [0, -Math.PI / 2, 0]; break;
    default: position = [x + offset[0], y + offset[1], z + sz / 2 + e]; rotation = [-Math.PI / 2, 0, 0];
  }
  return <mesh position={visual(position)} rotation={rotation}><planeGeometry args={[width, height]} />{children}</mesh>;
}

function Buildings({ gradientMap }: { gradientMap: THREE.Texture }) {
  const [solar, windows] = useMemo(() => [createSolarMap(), createWindowMap()], []);
  useEffect(() => () => { solar.dispose(); windows.dispose(); }, [solar, windows]);
  const hangar = byId("home-hangar"), workshop = byId("home-workshop"), tower = byId("home-water-tower"), shed = byId("home-solar-shed");
  const cabin = byId("lookout-cabin"), deck = byId("lookout-deck");
  const beacon = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => { if (beacon.current) beacon.current.color.setScalar(Math.sin(stylizedTime.value * 3.2) > 0.2 ? 3 : 0.35).multiply(new THREE.Color("#ff5a4a")); });
  const lit = <meshBasicMaterial map={windows} toneMapped={false} color="#ffffff" />;
  return (
    <group name="building-details">
      {/* Hangar: painted roof number and a warm window band on both long sides. */}
      <FaceDecal box={hangar} face="top" width={20} height={2.2} offset={[0, 5.4]}><meshBasicMaterial color="#f2e7cf" /></FaceDecal>
      <FaceDecal box={hangar} face="top" width={20} height={2.2} offset={[0, -5.4]}><meshBasicMaterial color="#f2e7cf" /></FaceDecal>
      <Text font={font} position={visual([hangar.position[0], hangar.position[1], hangar.size[2] + 0.04])} rotation={[-Math.PI / 2, 0, 0]} fontSize={6} color="#ef7b57" anchorX="center" anchorY="middle">01</Text>
      <FaceDecal box={hangar} face="south" width={18} height={1.3} offset={[0, 2.6]}>{lit}</FaceDecal>
      <FaceDecal box={hangar} face="west" width={12} height={1.3} offset={[0, 2.6]}>{lit}</FaceDecal>
      <FaceDecal box={hangar} face="north" width={22.02} height={0.6} offset={[0, 4.7]}><meshBasicMaterial color="#ef7b57" /></FaceDecal>
      {/* Workshop windows + door. */}
      <FaceDecal box={workshop} face="north" width={9} height={1.1} offset={[0, 1.2]}>{lit}</FaceDecal>
      <FaceDecal box={workshop} face="east" width={2.2} height={3.2} offset={[0, -1.9]}><meshToonMaterial color="#3d5e5c" gradientMap={gradientMap} /></FaceDecal>
      {/* Water tower checker crown is a texture on the collider box (see OpenWorld). */}
      <Text font={font} position={visual([tower.position[0], tower.position[1] - 2.53, 9])} fontSize={1.05} color="#fff4df" anchorX="center" outlineWidth={0.03} outlineColor="#3a2e3f">ASTER</Text>
      {/* Solar shed panels. */}
      <FaceDecal box={shed} face="top" width={13} height={6} ><meshToonMaterial map={solar} gradientMap={gradientMap} color="#ffffff" /></FaceDecal>
      {/* Kestrel Lookout: lit cabin band, roof cap and a blinking obstruction light. */}
      {(["north", "south", "east", "west"] as const).map((face) => (
        <FaceDecal key={face} box={cabin} face={face} width={7} height={1.6} offset={[0, 0.8]}>{lit}</FaceDecal>
      ))}
      <FaceDecal box={cabin} face="top" width={8} height={8}><meshToonMaterial color="#d8634d" gradientMap={gradientMap} /></FaceDecal>
      <FaceDecal box={deck} face="north" width={14} height={0.5} offset={[0, 0.5]}><meshBasicMaterial color="#f1d58a" /></FaceDecal>
      <FaceDecal box={deck} face="south" width={14} height={0.5} offset={[0, 0.5]}><meshBasicMaterial color="#f1d58a" /></FaceDecal>
      <mesh position={visual([cabin.position[0], cabin.position[1], cabin.position[2] + cabin.size[2] / 2 + 0.35])} userData={{ noInk: true }}>
        <sphereGeometry args={[0.35, 12, 8]} />
        <meshBasicMaterial ref={beacon} color="#ff5a4a" toneMapped={false} />
      </mesh>
    </group>
  );
}

/** Race-gate treatment for the Mica Yard frames: glowing inner lips, letter plates. */
function GateTrims() {
  const frames = ["a", "b", "c"].map((k) => ({
    k,
    left: byId(`yard-frame-${k}-left`), right: byId(`yard-frame-${k}-right`), top: byId(`yard-frame-${k}-top`),
  }));
  const glow = useMemo(() => new THREE.MeshBasicMaterial({ color: "#d5f595", toneMapped: false }), []);
  useEffect(() => () => glow.dispose(), [glow]);
  useFrame(() => { glow.color.set("#d5f595").multiplyScalar(1.4 + Math.sin(stylizedTime.value * 4) * 0.6); });
  return (
    <group name="gate-trims">
      {frames.map(({ k, left, right, top }) => {
        const inner = (o: Obstacle, side: 1 | -1) => visual([o.position[0] + side * (o.size[0] / 2 + 0.02), o.position[1], o.position[2]]);
        const h = left.size[2];
        return (
          <group key={k}>
            <mesh position={inner(left, 1)} rotation={[0, Math.PI / 2, 0]} userData={{ noInk: true }}><planeGeometry args={[0.35, h * 0.92]} /><primitive object={glow} attach="material" /></mesh>
            <mesh position={inner(right, -1)} rotation={[0, -Math.PI / 2, 0]} userData={{ noInk: true }}><planeGeometry args={[0.35, h * 0.92]} /><primitive object={glow} attach="material" /></mesh>
            <mesh position={visual([top.position[0], top.position[1], top.position[2] - top.size[2] / 2 - 0.02])} rotation={[Math.PI / 2, 0, 0]} userData={{ noInk: true }}><planeGeometry args={[top.size[0] - 1.4, 0.35]} /><primitive object={glow} attach="material" /></mesh>
            {[1, -1].map((side) => (
              <Text key={side} font={font} position={visual([top.position[0], top.position[1] + side * 0.62, top.position[2]])} rotation={[0, side > 0 ? Math.PI : 0, 0]} fontSize={0.55} color="#20213f" anchorX="center" anchorY="middle">{`GATE ${k.toUpperCase()}`}</Text>
            ))}
          </group>
        );
      })}
    </group>
  );
}

/** Runway piano keys, edge lines, and a sequenced "rabbit" lead-in toward the yard. */
function Runway() {
  const lights = useMemo(() => Array.from({ length: 14 }, (_, i) => 4 + i * 5.5), []);
  const rabbit = useRef<THREE.InstancedMesh>(null);
  const [lit, off] = useMemo(() => [new THREE.Color("#fff1c4").multiplyScalar(4), new THREE.Color("#5b6275")], []);
  useEffect(() => {
    const m = new THREE.Matrix4();
    lights.forEach((x, i) => [-1.7, 1.7].forEach((y, side) => rabbit.current?.setMatrixAt(i * 2 + side, m.makeTranslation(...visual([x, y, 0.06])))));
    if (rabbit.current) rabbit.current.instanceMatrix.needsUpdate = true;
  }, [lights]);
  useFrame(() => {
    const mesh = rabbit.current;
    if (!mesh) return;
    const head = (stylizedTime.value * 9) % (lights.length + 6);
    for (let i = 0; i < lights.length; i++) {
      const colour = Math.abs(head - i) < 0.9 ? lit : off;
      mesh.setColorAt(i * 2, colour);
      mesh.setColorAt(i * 2 + 1, colour);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });
  return (
    <group name="runway-markings">
      {[-1, 1].map((end) => [-6.6, -4.4, -2.2, 2.2, 4.4, 6.6].map((y) => (
        <mesh key={`${end}-${y}`} position={visual([end * 78, y, 0.03])} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[7, 1.1]} /><meshBasicMaterial color="#f1ead2" />
        </mesh>
      )))}
      {[-8.4, 8.4].map((y) => (
        <mesh key={y} position={visual([0, y, 0.028])} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[162, 0.28]} /><meshBasicMaterial color="#f1ead2" />
        </mesh>
      ))}
      <Text font={font} position={visual([-66, 0, 0.035])} rotation={[-Math.PI / 2, 0, -Math.PI / 2]} fontSize={5} color="#f1ead2" anchorX="center" anchorY="middle">09</Text>
      <Text font={font} position={visual([66, 0, 0.035])} rotation={[-Math.PI / 2, 0, Math.PI / 2]} fontSize={5} color="#f1ead2" anchorX="center" anchorY="middle">27</Text>
      <instancedMesh ref={rabbit} args={[undefined, undefined, lights.length * 2]} userData={{ noInk: true }} frustumCulled={false}>
        <boxGeometry args={[0.36, 0.06, 0.36]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

/** Aster Valley's non-colliding set dressing, route and ambient motion. */
export function ValleyDressing({ gradientMap }: { gradientMap: THREE.Texture }) {
  const { tier } = useSyncExternalStore(visualQuality.subscribe, qualitySnapshot);
  return (
    <group name="valley-dressing">
      {tier > 0 && <Meadow gradientMap={gradientMap} />}
      <Buildings gradientMap={gradientMap} />
      <GateTrims />
      <Runway />
      <RouteRibbon points={SKYLINE} />
      <WindGusts gusts={GUSTS} />
    </group>
  );
}
