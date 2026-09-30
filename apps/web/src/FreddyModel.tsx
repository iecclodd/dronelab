import { useMemo } from "react";
import * as THREE from "three";

type Vec3 = [number, number, number];
type Materials = Record<string, THREE.Material>;

/** An original, primitive-built stage animatronic; it contains no extracted game asset. */
export function FreddyModel() {
  const materials = useMemo<Materials>(() => {
    // Tiny deterministic textile speckles keep the brown shell from reading as smooth plastic.
    const pixels = new Uint8Array(8 * 8 * 3);
    for (let i = 0; i < 64; i += 1) {
      const shade = 92 + ((i * 37 + Math.floor(i / 8) * 19) % 42);
      pixels.set([shade + 24, shade - 3, shade - 24], i * 3);
    }
    const fabricMap = new THREE.DataTexture(pixels, 8, 8, THREE.RGBFormat);
    fabricMap.colorSpace = THREE.SRGBColorSpace;
    fabricMap.wrapS = fabricMap.wrapT = THREE.RepeatWrapping;
    fabricMap.repeat.set(3, 3);
    fabricMap.needsUpdate = true;
    return {
      fur: new THREE.MeshStandardMaterial({ color: "#8b542f", map: fabricMap, roughness: 0.86 }),
      tan: new THREE.MeshStandardMaterial({ color: "#d19a68", roughness: 0.92 }),
      dark: new THREE.MeshStandardMaterial({ color: "#151419", roughness: 0.42 }),
      cavity: new THREE.MeshStandardMaterial({ color: "#110d0d", roughness: 0.98 }),
      metal: new THREE.MeshStandardMaterial({ color: "#9da8aa", metalness: 0.88, roughness: 0.25 }),
      brass: new THREE.MeshStandardMaterial({ color: "#b89754", metalness: 0.72, roughness: 0.3 }),
      tooth: new THREE.MeshStandardMaterial({ color: "#eee2c3", roughness: 0.58 }),
      blue: new THREE.MeshStandardMaterial({ color: "#4f9dd3", emissive: "#153149", emissiveIntensity: 0.3, roughness: 0.32 }),
      pupil: new THREE.MeshBasicMaterial({ color: "#080b0d" }),
    };
  }, []);
  const teeth = [-0.33, 0, 0.33];
  return <group position={[16.8, 0.45, 0]} rotation={[0, -Math.PI / 2, 0]}>
    <mesh position={[0, 1.88, 0]} castShadow material={materials.fur}><capsuleGeometry args={[0.73, 1.05, 8, 16]} /></mesh>
    <mesh position={[0, 1.63, 0.68]} material={materials.tan}><sphereGeometry args={[0.53, 16, 12]} /></mesh>
    <mesh position={[0, 2.71, 0]} rotation={[Math.PI / 2, 0, 0]} material={materials.metal}><cylinderGeometry args={[0.31, 0.31, 0.15, 16]} /></mesh>
    <mesh position={[0, 2.71, 0.08]} rotation={[Math.PI / 2, 0, 0]} material={materials.dark}><torusGeometry args={[0.31, 0.06, 8, 16]} /></mesh>

    <mesh position={[0, 3.65, 0]} castShadow material={materials.fur}><sphereGeometry args={[1.0, 20, 16]} /></mesh>
    {([-0.63, 0.63] as number[]).map((x) => <group key={`ear-${x}`} position={[x, 4.37, -0.02]}>
      <mesh castShadow material={materials.fur}><sphereGeometry args={[0.39, 16, 12]} /></mesh>
      <mesh position={[0, 0, 0.29]} material={materials.tan}><sphereGeometry args={[0.22, 14, 10]} /></mesh>
      <mesh position={[0, 0, 0.38]} rotation={[0, 0, Math.PI / 2]} material={materials.dark}><torusGeometry args={[0.24, 0.035, 6, 12]} /></mesh>
    </group>)}
    <mesh position={[0, 4.75, 0]} castShadow material={materials.dark}><cylinderGeometry args={[0.43, 0.43, 0.44, 16]} /></mesh>
    <mesh position={[0, 4.53, 0]} material={materials.dark}><cylinderGeometry args={[0.68, 0.68, 0.09, 16]} /></mesh>
    <mesh position={[0, 4.61, 0]} material={materials.brass}><torusGeometry args={[0.435, 0.045, 8, 16]} /></mesh>

    {([-0.34, 0.34] as number[]).map((x) => <group key={`eye-${x}`} position={[x, 3.89, 0.79]}>
      <mesh position={[0, 0.22, 0.02]} rotation={[0, 0, x < 0 ? -0.14 : 0.14]} material={materials.dark}><capsuleGeometry args={[0.07, 0.34, 4, 10]} /></mesh>
      <mesh material={materials.tan}><sphereGeometry args={[0.255, 16, 12]} /></mesh>
      <mesh position={[0, 0, 0.205]} material={materials.blue}><sphereGeometry args={[0.135, 14, 10]} /></mesh>
      <mesh position={[0, 0, 0.31]} material={materials.pupil}><sphereGeometry args={[0.058, 12, 8]} /></mesh>
      <mesh position={[0, 0.12, 0.255]} scale={[1, 0.45, 0.28]} material={materials.fur}><sphereGeometry args={[0.27, 14, 10]} /></mesh>
    </group>)}
    <mesh position={[0, 3.3, 0.75]} scale={[1.08, 0.72, 0.67]} material={materials.tan}><sphereGeometry args={[0.62, 16, 12]} /></mesh>
    <mesh position={[0, 3.48, 1.17]} material={materials.dark}><sphereGeometry args={[0.18, 14, 10]} /></mesh>
    {([-0.42, -0.29, -0.16, 0.16, 0.29, 0.42] as number[]).map((x) => <mesh key={`freckle-${x}`} position={[x, 3.27, 1.18]} material={materials.dark}><sphereGeometry args={[0.045, 8, 6]} /></mesh>)}
    <mesh position={[0, 3.04, 1.1]} scale={[0.73, 0.31, 0.2]} material={materials.cavity}><sphereGeometry args={[0.58, 16, 10]} /></mesh>
    <mesh position={[0, 2.87, 0.93]} scale={[0.79, 0.35, 0.34]} castShadow material={materials.fur}><sphereGeometry args={[0.57, 16, 10]} /></mesh>
    <mesh position={[0, 2.88, 1.17]} scale={[0.63, 0.16, 0.16]} material={materials.cavity}><sphereGeometry args={[0.5, 14, 8]} /></mesh>
    {teeth.map((x) => <mesh key={`upper-${x}`} position={[x, 3.14, 1.2]} material={materials.tooth}><boxGeometry args={[0.17, 0.18, 0.1]} /></mesh>)}
    {teeth.map((x) => <mesh key={`lower-${x}`} position={[x, 2.96, 1.22]} material={materials.tooth}><boxGeometry args={[0.17, 0.13, 0.1]} /></mesh>)}
    {([-0.59, 0.59] as number[]).map((x) => <mesh key={`jaw-pivot-${x}`} position={[x, 3.0, 0.62]} rotation={[Math.PI / 2, 0, 0]} material={materials.metal}><cylinderGeometry args={[0.11, 0.11, 0.12, 12]} /></mesh>)}

    <BowTie material={materials.dark} />
    {[2.3, 1.91].map((y) => <mesh key={`button-${y}`} position={[0, y, 0.72]} material={materials.brass}><sphereGeometry args={[0.1, 12, 8]} /></mesh>)}
    <Arm position={[-1.08, 2.45, 0.02]} rotation={[0.05, 0.08, -0.2]} materials={materials} />
    <Arm position={[1.08, 2.45, 0.02]} rotation={[-0.05, -0.08, 0.2]} materials={materials} />
    <group position={[-1.59, 1.78, 0.39]} rotation={[0.08, 0, -0.32]}>
      <mesh material={materials.metal}><cylinderGeometry args={[0.075, 0.075, 1.15, 12]} /></mesh>
      <mesh position={[0, 0.61, 0]} material={materials.metal}><sphereGeometry args={[0.23, 16, 12]} /></mesh>
      {[-0.15, 0, 0.15].map((x) => <mesh key={x} position={[x, -0.29, 0.13]} rotation={[0, 0, x * -0.8]} material={materials.fur}><capsuleGeometry args={[0.08, 0.29, 4, 8]} /></mesh>)}
    </group>
    <Leg position={[-0.49, 1.13, 0]} rotation={[0.04, 0.04, 0]} materials={materials} />
    <Leg position={[0.49, 1.13, 0]} rotation={[-0.04, -0.04, 0]} materials={materials} />
  </group>;
}

function Arm({ position, rotation, materials }: { position: Vec3; rotation: Vec3; materials: Materials }) {
  return <group position={position} rotation={rotation}>
    <mesh material={materials.metal}><sphereGeometry args={[0.36, 16, 12]} /></mesh><mesh position={[0, -0.09, 0.02]} material={materials.dark}><torusGeometry args={[0.3, 0.06, 8, 14]} /></mesh>
    <mesh position={[0, -0.61, 0]} castShadow material={materials.fur}><cylinderGeometry args={[0.28, 0.34, 0.92, 16]} /></mesh><mesh position={[0, -1.1, 0.06]} material={materials.metal}><sphereGeometry args={[0.29, 14, 10]} /></mesh>
    <mesh position={[0, -1.2, 0.1]} material={materials.dark}><torusGeometry args={[0.29, 0.06, 8, 14]} /></mesh><mesh position={[0, -1.46, 0.16]} scale={[1.15, 0.75, 0.8]} material={materials.fur}><sphereGeometry args={[0.31, 14, 10]} /></mesh>
  </group>;
}

function Leg({ position, rotation, materials }: { position: Vec3; rotation: Vec3; materials: Materials }) {
  return <group position={position} rotation={rotation}>
    <mesh material={materials.metal}><sphereGeometry args={[0.31, 14, 10]} /></mesh><mesh position={[0, -0.42, 0]} castShadow material={materials.fur}><cylinderGeometry args={[0.32, 0.36, 0.65, 16]} /></mesh>
    <mesh position={[0, -0.8, 0.08]} material={materials.dark}><torusGeometry args={[0.28, 0.06, 8, 14]} /></mesh><mesh position={[0, -1.02, 0.22]} scale={[1.22, 0.58, 1.5]} castShadow material={materials.fur}><sphereGeometry args={[0.38, 14, 10]} /></mesh>
  </group>;
}

function BowTie({ material }: { material: THREE.Material }) {
  return <group position={[0, 2.58, 0.72]} rotation={[0, 0, Math.PI / 2]}><mesh position={[0.21, 0, 0]} material={material}><coneGeometry args={[0.42, 0.7, 3]} /></mesh><mesh position={[-0.21, 0, 0]} rotation={[0, 0, Math.PI]} material={material}><coneGeometry args={[0.42, 0.7, 3]} /></mesh><mesh material={material}><sphereGeometry args={[0.12, 10, 8]} /></mesh></group>;
}
