import { useEffect, useMemo } from "react";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import type { Scenario, V3 } from "../../../packages/contracts";
import { FREE_WORLD } from "../../../packages/contracts/free-world";
import { WorldDetails } from "./WorldDetails";
import { createAsphaltMap, createCelGradientMap, createDryGrassMap } from "./world-materials";

const visual = ([x, y, z]: V3): [number, number, number] => [x, z, -y];
const visualSize = ([x, y, z]: V3): [number, number, number] => [x, z, y];

function obstacleColor(id: string): string {
  if (id.startsWith("forest")) return id.endsWith("crown") ? "#52795d" : "#594936";
  if (id.startsWith("canyon") || id.startsWith("viaduct")) return "#a85f43";
  if (id.startsWith("lookout")) return "#355b5d";
  if (id.startsWith("yard-frame")) return "#45aaa5";
  if (id.startsWith("yard-container")) return id.endsWith("b") ? "#d19443" : "#3d7777";
  if (id.startsWith("yard-crane")) return "#d9a849";
  return "#6f7465";
}

function MountainSilhouette({ position, scale, gradientMap }: { position: V3; scale: number; gradientMap: THREE.Texture }) {
  return (
    <mesh position={visual(position)} castShadow receiveShadow>
      <coneGeometry args={[scale * 0.56, scale, 7]} />
      <meshToonMaterial color="#52608a" gradientMap={gradientMap} />
    </mesh>
  );
}

/**
 * Aster Valley's renderer. Every reachable opaque object below comes directly
 * from the same `obstacles` array that sim-core turns into a Rapier box.
 */
export function OpenWorld({ scenario }: { scenario?: Scenario }) {
  const runwayDashes = useMemo(
    () => Array.from({ length: 18 }, (_, index) => -72 + index * 8),
    [],
  );
  const obstacles = scenario?.id === "free" ? scenario.obstacles : FREE_WORLD.obstacles;
  const [grassMap, asphaltMap, gradientMap] = useMemo(() => [createDryGrassMap(), createAsphaltMap(), createCelGradientMap()], []);
  useEffect(() => () => { grassMap.dispose(); asphaltMap.dispose(); gradientMap.dispose(); }, [grassMap, asphaltMap, gradientMap]);
  const ink = useMemo(() => {
    const vertices: number[] = [];
    for (const obstacle of obstacles.filter(o => /^(yard-frame|canyon|viaduct|lookout|home-hangar)/.test(o.id))) {
      const box = new THREE.BoxGeometry(...visualSize(obstacle.size));
      const edges = new THREE.EdgesGeometry(box);
      const origin = visual(obstacle.position);
      const points = edges.attributes.position;
      for (let i = 0; i < points.count; i++) vertices.push(points.getX(i) + origin[0], points.getY(i) + origin[1], points.getZ(i) + origin[2]);
      edges.dispose(); box.dispose();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    return geometry;
  }, [obstacles]);
  useEffect(() => () => ink.dispose(), [ink]);

  return (
    <>
      <color attach="background" args={["#77b7c8"]} />
      <fog attach="fog" args={["#9dd2dc", 105, 370]} />
      <hemisphereLight args={["#ffedbd", "#50477e", 1.25]} />
      <directionalLight
        position={[-115, 145, 80]}
        intensity={2.35}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-155}
        shadow-camera-right={155}
        shadow-camera-top={155}
        shadow-camera-bottom={-155}
        shadow-bias={-0.00035}
      />
      <directionalLight position={[92, 42, -105]} intensity={0.55} color="#8273bd" />
      {/* Flat faceted cloud silhouettes stay outside the playable boundary. */}
      {([[245, 67, -95], [220, 61, 130], [-235, 63, -65], [25, 72, -260]] as [number, number, number][]).map((position, i) => <group key={i} position={position} scale={[24, 9, 11]}>
        {[-1, 0, 1].map((x) => <mesh key={x} position={[x, x === 0 ? .4 : 0, 0]} scale={[1.25, x === 0 ? 1 : .6, .65]}>
          <sphereGeometry args={[1, 8, 6]} /><meshBasicMaterial color={i % 2 ? "#fff1cf" : "#e2efdf"} fog={false} />
        </mesh>)}
      </group>)}

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[FREE_WORLD.bounds * 2, FREE_WORLD.bounds * 2]} />
        <meshToonMaterial map={grassMap} gradientMap={gradientMap} color="#bed7d0" />
      </mesh>
      <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[166, 18]} />
        <meshToonMaterial map={asphaltMap} gradientMap={gradientMap} color="#c5ccde" />
      </mesh>
      {runwayDashes.map((x) => (
        <mesh key={x} position={[x, 0.024, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[3.8, 0.35]} />
          <meshBasicMaterial color="#e5d8a7" />
        </mesh>
      ))}
      <mesh position={[0, 0.026, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.1, 2.45, 40]} />
        <meshBasicMaterial color="#3fc2bd" transparent opacity={0.86} />
      </mesh>

      {obstacles.map((obstacle) => (
        <mesh
          key={obstacle.id}
          position={visual(obstacle.position)}
          castShadow
          receiveShadow
        >
          <boxGeometry args={visualSize(obstacle.size)} />
          <meshToonMaterial
            color={obstacleColor(obstacle.id)}
            gradientMap={gradientMap}
          />
        </mesh>
      ))}
      <lineSegments geometry={ink}><lineBasicMaterial color="#293642" transparent opacity={0.55} /></lineSegments>

      {FREE_WORLD.landmarks.map((landmark) => (
        <group key={landmark.id} position={visual(landmark.position)}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[2.2, 0.08, 8, 32]} />
            <meshBasicMaterial color={landmark.color} transparent opacity={0.76} />
          </mesh>
          <Text
            font={`${import.meta.env.BASE_URL}fonts/IBMPlexMono-Regular.woff`}
            position={[0, 3.2, 0]}
            fontSize={1.5}
            color="#fff1c8"
            anchorX="center"
            outlineWidth={0.035}
            outlineColor="#4f5546"
          >
            {landmark.name.toUpperCase()}
          </Text>
        </group>
      ))}

      {/* Decorative mountains stay beyond the 200 m flight boundary. */}
      <MountainSilhouette position={[255, 22, 42]} scale={88} gradientMap={gradientMap} />
      <MountainSilhouette position={[238, -82, 32]} scale={70} gradientMap={gradientMap} />
      <MountainSilhouette position={[-242, 84, 38]} scale={80} gradientMap={gradientMap} />
      <MountainSilhouette position={[36, 255, 35]} scale={76} gradientMap={gradientMap} />
      <WorldDetails />
    </>
  );
}
