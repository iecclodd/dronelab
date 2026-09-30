import { useEffect, useMemo, useSyncExternalStore } from "react";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import type { Obstacle, Scenario, V3 } from "../../../packages/contracts";
import { FREE_WORLD } from "../../../packages/contracts/free-world";
import { meadowPatches } from "./cel-material";
import { qualitySnapshot, visualQuality } from "./toon-pipeline";
import { CelTree, ValleyDressing } from "./ValleyDressing";
import { VALLEY_HAZE, VALLEY_SUN, ValleySky } from "./ValleySky";
import { WorldDetails } from "./WorldDetails";
import { createAsphaltMap, createCelGradientMap, createCorrugatedMap, createDryGrassMap, createHazardMap, createStrataMap, createTowerMap } from "./world-materials";

const visual = ([x, y, z]: V3): [number, number, number] => [x, z, -y];
const visualSize = ([x, y, z]: V3): [number, number, number] => [x, z, y];

function obstacleColor(id: string): string {
  if (id.startsWith("canyon")) return "#c98468";
  if (id.startsWith("viaduct")) return "#b9a48e";
  if (id.startsWith("lookout")) return "#3f6b6c";
  if (id.startsWith("yard-frame")) return "#3fb0a8";
  if (id.startsWith("yard-container")) return id.endsWith("b") ? "#e0a04a" : id.includes("stack") ? "#d8674f" : "#3f8384";
  if (id.startsWith("yard-crane")) return "#ffffff";
  if (id === "home-hangar") return "#dcd3bf";
  if (id === "home-water-tower") return "#efe6d2";
  if (id === "home-workshop") return "#9fb6a4";
  if (id === "home-solar-shed") return "#c9b89c";
  return "#8a8f7e";
}

type Maps = { corrugated: THREE.Texture; hazard: THREE.Texture; strata: THREE.Texture; tower: THREE.Texture };

/** Picks a surface texture for a collider box, with repeats scaled to its size. */
function surfaceFor(obstacle: Obstacle, maps: Maps): THREE.Texture | undefined {
  const [sx, sy, sz] = obstacle.size;
  let base: THREE.Texture | undefined;
  let repeat: [number, number] = [1, 1];
  if (obstacle.id.startsWith("yard-container")) { base = maps.corrugated; repeat = [Math.max(sx, sy) / 1.6, 1]; }
  else if (obstacle.id.startsWith("yard-crane")) { base = maps.hazard; repeat = [Math.max(sx, sy, sz) / 3, 1]; }
  else if (obstacle.id === "home-water-tower") base = maps.tower;
  else if (obstacle.id.startsWith("canyon") || obstacle.id.startsWith("viaduct")) { base = maps.strata; repeat = [1, sz / 20]; }
  if (!base) return undefined;
  const map = base.clone();
  map.repeat.set(...repeat);
  map.needsUpdate = true;
  return map;
}

/**
 * Aster Valley's renderer. Every reachable opaque object below comes directly
 * from the same `obstacles` array that sim-core turns into a Rapier box;
 * trees are drawn as trunk + two-tier crown filling those same boxes.
 */
export function OpenWorld({ scenario }: { scenario?: Scenario }) {
  const runwayDashes = useMemo(
    () => Array.from({ length: 18 }, (_, index) => -72 + index * 8),
    [],
  );
  const obstacles = scenario?.id === "free" ? scenario.obstacles : FREE_WORLD.obstacles;
  const [grassMap, asphaltMap, gradientMap] = useMemo(() => [createDryGrassMap(), createAsphaltMap(), createCelGradientMap()], []);
  const maps = useMemo<Maps>(() => ({ corrugated: createCorrugatedMap(), hazard: createHazardMap(), strata: createStrataMap(), tower: createTowerMap() }), []);
  const surfaces = useMemo(() => new Map(obstacles.map((o) => [o.id, surfaceFor(o, maps)])), [obstacles, maps]);
  useEffect(() => () => { grassMap.dispose(); asphaltMap.dispose(); gradientMap.dispose(); }, [grassMap, asphaltMap, gradientMap]);
  useEffect(() => () => { Object.values(maps).forEach((m) => m.dispose()); }, [maps]);
  useEffect(() => () => surfaces.forEach((m) => m?.dispose()), [surfaces]);
  const { tier } = useSyncExternalStore(visualQuality.subscribe, qualitySnapshot);
  const shadowSize = tier > 0 ? 2048 : 1024;
  const trees = useMemo(() => {
    const pairs: { trunk: Obstacle; crown: Obstacle; index: number }[] = [];
    for (const o of obstacles) {
      const match = /^forest-(\d+)-trunk$/.exec(o.id);
      const crown = match && obstacles.find((c) => c.id === `forest-${match[1]}-crown`);
      if (match && crown) pairs.push({ trunk: o, crown, index: Number(match[1]) });
    }
    return pairs;
  }, [obstacles]);

  return (
    <>
      <color attach="background" args={[VALLEY_HAZE]} />
      <fog attach="fog" args={[VALLEY_HAZE, 130, 520]} />
      <hemisphereLight args={["#fff0cf", "#5d5096", 1.15]} />
      <directionalLight
        key={shadowSize}
        position={VALLEY_SUN.toArray()}
        intensity={2.6}
        color="#fff1d6"
        castShadow
        shadow-mapSize={[shadowSize, shadowSize]}
        shadow-camera-left={-190}
        shadow-camera-right={190}
        shadow-camera-top={190}
        shadow-camera-bottom={-190}
        shadow-camera-far={500}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
      />
      <directionalLight position={[110, 36, -120]} intensity={0.5} color="#8d7fd0" />
      <ValleySky gradientMap={gradientMap} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[FREE_WORLD.bounds * 2 + 700, FREE_WORLD.bounds * 2 + 700]} />
        <meshToonMaterial map={grassMap} gradientMap={gradientMap} color="#c6ddcc" onBeforeCompile={meadowPatches} customProgramCacheKey={() => "meadow"} />
      </mesh>
      <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[166, 18]} />
        <meshToonMaterial map={asphaltMap} gradientMap={gradientMap} color="#bcc3d8" />
      </mesh>
      {runwayDashes.map((x) => (
        <mesh key={x} position={[x, 0.024, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[3.8, 0.35]} />
          <meshBasicMaterial color="#f1ead2" />
        </mesh>
      ))}
      <mesh position={[0, 0.026, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.1, 2.45, 40]} />
        <meshBasicMaterial color="#3fc2bd" transparent opacity={0.86} />
      </mesh>

      {obstacles.filter((o) => !o.id.startsWith("forest-")).map((obstacle) => (
        <mesh
          key={obstacle.id}
          position={visual(obstacle.position)}
          castShadow
          receiveShadow
        >
          <boxGeometry args={visualSize(obstacle.size)} />
          <meshToonMaterial
            color={obstacleColor(obstacle.id)}
            map={surfaces.get(obstacle.id)}
            gradientMap={gradientMap}
          />
        </mesh>
      ))}
      {trees.map(({ trunk, crown, index }) => <CelTree key={trunk.id} trunk={trunk} crown={crown} index={index} gradientMap={gradientMap} />)}

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
            outlineWidth={0.05}
            outlineColor="#3b2f4a"
          >
            {landmark.name.toUpperCase()}
          </Text>
        </group>
      ))}

      <WorldDetails />
      <ValleyDressing gradientMap={gradientMap} />
    </>
  );
}
