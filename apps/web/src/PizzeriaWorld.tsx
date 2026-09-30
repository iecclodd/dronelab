import { Edges, Text } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { Obstacle, Scenario, V3 } from "../../../packages/contracts/index.ts";
import { PIZZERIA_WORLD } from "../../../packages/contracts/pizzeria-world.ts";
import { FreddyModel } from "./FreddyModel.tsx";
import { PizzeriaDressing } from "./PizzeriaDressing";
import { createCelGradientMap, createWornCheckerMap } from "./world-materials";

const font = `${import.meta.env.BASE_URL}fonts/IBMPlexMono-Regular.woff`;
const enu = ([x, y, z]: V3): [number, number, number] => [x, z, -y];
const dimensions = ([x, y, z]: V3): [number, number, number] => [x, z, y];

function Solid({ id, position, size, gradientMap }: { id: string; position: V3; size: V3; gradientMap: THREE.Texture }) {
  const outerWall = id.startsWith("wall-");
  const office = id.startsWith("office-") || id.startsWith("backstage-");
  const arcade = id.startsWith("arcade-");
  const table = id.startsWith("table-");
  const stage = id.startsWith("stage-");
  return (
    <mesh position={enu(position)} castShadow receiveShadow>
      <boxGeometry args={dimensions(size)} />
      <meshToonMaterial
        color={
          outerWall ? "#34234d" : stage ? "#6d2540" : arcade ? "#192d4a" : table ? "#824331" : office ? "#2a3244" : "#664232"
        }
        gradientMap={gradientMap}
      />
    </mesh>
  );
}

function CheckerFloor({ gradientMap }: { gradientMap: THREE.Texture }) {
  const checker = useMemo(createWornCheckerMap, []);
  useEffect(() => () => checker.dispose(), [checker]);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} receiveShadow>
        <planeGeometry args={[44, 36]} />
        <meshToonMaterial map={checker} gradientMap={gradientMap} color="#f2dbb6" />
      </mesh>
    </group>
  );
}

function PartyHat({ position, color }: { position: [number, number, number]; color: string }) {
  return (
    <group position={position}>
      <mesh castShadow><coneGeometry args={[0.25, 0.68, 16]} /><meshStandardMaterial color={color} roughness={0.58} /></mesh>
      <mesh position={[0, 0.36, 0]}><sphereGeometry args={[0.09, 12, 8]} /><meshStandardMaterial color="#f9dd67" emissive="#b98934" emissiveIntensity={0.25} /></mesh>
    </group>
  );
}

function PartyTable({ position, palette }: { position: [number, number, number]; palette: string[] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.72, 0]} castShadow receiveShadow><boxGeometry args={[3.25, 0.12, 2.2]} /><meshStandardMaterial color="#e7dbbc" roughness={0.64} /></mesh>
      {[-1.25, 1.25].flatMap((x) => [-0.75, 0.75].map((z) => <mesh key={`${x}${z}`} position={[x, 0.36, z]} castShadow><cylinderGeometry args={[0.11, 0.11, 0.72, 10]} /><meshStandardMaterial color="#332c39" metalness={0.25} /></mesh>))}
      {palette.map((color, i) => <PartyHat key={color} position={[(i - 1) * 0.75, 1.13, i === 1 ? -0.25 : 0.25]} color={color} />)}
    </group>
  );
}

function ArcadeFaces() {
  return (
    <group>
      {[[-1, "#35d5e5"], [1.2, "#f15b92"], [3.4, "#ffd35c"], [5.6, "#7fe690"]].map(([x, glow]) => (
        <group key={String(x)} position={[Number(x), 1.5, -14.28]}>
          <mesh position={[0, 0.22, 0]}><planeGeometry args={[0.7, 1.15]} /><meshStandardMaterial color="#18243b" emissive={String(glow)} emissiveIntensity={0.65} /></mesh>
          <mesh position={[0, -0.58, 0.03]}><planeGeometry args={[0.82, 0.22]} /><meshBasicMaterial color={String(glow)} /></mesh>
          <Text font={font} position={[0, 0.24, 0.05]} fontSize={0.18} color="#f6f5db" anchorX="center">PLAY</Text>
        </group>
      ))}
    </group>
  );
}

function WallBands() {
  return (
    <group>
      {[-17.72, 17.72].map((z) => <mesh key={z} position={[0, 2.2, z]}><boxGeometry args={[43.2, 0.58, 0.08]} /><meshStandardMaterial color="#a62f54" emissive="#5c142d" emissiveIntensity={0.14} /></mesh>)}
      {[-21.72, 21.72].map((x) => <mesh key={x} position={[x, 2.2, 0]} rotation={[0, Math.PI / 2, 0]}><boxGeometry args={[35.2, 0.58, 0.08]} /><meshStandardMaterial color="#a62f54" emissive="#5c142d" emissiveIntensity={0.14} /></mesh>)}
      {Array.from({ length: 11 }, (_, i) => <group key={i} position={[i * 3.7 - 18.5, 4.5, -17.45]}><mesh rotation={[0, 0, Math.PI]}><coneGeometry args={[0.56, 0.95, 3]} /><meshStandardMaterial color={i % 2 ? "#e9b54d" : "#d74d6a"} /></mesh><mesh position={[0, 0.7, 0]}><sphereGeometry args={[0.07, 8, 8]} /><meshBasicMaterial color="#ffe6a2" /></mesh></group>)}
    </group>
  );
}

function Ceiling() {
  return (
    <group>
      <mesh position={[0, 6, 0]} receiveShadow><boxGeometry args={[44, 0.1, 36]} /><meshStandardMaterial color="#15192a" roughness={0.9} /></mesh>
      {[-13, -5, 3, 11].flatMap((x) => [-10, 0, 10].map((z) => <mesh key={`${x}-${z}`} position={[x, 5.82, z]}><boxGeometry args={[2.8, 0.08, 0.62]} /><meshStandardMaterial color="#e7d8a7" emissive="#ffdb80" emissiveIntensity={1.8} toneMapped={false} /></mesh>))}
    </group>
  );
}

function Stage() {
  return (
    <group>
      <mesh position={[20.25, 3.2, 0]}><boxGeometry args={[0.08, 4.9, 11.8]} /><meshToonMaterial color="#36224f" /><Edges color="#120f2a" threshold={15} /></mesh>
      {/* Fabric curtains sit against the collidable stage backdrop and platform. */}
      {[-4.9, 4.9].map((z) => <group key={z} position={[18.4, 3.1, z]}>
        <mesh><boxGeometry args={[4.1, 4.6, 0.48]} /><meshStandardMaterial color="#6e183a" roughness={0.92} /></mesh>
        {[-1.35, -0.45, 0.45, 1.35].map((fold) => <mesh key={fold} position={[0.01, 0, fold]}><boxGeometry args={[0.06, 4.45, 0.12]} /><meshStandardMaterial color="#a62d52" roughness={0.82} /></mesh>)}
      </group>)}
      <Text font={font} position={[13.18, 4.92, 0]} rotation={[0, -Math.PI / 2, 0]} fontSize={0.42} color="#f9d567" anchorX="center">FREDDY FAZBEAR'S PIZZA</Text>
      <FreddyModel />
    </group>
  );
}

function ExitDoor() {
  return (
    <group position={[-21.68, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
      <mesh position={[0, 2.2, 0]}><planeGeometry args={[3.4, 4.4]} /><meshStandardMaterial color="#163b39" emissive="#174f46" emissiveIntensity={0.4} /></mesh>
      <mesh position={[0, 4.85, 0.02]}><boxGeometry args={[3.9, 0.64, 0.08]} /><meshStandardMaterial color="#d4e596" emissive="#a9e46c" emissiveIntensity={0.8} /></mesh>
      <Text font={font} position={[0, 4.85, 0.08]} fontSize={0.36} color="#194034" anchorX="center">EXIT / HOME</Text>
    </group>
  );
}

export function PizzeriaWorld({ scenario }: { scenario?: Scenario }) {
  const solids = (scenario?.obstacles ?? PIZZERIA_WORLD.obstacles).filter(
    ({ id }) => !id.startsWith("freddy-") && !id.startsWith("table-"),
  );
  const gradientMap = useMemo(createCelGradientMap, []);
  useEffect(() => () => gradientMap.dispose(), [gradientMap]);
  return (
    <>
      <color attach="background" args={["#090d1b"]} />
      <fog attach="fog" args={["#10142a", 18, 62]} />
      <ambientLight intensity={0.8} color="#aaa0c9" />
      <hemisphereLight args={["#8277a9", "#242039", 0.85]} />
      <directionalLight position={[-12, 15, 8]} intensity={1.2} color="#ffe2a4" castShadow shadow-mapSize={[1024, 1024]} shadow-camera-left={-28} shadow-camera-right={28} shadow-camera-top={25} shadow-camera-bottom={-25} shadow-bias={-0.0004} />
      <pointLight position={[12, 4.8, 0]} intensity={100} distance={22} decay={1.5} color="#ffd5a0" />
      <pointLight position={[1, 3.6, -13]} intensity={7} distance={13} decay={2} color="#55bfd4" />
      <pointLight position={[-12, 3.1, 6]} intensity={5} distance={11} decay={2} color="#7868c5" />
      <CheckerFloor gradientMap={gradientMap} />
      <Ceiling />
      {solids.map((solid: Obstacle) => <Solid key={solid.id} {...solid} gradientMap={gradientMap} />)}
      <WallBands />
      <Stage />
      <PartyTable position={[3, 0, -5.2]} palette={["#f66c86", "#ffcf62", "#62d9d4"]} />
      <PartyTable position={[9, 0, -5.2]} palette={["#8b7be7", "#ffcf62", "#ef6f95"]} />
      <PartyTable position={[3, 0, 5.2]} palette={["#6bd8a3", "#ffcf62", "#e96482"]} />
      <PartyTable position={[9, 0, 5.2]} palette={["#e96482", "#72cfe5", "#ffcf62"]} />
      <PartyTable position={[-5, 0, -5.2]} palette={["#a07de4", "#ffcf62", "#75dfad"]} />
      <ArcadeFaces />
      <ExitDoor />
      <PizzeriaDressing />
      <Text font={font} position={[-13, 4.7, -5.1]} rotation={[0, 0, 0]} fontSize={0.35} color="#bdb5ff" anchorX="center">SECURITY OFFICE</Text>
      <Text font={font} position={[14.5, 4.7, 10.7]} rotation={[0, Math.PI, 0]} fontSize={0.36} color="#e6a3c4" anchorX="center">BACKSTAGE</Text>
      <Text font={font} position={[-16.6, 0.04, 0]} rotation={[-Math.PI / 2, 0, Math.PI / 2]} fontSize={0.55} color="#7ce1b2" anchorX="center">HOME PAD</Text>
      {PIZZERIA_WORLD.landmarks.map((landmark: { id: string; position: V3; color: string }) => <mesh key={landmark.id} position={enu([landmark.position[0], landmark.position[1], Math.min(landmark.position[2] + 0.2, 5.65)])}><sphereGeometry args={[0.14, 12, 8]} /><meshStandardMaterial color={landmark.color} emissive={landmark.color} emissiveIntensity={2.5} toneMapped={false} /></mesh>)}
    </>
  );
}
