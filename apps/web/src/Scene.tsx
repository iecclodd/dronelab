import { useRef, useMemo, useEffect, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Grid, Line, Text } from "@react-three/drei";
import * as THREE from "three";
import type { PhysicalState, Scenario, V3 } from "../../../packages/contracts";
export type CameraMode = "Chase" | "FPV" | "Orbit";
export const visual = (v: V3): [number, number, number] => [v[0], v[2], -v[1]];
const basis = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(1, 0, 0),
  -Math.PI / 2,
);
function Drone({
  state,
  ghost = false,
}: {
  state: MutableRefObject<PhysicalState | undefined>;
  ghost?: boolean;
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
    q.premultiply(basis).multiply(basis.clone().invert());
    ref.current.quaternion.slerp(q, Math.min(1, dt * 28));
    rotors.current.forEach((r, i) => {
      if (r) r.rotation.y += dt * (s.motors[i] ?? 0.3) * 75;
    });
  });
  return (
    <group ref={ref} name={ghost ? "ghost" : "drone"}>
      <mesh castShadow>
        <boxGeometry args={[0.45, 0.13, 0.3]} />
        <meshStandardMaterial
          color={ghost ? "#4bebdf" : "#263231"}
          transparent={ghost}
          opacity={ghost ? 0.4 : 1}
          metalness={0.55}
          roughness={0.38}
        />
      </mesh>
      <mesh position={[0.06, 0.1, 0]} castShadow>
        <boxGeometry args={[0.22, 0.07, 0.19]} />
        <meshStandardMaterial color="#efb347" />
      </mesh>
      {[
        [-0.3, -0.3],
        [-0.3, 0.3],
        [0.3, -0.3],
        [0.3, 0.3],
      ].map(([x, z], i) => (
        <group key={i}>
          <mesh rotation={[0, x * z > 0 ? -Math.PI / 4 : Math.PI / 4, 0]}>
            <boxGeometry args={[0.85, 0.045, 0.055]} />
            <meshStandardMaterial color="#293736" />
          </mesh>
          <mesh position={[x, 0.02, z]}>
            <cylinderGeometry args={[0.055, 0.055, 0.12, 12]} />
            <meshStandardMaterial color="#303c3b" />
          </mesh>
          <group
            position={[x, 0.095, z]}
            ref={(el) => {
              if (el) rotors.current[i] = el;
            }}
          >
            <mesh>
              <boxGeometry args={[0.38, 0.012, 0.05]} />
              <meshStandardMaterial
                color={i < 2 ? "#a2beb9" : "#f2b349"}
                transparent
                opacity={0.85}
              />
            </mesh>
          </group>
          <mesh position={[x, -0.14, z]}>
            <boxGeometry args={[0.04, 0.17, 0.04]} />
            <meshStandardMaterial color="#24302f" />
          </mesh>
        </group>
      ))}
      <mesh position={[0.245, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.045, 0.045, 0.04, 12]} />
        <meshStandardMaterial
          color="#4ae4d4"
          emissive="#2aa896"
          emissiveIntensity={0.5}
        />
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
function Rig({
  state,
  cameraMode,
  onFps,
  onCapture,
}: {
  state: MutableRefObject<PhysicalState | undefined>;
  cameraMode: CameraMode;
  onFps: (fps: number) => void;
  onCapture: (
    fn: (() => { step: number; dataUrl: string }) | undefined,
  ) => void;
}) {
  const { camera, gl, scene } = useThree();
  const goal = useMemo(() => new THREE.Vector3(), []);
  const look = useMemo(() => new THREE.Vector3(), []);
  const tracker = useRef({ frames: 0, start: performance.now() });
  const step = useRef(0);
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
          .multiply(basis.clone().invert());
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
  useFrame((_, dt) => {
    const s = state.current;
    if (s) {
      step.current = s.step;
      if (cameraMode !== "Orbit") {
        look.set(...visual(s.position));
        if (cameraMode === "Chase") {
          goal.copy(look).add(new THREE.Vector3(5, 3.2, 6.8));
          camera.position.lerp(goal, 1 - Math.exp(-dt * 4));
          camera.lookAt(look.add(new THREE.Vector3(0, 0.3, 0)));
        } else {
          const q = new THREE.Quaternion(...s.quaternion);
          q.premultiply(basis).multiply(basis.clone().invert());
          goal.set(0.45, 0.1, 0).applyQuaternion(q).add(look);
          camera.position.copy(goal);
          camera.up.set(0, 1, 0).applyQuaternion(q);
          camera.lookAt(
            new THREE.Vector3(10, 0, 0).applyQuaternion(q).add(look),
          );
        }
      }
    }
    if (cameraMode !== "FPV") camera.up.set(0, 1, 0);
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
  onFps,
  onCapture,
}: {
  state: MutableRefObject<PhysicalState | undefined>;
  scenario?: Scenario;
  cameraMode: CameraMode;
  path: V3[];
  ghost?: MutableRefObject<PhysicalState | undefined>;
  onFps: (fps: number) => void;
  onCapture: (
    fn: (() => { step: number; dataUrl: string }) | undefined,
  ) => void;
}) {
  return (
    <Canvas
      shadows={{ type: THREE.PCFShadowMap }}
      camera={{ position: [10, 7, 12], fov: 57, near: 0.05, far: 240 }}
      dpr={[1, 1.5]}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
    >
      <World scenario={scenario} />
      <Drone state={state} />
      {ghost && <Drone state={ghost} ghost />}
      {path.length > 1 && (
        <Line
          points={path.map(visual)}
          color="#e9b853"
          lineWidth={1.4}
          transparent
          opacity={0.7}
        />
      )}
      <Rig
        state={state}
        cameraMode={cameraMode}
        onFps={onFps}
        onCapture={onCapture}
      />
    </Canvas>
  );
}
