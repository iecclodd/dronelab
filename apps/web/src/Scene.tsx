import { Suspense, useRef, useMemo, useEffect, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Grid, Line, Text } from "@react-three/drei";
import * as THREE from "three";
import type { PhysicalState, Scenario, V3 } from "../../../packages/contracts";
import { OpenWorld } from "./OpenWorld";
import { PizzeriaWorld } from "./PizzeriaWorld";
import { BlenderDrone } from "./BlenderDrone";
import { levelFlightQuaternion, type FlightLook } from "./flight-controls";
import { LOOKS, ToonPipeline } from "./toon-pipeline";
import { LandmarkBeacons } from "./WorldFx";
import { CityCombatLayer, CombatLayer } from "./CombatLayer";
import { CityWorld } from "./CityWorld";
import { CITY_WORLD } from "../../../packages/contracts/city-world";
import { cameraShake } from "./combat-store";
import { presented, updatePresentation } from "./presentation";
import { updateVisibility } from "./visibility";
import { FREE_WORLD } from "../../../packages/contracts/free-world";
import { PIZZERIA_WORLD } from "../../../packages/contracts/pizzeria-world";
export type CameraMode = "Chase" | "FPV" | "Orbit";
export const visual = (v: V3): [number, number, number] => [v[0], v[2], -v[1]];
const basis = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(1, 0, 0),
  -Math.PI / 2,
);
const basisInverse = basis.clone().invert();
const yawAxis = new THREE.Vector3(0, 1, 0);
const pitchAxis = new THREE.Vector3(0, 0, 1);
function Drone({
  state,
  ghost = false,
  hidden = false,
}: {
  state: MutableRefObject<PhysicalState | undefined>;
  ghost?: boolean;
  hidden?: boolean;
}) {
  const ref = useRef<THREE.Group>(null);
  const rotors = useRef<THREE.Group[]>([]);
  const p = useMemo(() => new THREE.Vector3(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  useFrame((_, dt) => {
    const s = state.current;
    if (!s || !ref.current) return;
    p.set(...visual(s.position));
    ref.current.position.lerp(p, Math.min(1, dt * 28));
    q.set(...s.quaternion);
    q.premultiply(basis).multiply(basisInverse);
    ref.current.quaternion.slerp(q, Math.min(1, dt * 28));
    rotors.current.forEach((r, i) => {
      if (r) r.rotation.y += dt * (s.motors[i] ?? 0.3) * 75;
    });
  });
  return (
    <group ref={ref} name={ghost ? "ghost" : "drone"} visible={!hidden}>
      <mesh castShadow position={[-0.03, 0.01, 0]}>
        <boxGeometry args={[0.36, 0.11, 0.25]} />
        <meshStandardMaterial
          color={ghost ? "#4bebdf" : "#1d2425"}
          transparent={ghost}
          opacity={ghost ? 0.4 : 1}
          metalness={0.7}
          roughness={0.3}
        />
      </mesh>
      <mesh position={[-0.05, 0.105, 0]} castShadow>
        <boxGeometry args={[0.22, 0.035, 0.18]} />
        <meshStandardMaterial color="#303b3a" metalness={0.35} />
      </mesh>
      {[
        [-0.33, -0.33],
        [-0.33, 0.33],
        [0.33, -0.33],
        [0.33, 0.33],
      ].map(([x, z], i) => (
        <group key={i}>
          <mesh rotation={[0, x * z > 0 ? -Math.PI / 4 : Math.PI / 4, 0]} castShadow>
            <boxGeometry args={[0.88, 0.032, 0.04]} />
            <meshStandardMaterial color="#151b1d" metalness={0.72} roughness={0.24} />
          </mesh>
          <mesh position={[x, 0.035, z]} castShadow>
            <cylinderGeometry args={[0.06, 0.06, 0.1, 12]} />
            <meshStandardMaterial color="#252d2d" metalness={0.55} />
          </mesh>
          <group
            position={[x, 0.105, z]}
            ref={(el) => {
              if (el) rotors.current[i] = el;
            }}
          >
            {[0, (Math.PI * 2) / 3, (Math.PI * 4) / 3].map((rotation) => (
              <mesh key={rotation} rotation={[0, rotation, 0]} position={[0.115, 0, 0]}>
                <boxGeometry args={[0.27, 0.009, 0.055]} />
                <meshStandardMaterial
                  color={i % 2 ? "#f4aa36" : "#70e3d5"}
                  transparent
                  opacity={0.9}
                />
              </mesh>
            ))}
          </group>
          <mesh position={[x, -0.13, z]}>
            <boxGeometry args={[0.04, 0.17, 0.04]} />
            <meshStandardMaterial color="#24302f" />
          </mesh>
        </group>
      ))}
      <mesh position={[0.04, 0.135, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <boxGeometry args={[0.1, 0.045, 0.22]} />
        <meshStandardMaterial color="#ed9f3c" roughness={0.38} />
      </mesh>
      <mesh position={[0.21, 0.025, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.06, 0.06, 0.09, 16]} />
        <meshStandardMaterial
          color="#4ae4d4"
          emissive="#2aa896"
          emissiveIntensity={0.75}
        />
      </mesh>
      <mesh position={[0.255, 0.025, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.037, 0.037, 0.095, 16]} />
        <meshStandardMaterial color="#101719" metalness={0.5} />
      </mesh>
      <mesh position={[-0.2, 0.12, 0]} rotation={[0, 0, -Math.PI / 8]}>
        <cylinderGeometry args={[0.018, 0.018, 0.36, 8]} />
        <meshStandardMaterial color="#29302f" metalness={0.35} />
      </mesh>
    </group>
  );
}
function World({ scenario }: { scenario?: Scenario }) {
  const markings = useMemo(
    () => Array.from({ length: 13 }, (_, i) => i * 4 - 24),
    [],
  );
  return (
    <>
      <color attach="background" args={["#c0d6d8"]} />
      <fog attach="fog" args={["#c0d6d8", 48, 160]} />
      <hemisphereLight args={["#fff7de", "#7c8b89", 2.2]} />
      <directionalLight
        position={[-15, 35, 18]}
        intensity={3.4}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-36}
        shadow-camera-right={36}
        shadow-camera-top={36}
        shadow-camera-bottom={-36}
        shadow-bias={-0.0002}
      />
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        position={[0, -0.03, 0]}
      >
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color="#7f9290" roughness={1} />
      </mesh>
      <mesh
        receiveShadow
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.015, 0]}
      >
        <planeGeometry args={[52, 60]} />
        <meshStandardMaterial color="#afb8ab" roughness={0.95} />
      </mesh>
      <Grid
        args={[52, 60]}
        position={[0, 0.006, 0]}
        cellColor="#92a496"
        sectionColor="#7d9589"
        cellSize={2}
        sectionSize={10}
        cellThickness={0.6}
        sectionThickness={0.9}
        fadeDistance={100}
        infiniteGrid={false}
      />
      {markings.map((n, i) => (
        <group key={n}>
          <mesh position={[-25, 0.008, n]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.2, 1.8]} />
            <meshBasicMaterial color="#e6ce81" />
          </mesh>
          <mesh position={[25, 0.008, n]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.2, 1.8]} />
            <meshBasicMaterial color="#e6ce81" />
          </mesh>
          {i % 2 === 0 && (
            <Text
              font={`${import.meta.env.BASE_URL}fonts/IBMPlexMono-Regular.woff`}
              position={[-23, 0.025, n]}
              rotation={[-Math.PI / 2, 0, Math.PI / 2]}
              fontSize={0.7}
              color="#5c746e"
            >
              {String(i * 4).padStart(2, "0")}
            </Text>
          )}
        </group>
      ))}
      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh position={[side * 33, 3, 0]} castShadow receiveShadow>
            <boxGeometry args={[11, 6, 32]} />
            <meshStandardMaterial
              color={side === 1 ? "#73877f" : "#d5d9cd"}
              roughness={0.85}
            />
          </mesh>
          <mesh position={[side * 33, 6.1, 0]}>
            <boxGeometry args={[12, 0.2, 33]} />
            <meshStandardMaterial color="#677974" />
          </mesh>
          {Array.from({ length: 9 }, (_, i) => (
            <mesh key={i} position={[side * 27.45, 2.8, i * 3.4 - 13.5]}>
              <boxGeometry args={[0.15, 3.8, 2.3]} />
              <meshStandardMaterial
                color="#425854"
                metalness={0.4}
                roughness={0.5}
              />
            </mesh>
          ))}
          <Text
            font={`${import.meta.env.BASE_URL}fonts/IBMPlexMono-Regular.woff`}
            position={[side * 27.3, 5.1, -7]}
            rotation={[0, side < 0 ? Math.PI / 2 : -Math.PI / 2, 0]}
            fontSize={0.8}
            color="#e7eae0"
          >
            {side < 0 ? "DRONELAB / 01" : "FLIGHT RESEARCH"}
          </Text>
        </group>
      ))}
      {[-22, 22].flatMap((x) =>
        [-25, 0, 25].map((z) => (
          <group key={`${x}${z}`}>
            <mesh position={[x, 4, z]} castShadow>
              <cylinderGeometry args={[0.06, 0.09, 8, 8]} />
              <meshStandardMaterial color="#526b63" />
            </mesh>
            <mesh position={[x, 8, z]}>
              <boxGeometry args={[1.5, 0.13, 0.5]} />
              <meshStandardMaterial
                color="#e9e9d3"
                emissive="#fff6cf"
                emissiveIntensity={0.2}
              />
            </mesh>
          </group>
        )),
      )}
      <Text
        font={`${import.meta.env.BASE_URL}fonts/IBMPlexMono-Regular.woff`}
        position={[0, 0.03, 19]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={1.65}
        color="#d8ddc5"
        letterSpacing={0.22}
      >
        DRONELAB
      </Text>
      {scenario?.obstacles.map((o) => (
        <mesh key={o.id} position={visual(o.position)} castShadow receiveShadow>
          <boxGeometry args={visual([o.size[0], -o.size[1], o.size[2]])} />
          <meshStandardMaterial
            color={o.kind === "gate" ? "#dca747" : "#7a9690"}
            roughness={0.7}
          />
        </mesh>
      ))}
      {scenario?.targets.map((t, i) => (
        <group key={i} position={visual(t)}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <torusGeometry
              args={[scenario.id === "gates" ? 1.3 : 0.65, 0.035, 8, 48]}
            />
            <meshBasicMaterial color="#23d6c4" transparent opacity={0.7} />
          </mesh>
          <Text
            font={`${import.meta.env.BASE_URL}fonts/IBMPlexMono-Regular.woff`}
            position={[0, 1.4, 0]}
            fontSize={0.25}
            color="#f1ffe9"
            outlineWidth={0.005}
            outlineColor="#305d52"
          >
            {scenario.id === "gates"
              ? `GATE ${String(i + 1).padStart(2, "0")}`
              : scenario.id === "landing"
                ? "LANDING TARGET"
                : "HOVER TARGET"}
          </Text>
        </group>
      ))}
      <group
        position={
          scenario
            ? visual([scenario.pad[0], scenario.pad[1], 0.02])
            : [0, 0.02, 0]
        }
      >
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <circleGeometry args={[1.45, 48]} />
          <meshStandardMaterial color="#2f5955" />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, 0]}>
          <ringGeometry args={[1.25, 1.34, 48]} />
          <meshBasicMaterial color="#edbf68" side={THREE.DoubleSide} />
        </mesh>
        <Text
          font={`${import.meta.env.BASE_URL}fonts/IBMPlexMono-Regular.woff`}
          position={[0, 0.015, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          fontSize={1.4}
          color="#e6d3a1"
        >
          H
        </Text>
      </group>
    </>
  );
}
/** Sparse world-space motes make translation readable without obscuring the line. */
function VelocityTrails({ state, enabled }: { state: MutableRefObject<PhysicalState | undefined>; enabled: boolean }) {
  const material = useRef<THREE.LineBasicMaterial>(null);
  const field = useMemo(() => {
    const count = 64;
    const positions = new Float32Array(count * 6);
    const anchors = new Float32Array(count * 3);
    for (let i = 0; i < anchors.length; i++) anchors[i] = ((i * 0.61803398875) % 1 - .5) * 32;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    return { positions, anchors, geometry };
  }, []);
  useEffect(() => () => field.geometry.dispose(), [field]);
  useFrame(() => {
    const s = state.current;
    if (!s || !material.current) return;
    const speed = Math.hypot(...s.velocity);
    material.current.opacity = enabled ? THREE.MathUtils.clamp((speed - 8) / 70, 0, .22) : 0;
    if (!enabled || speed < 8) return;
    const center = visual(s.position);
    const direction = visual(s.velocity);
    const length = .12 + speed * .026;
    for (let i = 0; i < 64; i++) {
      for (let axis = 0; axis < 3; axis++) {
        const index = i * 3 + axis;
        const local = ((field.anchors[index] - center[axis] + 16) % 32 + 32) % 32 - 16;
        const point = center[axis] + local;
        field.positions[i * 6 + axis] = point;
        field.positions[i * 6 + axis + 3] = point - direction[axis] / speed * length;
      }
    }
    field.geometry.attributes.position.needsUpdate = true;
  });
  return <lineSegments geometry={field.geometry} frustumCulled={false} renderOrder={1}>
    <lineBasicMaterial ref={material} color="#fff7cd" transparent opacity={0} depthWrite={false} />
  </lineSegments>;
}
/** Updates the smoothed pose once per frame, before cameras and models read it. */
function PresentationClock({ state }: { state: MutableRefObject<PhysicalState | undefined> }) {
  useFrame((_, dt) => updatePresentation(state.current, performance.now(), dt), -1);
  // Visibility culling runs after the camera rig (priority 0), before rendering (1).
  useFrame(({ camera }) => updateVisibility(camera, performance.now() / 1000), 0.5);
  return null;
}
function Rig({
  state,
  cameraMode,
  lookRef,
  fov,
  cameraTilt,
  effectsEnabled,
  stabilizeView,
  onFps,
  onCapture,
  cameraBlockers = [],
}: {
  cameraBlockers?: THREE.Box3[];
  state: MutableRefObject<PhysicalState | undefined>;
  cameraMode: CameraMode;
  lookRef: MutableRefObject<FlightLook>;
  fov: number;
  cameraTilt: number;
  effectsEnabled: boolean;
  stabilizeView: boolean;
  onFps: (fps: number) => void;
  onCapture: (
    fn: (() => { step: number; dataUrl: string }) | undefined,
  ) => void;
}) {
  const { camera, gl, scene } = useThree();
  const goal = useMemo(() => new THREE.Vector3(), []);
  const look = useMemo(() => new THREE.Vector3(), []);
  const forward = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(), []);
  const body = useMemo(() => new THREE.Quaternion(), []);
  const yaw = useMemo(() => new THREE.Quaternion(), []);
  const pitch = useMemo(() => new THREE.Quaternion(), []);
  const tracker = useRef({ frames: 0, start: performance.now() });
  const probe = useMemo(() => new THREE.Vector3(), []);
  const probeHit = useMemo(() => new THREE.Vector3(), []);
  const probeRay = useMemo(() => new THREE.Ray(), []);
  const step = useRef(0);
  const impulse = useRef({ collisions: 0, time: -1, hitAt: -10 });
  useEffect(() => {
    onCapture(() => {
      const s = state.current;
      if (!s) throw new Error("capability_unavailable");
      const drone = scene.getObjectByName("drone");
      if (drone) {
        drone.position.set(...visual(s.position));
        drone.quaternion
          .set(...s.quaternion)
          .premultiply(basis)
          .multiply(basisInverse);
      }
      gl.render(scene, camera);
      const c = camera as THREE.PerspectiveCamera;
      return {
        step: s.step,
        simulationTime: s.time,
        capturedAt: Date.now(),
        camera: {
          frame: "Three: x east, y up, z south",
          position: camera.position.toArray(),
          quaternion: camera.quaternion.toArray(),
          fovDegrees: c.fov,
          near: c.near,
          far: c.far,
          width: gl.domElement.width,
          height: gl.domElement.height,
        },
        dataUrl: gl.domElement.toDataURL("image/png"),
      };
    });
    return () => onCapture(undefined);
  }, [onCapture, gl, scene, camera]);
  useEffect(() => {
    const perspective = camera as THREE.PerspectiveCamera;
    const nextFov = cameraMode === "FPV" ? fov : 57;
    if (perspective.fov !== nextFov) {
      perspective.fov = nextFov;
      perspective.updateProjectionMatrix();
    }
  }, [camera, cameraMode, fov]);
  useFrame((_, dt) => {
    const s = state.current;
    if (s) {
      const fx = impulse.current;
      if (s.time < fx.time) { fx.collisions = 0; fx.hitAt = -10; }
      if (s.collisions > fx.collisions && s.time - fx.hitAt > .75) fx.hitAt = s.time;
      fx.collisions = s.collisions;
      fx.time = s.time;
      const speed = Math.hypot(...s.velocity);
      const c = camera as THREE.PerspectiveCamera;
      const targetFov = cameraMode === "FPV" ? Math.min(120, fov + (effectsEnabled ? Math.min(16, speed * .55) : 0)) : 57;
      const nextFov = THREE.MathUtils.lerp(c.fov, targetFov, 1 - Math.exp(-dt * 7));
      if (Math.abs(c.fov - nextFov) > .005) { c.fov = nextFov; c.updateProjectionMatrix(); }
      step.current = s.step;
      if (cameraMode !== "Orbit") {
        // Smoothed pose: the worker publishes ~30 Hz; rendering raw states
        // makes the camera step at arcade speeds.
        if (presented.valid) look.copy(presented.position); else look.set(...visual(s.position));
        const flightLook = lookRef.current;
        // Arcade: the camera owns an absolute heading (mouse/QE only), so its
        // rotation never inherits the drone's stepped heading.
        const worldYaw = stabilizeView ? flightLook.world : undefined;
        const setHeading = () => {
          if (worldYaw !== undefined) { body.set(0, 0, Math.sin(worldYaw / 2), Math.cos(worldYaw / 2)).premultiply(basis).multiply(basisInverse); yaw.identity(); }
          else if (stabilizeView) { body.set(...levelFlightQuaternion(s.quaternion)).premultiply(basis).multiply(basisInverse); yaw.setFromAxisAngle(yawAxis, flightLook.yaw); }
          else { if (presented.valid) body.copy(presented.quaternion); else body.set(...s.quaternion).premultiply(basis).multiply(basisInverse); yaw.setFromAxisAngle(yawAxis, flightLook.yaw); }
        };
        if (cameraMode === "Chase" && stabilizeView) {
          // Arcade third-person action camera: orbits with the aim, so the
          // camera-relative controls always match the view.
          setHeading();
          pitch.setFromAxisAngle(pitchAxis, flightLook.pitch);
          body.multiply(yaw).multiply(pitch);
          forward.set(1, 0, 0).applyQuaternion(body);
          goal.copy(look).addScaledVector(forward, -6.2);
          goal.y += 1.5;
          // Camera collision: pull in in front of any wall between drone and camera.
          if (cameraBlockers.length) {
            probe.subVectors(goal, look);
            const reach = probe.length();
            probeRay.set(look, probe.divideScalar(reach));
            let nearest = reach;
            for (const box of cameraBlockers) {
              if (box.containsPoint(look)) continue;
              if (probeRay.intersectBox(box, probeHit)) nearest = Math.min(nearest, probeHit.distanceTo(look));
            }
            if (nearest < reach) goal.copy(look).addScaledVector(probeRay.direction, Math.max(0.8, nearest - 0.6));
            goal.y = Math.max(goal.y, 0.6);
          }
          camera.position.lerp(goal, 1 - Math.exp(-dt * (cameraBlockers.length ? 22 : 18)));
          camera.up.set(0, 1, 0);
          // Aim at a far point on the look ray so screen centre is the true
          // line of fire and the drone sits just below it.
          camera.lookAt(look.addScaledVector(forward, 60).setY(look.y + 1.35));
        } else if (cameraMode === "Chase") {
          goal.copy(look); goal.x += 5; goal.y += 3.2; goal.z += 6.8;
          camera.position.lerp(goal, 1 - Math.exp(-dt * 4));
          look.y += .3;
          camera.lookAt(look);
        } else {
          setHeading();
          goal.set(0.27, 0.035, 0).applyQuaternion(body).add(look);
          const hitAge = s.time - fx.hitAt;
          const kick = effectsEnabled && hitAge >= 0 && hitAge < .35 ? Math.sin(hitAge * 45) * Math.exp(-hitAge * 14) * .045 : 0;
          pitch.setFromAxisAngle(
            pitchAxis,
            flightLook.pitch + (stabilizeView ? 0 : THREE.MathUtils.degToRad(cameraTilt)) + kick,
          );
          body.multiply(yaw).multiply(pitch);
          camera.position.copy(goal);
          up.set(0, 1, 0).applyQuaternion(body);
          forward.set(1, 0, 0).applyQuaternion(body);
          camera.up.copy(up);
          camera.lookAt(goal.add(forward));
        }
      }
    }
    if (cameraMode !== "FPV") camera.up.set(0, 1, 0);
    // Trauma shake (shake = trauma²), from blasts, bounces and recoil.
    if (effectsEnabled && cameraShake.trauma > 0 && cameraMode !== "Orbit") {
      const amount = cameraShake.trauma ** 2;
      const t = performance.now() / 1000;
      camera.position.x += Math.sin(t * 61) * amount * 0.32;
      camera.position.y += Math.sin(t * 47 + 1.3) * amount * 0.26;
      camera.rotateZ(Math.sin(t * 37 + 2.1) * amount * 0.05);
    }
    cameraShake.trauma = effectsEnabled ? Math.max(0, cameraShake.trauma - dt * 1.6) : 0;
    tracker.current.frames++;
    const now = performance.now();
    if (now - tracker.current.start > 1000) {
      onFps(
        Math.round(
          (tracker.current.frames * 1000) / (now - tracker.current.start),
        ),
      );
      tracker.current = { frames: 0, start: now };
    }
  });
  return cameraMode === "Orbit" ? (
    <OrbitControls
      makeDefault
      target={[0, 2, 0]}
      minDistance={2}
      maxDistance={55}
      maxPolarAngle={Math.PI / 2 - 0.04}
    />
  ) : null;
}
export function FlightScene({
  state,
  scenario,
  cameraMode,
  path,
  ghost,
  lookRef,
  fov = 90,
  cameraTilt = 15,
  effectsEnabled = false,
  stabilizeView = false,
  onFps,
  onCapture,
}: {
  state: MutableRefObject<PhysicalState | undefined>;
  scenario?: Scenario;
  cameraMode: CameraMode;
  path: V3[];
  ghost?: MutableRefObject<PhysicalState | undefined>;
  lookRef?: MutableRefObject<FlightLook>;
  /** Vertical FPV field of view in degrees. */
  fov?: number;
  /** Upward camera mount tilt in degrees. */
  cameraTilt?: number;
  effectsEnabled?: boolean;
  stabilizeView?: boolean;
  onFps: (fps: number) => void;
  onCapture: (
    fn: (() => { step: number; dataUrl: string }) | undefined,
  ) => void;
}) {
  const defaultLook = useRef<FlightLook>({ yaw: 0, pitch: 0 });
  // Solid map boxes (Three coords) the third-person camera must not pass through.
  const cameraBlockers = useMemo(() => (scenario?.id === "free" ? scenario.obstacles : []).map((o) =>
    new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(...visual(o.position)), new THREE.Vector3(o.size[0], o.size[2], o.size[1]))), [scenario]);
  return (
    <Canvas
      shadows={{ type: THREE.PCFShadowMap }}
      camera={{ position: [10, 7, 12], fov: 57, near: 0.05, far: 1000 }}
      dpr={[1, 1.5]}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
    >
      {scenario?.id === "free"
        ? scenario.mapId === "pizzeria" ? <PizzeriaWorld scenario={scenario} />
        : scenario.mapId === "city" ? <Suspense fallback={null}><CityWorld scenario={scenario} /></Suspense>
        : <OpenWorld scenario={scenario} />
        : <World scenario={scenario} />}
      {scenario?.id === "free" && (scenario.mapId === "pizzeria"
        ? <LandmarkBeacons key="pizzeria" world={PIZZERIA_WORLD} worldId="pizzeria" radius={0.32} height={(base) => Math.max(0, 5.9 - base)} state={state} />
        : scenario.mapId === "city"
        ? <LandmarkBeacons key="city" world={CITY_WORLD} worldId="city" radius={1.2} height={() => 90} state={state} />
        : <LandmarkBeacons key="valley" world={FREE_WORLD} worldId="valley" radius={1.4} height={() => 70} state={state} />)}
      <Suspense fallback={<Drone state={state} hidden={cameraMode === "FPV"} />}>
        <BlenderDrone state={state} hidden={cameraMode === "FPV"} smooth />
        {ghost && <BlenderDrone state={ghost} ghost />}
      </Suspense>
      <PresentationClock state={state} />
      <VelocityTrails state={state} enabled={effectsEnabled && cameraMode === "FPV"} />
      {scenario?.id === "free" && scenario.mapId === "city" && (
        <Suspense fallback={null}>
          <CityCombatLayer
            key="combat-city"
            world={CITY_WORLD}
            mapId="city"
            state={state}
            firstPerson={cameraMode === "FPV"}
            effectsEnabled={effectsEnabled}
          />
        </Suspense>
      )}
      {scenario?.id === "free" && scenario.mapId !== "city" && (
        <CombatLayer
          key={`combat-${scenario.mapId ?? "valley"}`}
          world={scenario.mapId === "pizzeria" ? PIZZERIA_WORLD : FREE_WORLD}
          mapId={scenario.mapId ?? "valley"}
          state={state}
          firstPerson={cameraMode === "FPV"}
          effectsEnabled={effectsEnabled}
        />
      )}
      {path.length > 1 && cameraMode !== "FPV" && (
        <Line
          points={path.map(visual)}
          color="#e9b853"
          lineWidth={1.4}
          transparent
          opacity={0.7}
        />
      )}
      <Rig
        cameraBlockers={cameraBlockers}
        state={state}
        cameraMode={cameraMode}
        lookRef={lookRef ?? defaultLook}
        fov={fov}
        cameraTilt={cameraTilt}
        effectsEnabled={effectsEnabled}
        stabilizeView={stabilizeView}
        onFps={onFps}
        onCapture={onCapture}
      />
      <ToonPipeline
        look={scenario?.id === "free" ? LOOKS[scenario.mapId ?? "valley"] : LOOKS.lab}
        state={state}
        effectsEnabled={effectsEnabled}
        firstPerson={cameraMode === "FPV"}
        worldKey={scenario?.id === "free" ? `free-${scenario.mapId ?? "valley"}` : scenario?.id ?? "none"}
      />
    </Canvas>
  );
}
