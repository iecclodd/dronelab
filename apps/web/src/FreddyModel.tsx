import { useMemo } from "react";
import * as THREE from "three";

const brown = "#87502f";
const tan = "#d99d68";
const black = "#17141a";

function Limb({ position, rotation = [0, 0, 0] as [number, number, number] }: { position: [number, number, number]; rotation?: [number, number, number] }) {
  return (
    <group position={position} rotation={rotation}>
      <mesh castShadow><sphereGeometry args={[0.34, 16, 12]} /><meshStandardMaterial color={brown} roughness={0.72} /></mesh>
      <mesh position={[0, -0.58, 0]} castShadow><cylinderGeometry args={[0.28, 0.34, 0.9, 16]} /><meshStandardMaterial color={brown} roughness={0.72} /></mesh>
      <mesh position={[0, -1.1, 0.06]} castShadow><sphereGeometry args={[0.38, 16, 12]} /><meshStandardMaterial color={tan} roughness={0.76} /></mesh>
    </group>
  );
}

/** Original, low-poly stage bear assembled from primitives; no extracted game asset. */
export function FreddyModel() {
  const toothGeometry = useMemo(() => new THREE.ConeGeometry(0.11, 0.28, 4), []);
  return (
    <group position={[16.8, 0.45, 0]} rotation={[0, -Math.PI / 2, 0]}>
      <mesh position={[0, 1.78, 0]} castShadow><capsuleGeometry args={[0.69, 1.1, 8, 16]} /><meshStandardMaterial color={brown} roughness={0.72} /></mesh>
      <mesh position={[0, 1.58, 0.66]}><sphereGeometry args={[0.58, 16, 12]} /><meshStandardMaterial color={tan} roughness={0.8} /></mesh>
      <mesh position={[0, 3.55, 0]} castShadow><sphereGeometry args={[1.02, 20, 16]} /><meshStandardMaterial color={brown} roughness={0.68} /></mesh>
      <mesh position={[0, 3.32, 0.82]}><sphereGeometry args={[0.58, 16, 12]} /><meshStandardMaterial color={tan} roughness={0.8} /></mesh>
      <mesh position={[0, 3.47, 1.34]} castShadow><sphereGeometry args={[0.18, 16, 12]} /><meshStandardMaterial color={black} roughness={0.42} /></mesh>
      {[[-0.48, 4.42], [0.48, 4.42]].map(([x, y]) => <mesh key={`${x}`} position={[x, y, 0]} castShadow><sphereGeometry args={[0.38, 16, 12]} /><meshStandardMaterial color={brown} roughness={0.7} /></mesh>)}
      <mesh position={[0, 4.72, 0]} castShadow><cylinderGeometry args={[0.43, 0.43, 0.42, 16]} /><meshStandardMaterial color={black} roughness={0.45} /></mesh>
      <mesh position={[0, 4.51, 0]} castShadow><cylinderGeometry args={[0.68, 0.68, 0.08, 16]} /><meshStandardMaterial color={black} roughness={0.45} /></mesh>
      {[[-0.3, 0.65], [0.3, 0.65]].map(([x, z]) => <group key={`${x}`} position={[x, 3.8, z]}><mesh><sphereGeometry args={[0.27, 16, 12]} /><meshStandardMaterial color="#f3eaba" emissive="#887a3d" emissiveIntensity={0.3} /></mesh><mesh position={[0, 0, 0.21]}><sphereGeometry args={[0.1, 12, 10]} /><meshBasicMaterial color="#0a1115" /></mesh></group>)}
      <group position={[0, 3.02, 0.95]}>{[-0.28, 0, 0.28].map((x) => <mesh key={x} position={[x, 0, 0]} rotation={[Math.PI, 0, 0]} geometry={toothGeometry}><meshStandardMaterial color="#f5e8ce" /></mesh>)}</group>
      <group position={[0, 2.16, 0.72]} rotation={[0, 0, Math.PI / 2]}><mesh><coneGeometry args={[0.45, 0.86, 3]} /><meshStandardMaterial color="#101015" /></mesh><mesh rotation={[0, 0, Math.PI]}><coneGeometry args={[0.45, 0.86, 3]} /><meshStandardMaterial color="#101015" /></mesh></group>
      {[2.28, 1.9].map((y) => <mesh key={y} position={[0, y, 0.7]}><sphereGeometry args={[0.1, 12, 8]} /><meshStandardMaterial color="#d3b477" metalness={0.55} roughness={0.3} /></mesh>)}
      <Limb position={[-1.05, 2.48, 0]} rotation={[0.1, 0, -0.2]} /><Limb position={[1.05, 2.48, 0]} rotation={[-0.1, 0, 0.2]} />
      <group position={[-1.55, 1.85, 0.32]} rotation={[0, 0, -0.35]}><mesh><cylinderGeometry args={[0.08, 0.08, 1.05, 12]} /><meshStandardMaterial color="#aeb9bd" metalness={0.8} roughness={0.24} /></mesh><mesh position={[0, 0.56, 0]}><sphereGeometry args={[0.22, 16, 12]} /><meshStandardMaterial color="#4b5458" metalness={0.8} roughness={0.22} /></mesh></group>
      <Limb position={[-0.5, 1.18, 0]} rotation={[0.08, 0.08, 0]} /><Limb position={[0.5, 1.18, 0]} rotation={[-0.08, -0.08, 0]} />
    </group>
  );
}
