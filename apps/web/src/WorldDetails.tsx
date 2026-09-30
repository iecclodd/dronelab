import type { Obstacle, V3 } from "../../../packages/contracts";
import { FREE_WORLD } from "../../../packages/contracts/free-world";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { Edges } from "@react-three/drei";
import { createAsphaltMap, createBrushedMetalMap } from "./world-materials";

const visual = ([x, y, z]: V3): [number, number, number] => [x, z, -y];

const containers = FREE_WORLD.obstacles.filter((obstacle) =>
  obstacle.id.startsWith("yard-container"),
);
const hangar = FREE_WORLD.obstacles.find(
  (obstacle) => obstacle.id === "home-hangar",
)!;
const runwayLightPositions = Array.from({ length: 12 }, (_, index) => {
  const x = -76 + index * 13.5;
  return [
    [x, -10.2, 0.18],
    [x, 10.2, 0.18],
  ] as V3[];
}).flat();

function ContainerFace({ obstacle, index }: { obstacle: Obstacle; index: number }) {
  const [x, y, z] = obstacle.position;
  const [width, depth, height] = obstacle.size;
  const face = y + depth / 2 + 0.012;
  const color = index % 2 ? "#cc9a4a" : "#387a7b";
  return (
    <group>
      <mesh position={visual([x, face, z])} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[width * 0.78, height * 0.8]} />
        <meshStandardMaterial color="#233d42" roughness={0.62} />
      </mesh>
      {[-0.25, -0.125, 0, 0.125, 0.25].map((offset) => (
        <mesh
          key={offset}
          position={visual([x, face + 0.008, z + height * offset])}
          rotation={[0, Math.PI, 0]}
        >
          <planeGeometry args={[width * 0.75, 0.06]} />
          <meshBasicMaterial color={color} transparent opacity={0.78} />
        </mesh>
       ))}
      <mesh position={visual([x, face + 0.01, z])} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[0.1, height * 0.74]} />
        <meshBasicMaterial color="#ecd7a0" transparent opacity={0.58} />
      </mesh>
    </group>
  );
}

function HangarFront() {
  const [x, y, z] = hangar.position;
  const [width, depth, height] = hangar.size;
  const face = y + depth / 2 + 0.014;
  return (
    <group>
      <mesh position={visual([x, face, z])} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[width * 0.86, height * 0.76]} />
        <meshStandardMaterial color="#344b4a" roughness={0.68} />
        <Edges color="#20213f" threshold={15} />
      </mesh>
      {[-width * 0.21, width * 0.21].map((offset) => (
        <mesh
          key={offset}
          position={visual([x + offset, face + 0.009, z - height * 0.05])}
          rotation={[0, Math.PI, 0]}
        >
          <planeGeometry args={[width * 0.34, height * 0.66]} />
          <meshStandardMaterial color="#5f756d" metalness={0.15} roughness={0.5} />
        </mesh>
      ))}
      {[-width * 0.29, 0, width * 0.29].map((offset) => (
        <mesh
          key={offset}
          position={visual([x + offset, face + 0.018, z + height * 0.2])}
          rotation={[0, Math.PI, 0]}
        >
          <planeGeometry args={[width * 0.14, height * 0.18]} />
          <meshBasicMaterial color="#78bdbc" transparent opacity={0.78} />
        </mesh>
      ))}
    </group>
  );
}

function GroundRoad({ position, length, angle, map }: { position: V3; length: number; angle: number; map: THREE.Texture }) {
  return (
    <mesh
      position={visual([position[0], position[1], 0.018])}
      rotation={[-Math.PI / 2, angle, 0]}
      receiveShadow
    >
      <planeGeometry args={[length, 4.2]} />
      <meshStandardMaterial map={map} color="#a39b76" transparent opacity={0.55} roughness={0.96} />
    </mesh>
  );
}

/**
 * Static surface-only polish for Aster Valley. Details either sit on a shared
 * collision box face or lie flush with the existing ground; runway lights are
 * tiny non-blocking fixtures. It adds fewer than 90 mesh submissions.
 */
export function WorldDetails() {
  const [roadMap, metalMap] = useMemo(() => [createAsphaltMap(), createBrushedMetalMap()], []);
  useEffect(() => () => { roadMap.dispose(); metalMap.dispose(); }, [roadMap, metalMap]);
  return (
    <group name="aster-valley-details">
      <GroundRoad position={[18, -21, 0]} length={60} angle={0.37} map={roadMap} />
      <GroundRoad position={[103, 29, 0]} length={78} angle={0.49} map={roadMap} />
      <HangarFront />
      {containers.map((obstacle, index) => (
        <ContainerFace key={obstacle.id} obstacle={obstacle} index={index} />
      ))}
      {runwayLightPositions.map((position, index) => (
        <mesh key={index} position={visual(position)}>
          <sphereGeometry args={[0.14, 8, 6]} />
          <meshStandardMaterial
            color="#e8c66f"
            emissive="#d59c42"
            emissiveIntensity={1.8}
            roughness={0.4}
          />
        </mesh>
      ))}
      {[-62, -38, -14, 10, 34, 58].map((x) => [-12.4, 12.4].map((y) => (
        <group key={`${x}-${y}`} position={visual([x, y, 0])}>
          <mesh position={[0, 0.72, 0]} castShadow><cylinderGeometry args={[0.05, 0.07, 1.45, 6]} /><meshStandardMaterial map={metalMap} color="#6d857f" metalness={0.7} roughness={0.42} /></mesh>
          <mesh position={[0, 1.47, 0]}><sphereGeometry args={[0.11, 8, 6]} /><meshStandardMaterial color="#dd8c45" emissive="#a94826" emissiveIntensity={1.2} /></mesh>
        </group>
      )))}
    </group>
  );
}
