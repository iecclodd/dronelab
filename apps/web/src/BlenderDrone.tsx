import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { MutableRefObject } from "react";
import type { PhysicalState } from "../../../packages/contracts";
import { applyRimToToon } from "./cel-material";

const modelUrl = `${import.meta.env.BASE_URL}models/neon-quad.glb`;
const basis = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
const basisInverse = basis.clone().invert();
const gradient = new THREE.DataTexture(new Uint8Array([
  18, 18, 18, 255, 76, 76, 76, 255, 178, 178, 178, 255, 255, 255, 255, 255,
]), 4, 1, THREE.RGBAFormat);
gradient.needsUpdate = true;
gradient.minFilter = THREE.NearestFilter;
gradient.magFilter = THREE.NearestFilter;

export interface BlenderDroneProps {
  state: MutableRefObject<PhysicalState | undefined>;
  ghost?: boolean;
  hidden?: boolean;
}

/** GLB-backed display drone. The physics state remains owned by FlightScene. */
export function BlenderDrone({ state, ghost = false, hidden = false }: BlenderDroneProps) {
  const { scene } = useGLTF(modelUrl);
  const group = useRef<THREE.Group>(null);
  const point = useMemo(() => new THREE.Vector3(), []);
  const rotation = useMemo(() => new THREE.Quaternion(), []);
  const { model, rotors, toonMaterials } = useMemo(() => {
    const clone = scene.clone(true);
    const rotorGroups: THREE.Object3D[] = [];
    const materials: THREE.MeshToonMaterial[] = [];
    clone.traverse((child) => {
      if (child.name.match(/^rotor_[0-3]$/)) rotorGroups.push(child);
      if (!(child instanceof THREE.Mesh)) return;
      const original = Array.isArray(child.material) ? child.material[0] : child.material;
      const color = original?.color?.clone() ?? new THREE.Color("#ffffff");
      const toon = new THREE.MeshToonMaterial({
        color: ghost ? new THREE.Color("#4bebdf") : color,
        gradientMap: gradient,
        transparent: ghost,
        opacity: ghost ? 0.38 : 1,
        depthWrite: !ghost,
      });
      if (!ghost) applyRimToToon(toon);
      materials.push(toon);
      child.material = toon;
      child.castShadow = !ghost;
      child.receiveShadow = !ghost;
    });
    return { model: clone, rotors: rotorGroups, toonMaterials: materials };
  }, [scene, ghost]);

  useEffect(() => () => toonMaterials.forEach((material) => material.dispose()), [toonMaterials]);

  useFrame((_, dt) => {
    const current = state.current;
    if (!current || !group.current) return;
    point.set(current.position[0], current.position[2], -current.position[1]);
    group.current.position.lerp(point, Math.min(1, dt * 28));
    rotation.set(...current.quaternion);
    rotation.premultiply(basis).multiply(basisInverse);
    group.current.quaternion.slerp(rotation, Math.min(1, dt * 28));
    for (let index = 0; index < rotors.length; index += 1) {
      const rotor = rotors[index];
      if (rotor) rotor.rotation.y += dt * (current.motors[index] ?? 0.3) * 75;
    }
  });

  return <group ref={group} name={ghost ? "ghost" : "drone"} visible={!hidden}><primitive object={model} /></group>;
}

useGLTF.preload(modelUrl);
