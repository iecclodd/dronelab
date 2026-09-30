import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { Obstacle, PhysicalState, V3 } from "../../../packages/contracts";
import type { FreeWorldDefinition, FreeWorldMapId } from "../../../packages/contracts/free-world";
import { CITY_RUBBLE } from "../../../packages/contracts/city-world";
import { rimLight } from "./cel-material";
import { addTrauma, combatEvents, combatInput, combatSfx, combatStats, droneFx, queueKick, type CombatEvent } from "./combat-store";

/**
 * Explore combat: a hitscan machine gun, original "Hollow" bots and
 * explosive barrels, manga-style explosions with chain reactions and real
 * knockback (delivered to the simulator as one-shot kicks). Targets are
 * presentation-side gameplay objects, not physics colliders; the drone
 * *reacts* to them through kicks. Game logic runs in ENU; rendering in Three.
 */

type Kind = "bot" | "barrel" | "car" | "ethereal";
interface TargetSpec {
  id: string;
  kind: Kind;
  position: V3;
  /** car / ethereal model name */
  model?: string;
  /** car heading (radians) */
  yaw?: number;
  flipped?: 0 | 1 | 2;
  burning?: boolean;
  hp?: number;
  /** Oversized ground-hugging brute (a giant golem): punches when you fly low. */
  boss?: boolean;
}

const bot = (id: string, position: V3): TargetSpec => ({ id, kind: "bot", position });
const barrel = (id: string, x: number, y: number): TargetSpec => ({ id, kind: "barrel", position: [x, y, 0.55] });

const CAR_MODELS = ["taxi", "taxi", "sedan", "police", "van", "suv", "taxi", "truck", "ambulance", "delivery", "garbage-truck", "hatchback-sports"];
const ETHEREAL_HP: Record<string, number> = { goleling: 22, squidle: 18, dragonfly: 14 };
const cityCars = (): TargetSpec[] => {
  const out: TargetSpec[] = [];
  const r = (i: number, k: number) => { const v = Math.sin(i * 91.7 + k * 13.1) * 43758.5; return v - Math.floor(v); };
  for (let i = 0; i < 30; i++) {
    const avenue = r(i, 1) < 0.5;
    const lane = (r(i, 2) < 0.5 ? -1 : 1) * (avenue ? 4 : 3);
    const x = avenue ? [-88, -44, 0, 44, 88][Math.floor(r(i, 3) * 5)]! + lane : (r(i, 4) - 0.5) * 200;
    const y = avenue ? (r(i, 4) - 0.5) * 200 : [-96, -64, -32, 32, 64, 96][Math.floor(r(i, 3) * 6)]! + lane;
    if (Math.hypot(x, y) < 16 || x < -96) continue;
    if (CITY_RUBBLE.some((b) => Math.abs(b.position[0] - x) < b.size[0] / 2 + 3 && Math.abs(b.position[1] - y) < b.size[1] / 2 + 3)) continue;
    const flip = r(i, 5);
    out.push({
      id: `car-${i}`, kind: "car", model: CAR_MODELS[i % CAR_MODELS.length], position: [x, y, 0],
      yaw: (avenue ? Math.PI / 2 : 0) + (r(i, 6) < 0.5 ? Math.PI : 0) + (r(i, 7) - 0.5) * 0.9,
      flipped: flip < 0.18 ? 2 : flip < 0.34 ? 1 : 0, burning: r(i, 8) < 0.45, hp: 6,
    });
  }
  return out;
};
const ethereal = (id: string, model: string, position: V3): TargetSpec => ({ id, kind: "ethereal", model, position, hp: ETHEREAL_HP[model] });

export const COMBAT_TARGETS: Record<FreeWorldMapId, TargetSpec[]> = {
  city: [
    ...cityCars(),
    ethereal("e-gol-1", "goleling", [0, 20, 18]), ethereal("e-gol-2", "goleling", [22, 0, 24]), ethereal("e-gol-3", "goleling", [-44, -20, 14]),
    ethereal("e-gol-4", "goleling", [44, 40, 20]), ethereal("e-gol-5", "goleling", [66, -64, 18]), ethereal("e-gol-6", "goleling", [88, 10, 22]),
    ethereal("e-squ-1", "squidle", [-20, 0, 16]), ethereal("e-squ-2", "squidle", [0, -40, 22]), ethereal("e-squ-3", "squidle", [44, -20, 30]),
    ethereal("e-squ-4", "squidle", [-88, -40, 18]), ethereal("e-squ-5", "squidle", [22, 80, 24]),
    ethereal("e-dra-1", "dragonfly", [-44, 80, 20]), ethereal("e-dra-2", "dragonfly", [88, 64, 16]), ethereal("e-dra-3", "dragonfly", [-10, 40, 34]), ethereal("e-dra-4", "dragonfly", [30, -90, 20]),
    { ...ethereal("e-boss-1", "goleling", [0, 0, 3.6]), boss: true, hp: 90 }, { ...ethereal("e-boss-2", "goleling", [-44, -48, 3.6]), boss: true, hp: 90 },
  ],
  valley: [
    bot("air-1", [30, 12, 6]), bot("air-2", [46, 22, 10]), bot("air-3", [-12, 32, 8]),
    bot("yard-1", [46, -44, 7]), bot("yard-2", [65, -48, 11]), bot("yard-3", [96, -12, 9]), bot("yard-4", [58, -18, 14]),
    bot("canyon-1", [123, 48, 12]), bot("canyon-2", [123, 66, 18]), bot("canyon-3", [118, 90, 9]),
    bot("look-1", [133, 114, 12]), bot("look-2", [164, 96, 16]), bot("look-3", [151, 122, 26]),
    bot("wood-1", [-110, 128, 18]), bot("wood-2", [150, -128, 20]), bot("wood-3", [-118, -128, 16]),
    bot("sky-1", [0, -62, 22]), bot("sky-2", [88, 58, 30]),
    barrel("b-yard-1", 52, -49), barrel("b-yard-2", 55, -49.6), barrel("b-yard-3", 70, -50), barrel("b-yard-4", 40, -47),
    barrel("b-home-1", 10, -15), barrel("b-home-2", -5, -11.5), barrel("b-home-3", 8, -13.4),
  ],
  pizzeria: [
    bot("p-aisle", [2, 0, 3.2]), bot("p-arcade", [6, 10.5, 2.6]), bot("p-south", [-10, -8, 2.8]), bot("p-stage", [12, -6, 4]),
    bot("p-back", [-2, -12, 3.2]), bot("p-corner", [18, 9, 3.6]), bot("p-office", [-13, 8, 3.9]),
    barrel("pb-1", -18, 12), barrel("pb-2", -18.6, 13.1), barrel("pb-3", 6, -15),
  ],
};

const HP: Record<Kind, number> = { bot: 14, barrel: 3, car: 6, ethereal: 20 };
const RESPAWN: Record<Kind, number> = { bot: 8, barrel: 11, car: 16, ethereal: 10 };
const maxHp = (spec: TargetSpec) => spec.hp ?? HP[spec.kind];
/** Hit sphere radius (m) per target. */
const radiusOf = (spec: TargetSpec, scale: number) =>
  spec.kind === "bot" ? 1.25 * scale : spec.kind === "barrel" ? 0.6 : spec.kind === "car" ? 2.3 : spec.boss ? 3.2 : 1.9;
const FIRE_RATE = 13;
const HEAT_PER_SHOT = 0.042;
const HEAT_COOL = 0.46;
/** While overheated the barrel vents fast, and fire resumes at this heat. */
const HEAT_VENT = 0.95;
const HEAT_RESUME = 0.45;

const three = ([x, y, z]: V3, out = new THREE.Vector3()) => out.set(x, z, -y);
const enu = (v: THREE.Vector3): V3 => [v.x, -v.z, v.y];

/** Slab ray/AABB test returning distance and outward normal (ENU). */
function rayBox(o: V3, d: V3, box: Obstacle, maxT: number): { t: number; n: V3 } | undefined {
  let tMin = 0, tMax = maxT, axis = -1, sign = 0;
  for (let i = 0; i < 3; i++) {
    const lo = box.position[i]! - box.size[i]! / 2, hi = box.position[i]! + box.size[i]! / 2;
    if (Math.abs(d[i]!) < 1e-9) { if (o[i]! < lo || o[i]! > hi) return undefined; continue; }
    let t1 = (lo - o[i]!) / d[i]!, t2 = (hi - o[i]!) / d[i]!;
    let s = -1;
    if (t1 > t2) { [t1, t2] = [t2, t1]; s = 1; }
    if (t1 > tMin) { tMin = t1; axis = i; sign = s; }
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return undefined;
  }
  if (axis < 0) return undefined;
  const n: V3 = [0, 0, 0];
  n[axis] = sign;
  return { t: tMin, n };
}
function raySphere(o: V3, d: V3, c: V3, r: number): number | undefined {
  const oc: V3 = [o[0] - c[0], o[1] - c[1], o[2] - c[2]];
  const b = oc[0] * d[0] + oc[1] * d[1] + oc[2] * d[2];
  const cc = oc[0] ** 2 + oc[1] ** 2 + oc[2] ** 2 - r * r;
  const h = b * b - cc;
  if (h < 0) return undefined;
  const t = -b - Math.sqrt(h);
  return t > 0 ? t : undefined;
}

interface Live {
  spec: TargetSpec;
  hp: number;
  alive: boolean;
  respawnAt: number;
  spawnedAt: number;
  flash: number;
  pendingDeathAt: number;
  group?: THREE.Group;
  materials: THREE.MeshToonMaterial[];
  eyes?: THREE.MeshBasicMaterial;
  mixer?: THREE.AnimationMixer;
  actions?: Record<string, THREE.AnimationAction>;
  current?: string;
  fire?: THREE.Object3D;
  ai?: { attackReady: number; hitAt: number; lungeAt: number };
}

/** Loaded GLB sources for the city (cars, Ethereals, car debris). */
export interface CombatModels {
  cars: Record<string, THREE.Object3D>;
  ethereals: Record<string, { scene: THREE.Object3D; animations: THREE.AnimationClip[] }>;
  debris: THREE.Object3D[];
}

function toonCar(source: THREE.Object3D, gradient: THREE.Texture, live: Live) {
  const car = source.clone(true);
  car.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const original = mesh.material as THREE.MeshStandardMaterial;
    const toon = new THREE.MeshToonMaterial({ map: original.map, color: original.color, gradientMap: gradient });
    live.materials.push(toon);
    mesh.material = toon;
    mesh.castShadow = true;
  });
  return car;
}

function buildCar(models: CombatModels, gradient: THREE.Texture, live: Live) {
  const g = new THREE.Group();
  const body = toonCar(models.cars[live.spec.model ?? "taxi"] ?? models.cars.taxi!, gradient, live);
  body.scale.setScalar(1.7);
  if (live.spec.flipped === 1) { body.rotation.z = Math.PI / 2; body.position.y = 1.3; }
  if (live.spec.flipped === 2) { body.rotation.x = Math.PI; body.position.y = 2.3; }
  body.rotation.y = 0;
  g.add(body);
  g.rotation.y = live.spec.yaw ?? 0;
  if (live.spec.burning) {
    // Inked manga fire: stepped toon cones that flicker on a held clock.
    const fire = new THREE.Group();
    const colours = ["#ff5a1f", "#ff9a2a", "#ffe07a"];
    for (let i = 0; i < 5; i++) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.55 - (i % 3) * 0.12, 1.6 + (i % 3) * 0.5, 7), new THREE.MeshToonMaterial({ color: colours[i % 3], emissive: colours[i % 3], emissiveIntensity: 0.9, gradientMap: gradient }));
      cone.position.set((i - 2) * 0.55, 2.2 + (i % 2) * 0.3, ((i * 7) % 3 - 1) * 0.5);
      fire.add(cone);
    }
    live.fire = fire;
    g.add(fire);
  }
  return g;
}

const ETHEREAL_HEIGHT: Record<string, number> = { goleling: 2.6, squidle: 2.4, dragonfly: 2.2 };
function buildEthereal(models: CombatModels, gradient: THREE.Texture, live: Live) {
  const source = models.ethereals[live.spec.model ?? "goleling"]!;
  const body = cloneSkinned(source.scene) as THREE.Object3D;
  // Ethereal palette: void-black hide, neon magenta accents, burning eyes.
  body.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.frustumCulled = false;
    const name = ((mesh.material as THREE.Material).name || "").toLowerCase();
    let material: THREE.Material;
    if (name.includes("eye_white")) material = new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffe14d").multiplyScalar(2.5), toneMapped: false });
    else if (name.includes("eye_black")) material = new THREE.MeshBasicMaterial({ color: "#16020c" });
    else {
      const accent = name.includes("secondary") || name.includes("horn") || name.includes("wing") || name.includes("tongue") || name.includes("mouth") || name.includes("belt");
      const toon = new THREE.MeshToonMaterial({ color: accent ? "#e8397a" : "#1d1628", emissive: accent ? "#b0104a" : "#2a0c3a", emissiveIntensity: accent ? 0.6 : 0.35, gradientMap: gradient });
      if (!accent) { toon.onBeforeCompile = rimLight; toon.customProgramCacheKey = () => "cel-rim"; }
      live.materials.push(toon);
      material = toon;
    }
    mesh.material = material;
    mesh.castShadow = true;
  });
  const holder = new THREE.Group();
  holder.add(body);
  // Size from the skeleton: these rigs store tiny raw vertices scaled up by
  // the armature, so geometry bounds are unreliable for skinned meshes.
  body.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  body.traverse((o) => { if ((o as THREE.Bone).isBone) box.expandByPoint(o.getWorldPosition(point)); });
  if (box.isEmpty()) box.setFromObject(body);
  const size = box.getSize(new THREE.Vector3());
  const k = (live.spec.boss ? 7.5 : ETHEREAL_HEIGHT[live.spec.model ?? "goleling"] ?? 2.5) / Math.max(size.y * 1.25, 1e-4);
  body.scale.multiplyScalar(k);
  body.position.y = -box.min.y * k - (size.y * k) / 2;
  holder.userData.debugHeight = size.y * k;
  live.mixer = new THREE.AnimationMixer(body);
  live.actions = {};
  for (const clip of source.animations) {
    const short = clip.name.split("|").pop()!;
    live.actions[short] = live.mixer.clipAction(clip);
  }
  live.ai = { attackReady: 0, hitAt: -10, lungeAt: -10 };
  return holder;
}

function play(live: Live, name: string, once = false) {
  const action = live.actions?.[name];
  if (!action || live.current === name) return;
  const previous = live.current ? live.actions?.[live.current] : undefined;
  action.reset();
  action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
  action.clampWhenFinished = once;
  action.fadeIn(0.12).play();
  previous?.fadeOut(0.12);
  live.current = name;
}

function makeGradient() {
  const map = new THREE.DataTexture(new Uint8Array([70, 70, 70, 255, 160, 160, 160, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
  map.minFilter = map.magFilter = THREE.NearestFilter;
  map.needsUpdate = true;
  return map;
}

/** Original "Hollow" bot: a TV-headed drone with a hazard halo. */
function buildBot(gradient: THREE.Texture, live: Live) {
  const g = new THREE.Group();
  const toon = (color: string, rim = false) => {
    const m = new THREE.MeshToonMaterial({ color, gradientMap: gradient });
    if (rim) { m.onBeforeCompile = rimLight; m.customProgramCacheKey = () => "cel-rim"; }
    live.materials.push(m);
    return m;
  };
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.15, 1.15), toon("#2b2540"));
  g.add(body);
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.25, 0.18), toon("#e8397a"));
  bezel.position.z = 0.55;
  g.add(bezel);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.32, 0.88), new THREE.MeshBasicMaterial({ color: "#12101c" }));
  screen.position.z = 0.65;
  screen.userData.ink = true;
  g.add(screen);
  const eyes = new THREE.MeshBasicMaterial({ color: "#ffe14d", toneMapped: false });
  live.eyes = eyes;
  for (const x of [-0.3, 0.3]) {
    const eye = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.34), eyes);
    eye.position.set(x, 0.04, 0.66);
    eye.rotation.z = x > 0 ? -0.25 : 0.25;
    g.add(eye);
  }
  for (const x of [-0.5, 0.5]) {
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.7, 6), toon("#2b2540"));
    stalk.position.set(x, 0.9, 0);
    stalk.rotation.z = x * 0.5;
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), toon("#ffe14d", true));
    tip.position.set(x * 1.35, 1.25, 0);
    g.add(stalk, tip);
  }
  const halo = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.09, 8, 36), toon("#ffd23f", true));
  halo.name = "halo";
  halo.rotation.x = Math.PI / 2.4;
  g.add(halo);
  const jet = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.6, 12), toon("#e8397a", true));
  jet.position.y = -0.85;
  jet.rotation.x = Math.PI;
  g.add(jet);
  return g;
}

function buildBarrel(gradient: THREE.Texture, live: Live) {
  const g = new THREE.Group();
  const toon = (color: string) => { const m = new THREE.MeshToonMaterial({ color, gradientMap: gradient }); live.materials.push(m); return m; };
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.1, 16), toon("#d8433a"));
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.47, 0.22, 16), toon("#ffd23f"));
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.04, 16), toon("#3b2f3f"));
  lid.position.y = 0.57;
  g.add(drum, band, lid);
  return g;
}

/** Pooled manga explosion: flash, inked fireballs, smoke, shockwave, debris, ink star. */
class Explosion {
  group = new THREE.Group();
  age = 99;
  radius = 1;
  private fire: THREE.Mesh[] = [];
  private smoke: THREE.Mesh[] = [];
  private debris: { mesh: THREE.Mesh; v: THREE.Vector3; spin: THREE.Vector3 }[] = [];
  private flash: THREE.Mesh;
  private ring: THREE.Mesh;
  private star: THREE.Mesh;
  private fireMat: THREE.MeshToonMaterial;
  private dirs: THREE.Vector3[] = [];
  private colorA = new THREE.Color();
  constructor(gradient: THREE.Texture, starGeometry: THREE.BufferGeometry) {
    this.group.visible = false;
    this.fireMat = new THREE.MeshToonMaterial({ color: "#ffb13b", emissive: "#ff6a1a", emissiveIntensity: 0.9, gradientMap: gradient });
    const smokeMat = new THREE.MeshToonMaterial({ color: "#3b3340", gradientMap: gradient });
    const sphere = new THREE.SphereGeometry(1, 14, 10);
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(sphere, this.fireMat);
      this.fire.push(m);
      this.group.add(m);
      this.dirs.push(new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 - 0.2, Math.random() - 0.5).normalize());
    }
    for (let i = 0; i < 5; i++) { const m = new THREE.Mesh(sphere, smokeMat); this.smoke.push(m); this.group.add(m); }
    const shard = new THREE.BoxGeometry(0.22, 0.12, 0.3);
    const shardMat = new THREE.MeshToonMaterial({ color: "#2b2540", gradientMap: gradient });
    for (let i = 0; i < 10; i++) {
      const mesh = new THREE.Mesh(shard, shardMat);
      this.debris.push({ mesh, v: new THREE.Vector3(), spin: new THREE.Vector3() });
      this.group.add(mesh);
    }
    this.flash = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 6, 5), toneMapped: false, transparent: true }));
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 48), new THREE.MeshBasicMaterial({ color: "#fff8e6", transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2;
    this.star = new THREE.Mesh(starGeometry, new THREE.MeshBasicMaterial({ color: "#16131d", side: THREE.DoubleSide }));
    this.star.userData.ink = true;
    this.group.add(this.flash, this.ring, this.star);
  }
  fire_(at: THREE.Vector3, radius: number) {
    this.group.position.copy(at);
    this.radius = radius;
    this.age = 0;
    this.group.visible = true;
    for (const d of this.debris) {
      d.mesh.position.set(0, 0, 0);
      d.v.set(Math.random() - 0.5, Math.random() * 0.9 + 0.3, Math.random() - 0.5).normalize().multiplyScalar(radius * (4 + Math.random() * 4));
      d.spin.set(Math.random() * 14, Math.random() * 14, Math.random() * 14);
    }
    this.star.rotation.set(0, 0, Math.random() * Math.PI);
  }
  update(dt: number, camera: THREE.Camera) {
    if (!this.group.visible) return;
    this.age += dt;
    const t = this.age, R = this.radius;
    if (t > 1.3) { this.group.visible = false; return; }
    const pop = Math.min(1, t / 0.12);
    const ease = 1 - (1 - pop) ** 3;
    const shrink = t < 0.18 ? 1 : Math.max(0, 1 - (t - 0.18) / 0.75);
    this.fireMat.color.copy(this.colorA.set(t < 0.08 ? "#fff3b0" : t < 0.3 ? "#ffb13b" : t < 0.6 ? "#e2542a" : "#6b4a4a"));
    this.fireMat.emissiveIntensity = Math.max(0, 1.2 - t * 1.6);
    this.fire.forEach((m, i) => {
      m.position.copy(this.dirs[i]!).multiplyScalar(R * 0.55 * ease + t * R * 0.25);
      m.position.y += t * R * 0.6;
      m.scale.setScalar(Math.max(0.001, R * (0.42 + (i % 3) * 0.08) * ease * shrink));
    });
    this.smoke.forEach((m, i) => {
      const k = Math.max(0, t - 0.15);
      m.visible = t > 0.15;
      m.position.set(Math.sin(i * 2.1) * R * 0.5, k * R * 1.8 + R * 0.2, Math.cos(i * 2.1) * R * 0.5);
      m.scale.setScalar(Math.max(0.001, R * 0.5 * Math.min(1, k * 3) * Math.max(0, 1 - k / 1.1)));
    });
    for (const d of this.debris) {
      d.v.y -= 22 * dt;
      d.mesh.position.addScaledVector(d.v, dt);
      d.mesh.rotation.x += d.spin.x * dt; d.mesh.rotation.y += d.spin.y * dt;
      d.mesh.visible = t < 1.1;
    }
    this.flash.visible = t < 0.1;
    this.flash.scale.setScalar(R * 1.5 * ease);
    (this.flash.material as THREE.MeshBasicMaterial).opacity = 1 - t / 0.1;
    const rt = Math.min(1, t / 0.5);
    this.ring.visible = t < 0.5;
    this.ring.scale.setScalar(R * (1 + rt * 4.5));
    (this.ring.material as THREE.MeshBasicMaterial).opacity = (1 - rt) * 0.9;
    this.star.visible = t < 0.16;
    this.star.quaternion.copy(camera.quaternion);
    this.star.scale.setScalar(R * (t < 0.05 ? 2.6 * (t / 0.05) : 2.6));
  }
}

function starGeometry(points = 11) {
  const shape = new THREE.Shape();
  for (let i = 0; i <= points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2;
    const r = i % 2 === 0 ? 1 : 0.42 + ((i * 37) % 7) / 40;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  return new THREE.ShapeGeometry(shape);
}

export function CombatLayer({
  world,
  mapId,
  state,
  firstPerson,
  effectsEnabled,
  models,
}: {
  world: FreeWorldDefinition;
  mapId: FreeWorldMapId;
  state: MutableRefObject<PhysicalState | undefined>;
  firstPerson: boolean;
  effectsEnabled: boolean;
  models?: CombatModels;
}) {
  const { camera } = useThree();
  const scale = mapId === "pizzeria" ? 0.5 : 1;
  const range = mapId === "pizzeria" ? 70 : mapId === "city" ? 230 : 280;
  const ceiling = mapId === "pizzeria" ? world.ceiling : undefined;
  const gradient = useMemo(makeGradient, []);
  const star = useMemo(() => starGeometry(), []);

  const targets = useMemo<Live[]>(() => COMBAT_TARGETS[mapId].map((spec) => ({
    spec, hp: maxHp(spec), alive: true, respawnAt: 0, spawnedAt: -10, flash: 0, pendingDeathAt: Infinity, materials: [],
  })), [mapId]);
  const root = useMemo(() => {
    const group = new THREE.Group();
    group.name = "combat";
    for (const live of targets) {
      const kind = live.spec.kind;
      if ((kind === "car" || kind === "ethereal") && !models) continue;
      live.group = kind === "bot" ? buildBot(gradient, live) : kind === "barrel" ? buildBarrel(gradient, live) : kind === "car" ? buildCar(models!, gradient, live) : buildEthereal(models!, gradient, live);
      if (kind === "bot") live.group.scale.setScalar(scale);
      three(live.spec.position, live.group.position);
      group.add(live.group);
    }
    return group;
  }, [targets, gradient, scale, models]);
  // Car explosions throw real Kenney car parts.
  const debris = useMemo(() => (models?.debris ?? []).flatMap((source) => Array.from({ length: 4 }, () => {
    const mesh = toonCar(source, gradient, { materials: [] } as unknown as Live);
    mesh.scale.setScalar(1.7);
    mesh.visible = false;
    return { mesh, v: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0 };
  })), [models, gradient]);
  const debrisCursor = useRef(0);

  const fx = useMemo(() => {
    const explosions = Array.from({ length: 7 }, () => new Explosion(gradient, star));
    const sparkGeo = new THREE.BoxGeometry(0.05, 0.05, 0.45);
    const sparks = new THREE.InstancedMesh(sparkGeo, new THREE.MeshBasicMaterial({ toneMapped: false }), 180);
    sparks.frustumCulled = false;
    sparks.userData.noInk = true;
    const tracerGeo = new THREE.BoxGeometry(1, 1, 1);
    tracerGeo.translate(0, 0, 0.5);
    const tracers = new THREE.InstancedMesh(tracerGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.4, 1.6), toneMapped: false }), 48);
    tracers.frustumCulled = false;
    tracers.userData.noInk = true;
    const flashMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 4, 2), toneMapped: false, side: THREE.DoubleSide, transparent: true, depthWrite: false });
    const muzzle = new THREE.Mesh(starGeometry(7), flashMat);
    muzzle.userData.noInk = true;
    muzzle.visible = false;
    const group = new THREE.Group();
    group.add(sparks, tracers, muzzle, ...explosions.map((e) => e.group));
    return {
      explosions, sparks, tracers, muzzle, group,
      spark: Array.from({ length: 180 }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, color: new THREE.Color() })),
      tracer: Array.from({ length: 48 }, () => ({ from: new THREE.Vector3(), dir: new THREE.Vector3(), length: 0, age: 1e9 })),
      nextSpark: 0, nextTracer: 0, nextExplosion: 0, muzzleUntil: 0,
    };
  }, [gradient, star]);

  useEffect(() => () => {
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { (o as THREE.Mesh).geometry.dispose(); } });
    targets.forEach((t) => { t.materials.forEach((m) => m.dispose()); t.eyes?.dispose(); });
  }, [root, targets]);
  useEffect(() => () => { gradient.dispose(); star.dispose(); }, [gradient, star]);

  const sim = useRef({
    time: 0, fireClock: 0, heat: 0, overheated: false, combo: 0, comboTimer: 0, score: 0, kills: 0,
    killTimes: [] as number[], statsClock: 0, lastSimTime: -1, lastImpactStep: -1,
  });
  const tmp = useMemo(() => ({
    o: new THREE.Vector3(), d: new THREE.Vector3(), p: new THREE.Vector3(), q: new THREE.Quaternion(), m: new THREE.Matrix4(),
    s: new THREE.Vector3(), z: new THREE.Vector3(0, 0, 1), drone: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(),
  }), []);

  const project = (world: THREE.Vector3) => {
    tmp.p.copy(world).project(camera);
    return { x: (tmp.p.x + 1) / 2, y: (1 - tmp.p.y) / 2 };
  };
  const emit = (event: CombatEvent) => combatEvents.emit(event);

  const spawnSparks = (at: THREE.Vector3, normal: THREE.Vector3, count: number, color: string, speed = 9) => {
    for (let i = 0; i < count; i++) {
      const s = fx.spark[fx.nextSpark]!;
      fx.nextSpark = (fx.nextSpark + 1) % fx.spark.length;
      s.p.copy(at);
      s.v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(1.4).add(normal).normalize().multiplyScalar(speed * (0.5 + Math.random()));
      s.life = 0.22 + Math.random() * 0.2;
      s.color.set(color).multiplyScalar(color === "#fff0a8" ? 3 : 1);
    }
  };

  const explode = (live: Live, cause: "shot" | "ram" | "chain") => {
    const r = sim.current;
    live.alive = false;
    live.pendingDeathAt = Infinity;
    live.respawnAt = r.time + RESPAWN[live.spec.kind];
    if (live.group) live.group.visible = false;
    const big = live.spec.kind === "barrel" || live.spec.kind === "car" || !!live.spec.boss;
    const radius = (live.spec.kind === "car" ? 4.4 : live.spec.boss ? 5 : big ? 3.4 : 2.4) * (mapId === "pizzeria" ? 0.6 : 1);
    const at = three(live.spec.position, new THREE.Vector3());
    if (live.group) at.copy(live.group.position);
    if (live.spec.kind === "car") {
      at.y += 1.2;
      for (let k = 0; k < 5 && debris.length; k++) {
        const piece = debris[debrisCursor.current % debris.length]!;
        debrisCursor.current++;
        piece.mesh.position.copy(at);
        piece.v.set(Math.random() - 0.5, 0.7 + Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(12 + Math.random() * 10);
        piece.spin.set(Math.random() * 12, Math.random() * 12, Math.random() * 12);
        piece.life = 3.2;
        piece.mesh.visible = true;
      }
    }
    const e = fx.explosions[fx.nextExplosion]!;
    fx.nextExplosion = (fx.nextExplosion + 1) % fx.explosions.length;
    e.fire_(at, radius);
    spawnSparks(at, new THREE.Vector3(0, 1, 0), 18, "#fff0a8", 16);
    // Chain reaction: nearby targets take blast damage a beat later.
    for (const other of targets) {
      if (!other.alive || other === live) continue;
      const dist = three(other.spec.position, tmp.s).distanceTo(at);
      if (dist < radius * 2.2) {
        other.hp -= other.spec.boss ? (big ? 25 : 8) : big ? 99 : 6;
        if (other.hp <= 0) other.pendingDeathAt = Math.min(other.pendingDeathAt, r.time + 0.12 + dist * 0.02);
      }
    }
    // Knockback: the drone gets thrown by the blast, scaled by distance.
    const s = state.current;
    let shake = 0.25;
    if (s) {
      three(s.position, tmp.drone);
      const away = tmp.drone.clone().sub(at);
      const dist = away.length();
      const reach = radius * 4.5;
      if (dist < reach) {
        const k = 1 - dist / reach;
        away.normalize().multiplyScalar((big ? 22 : 16) * k);
        away.y += 5 * k;
        queueKick(enu(away));
        shake += 0.6 * k;
      }
    }
    if (effectsEnabled) addTrauma(shake, 1);
    const points = (live.spec.kind === "ethereal" ? (live.spec.boss ? 2500 : 800) : live.spec.kind === "car" ? 350 : big ? 300 : 500) * (1 + Math.floor(r.combo / 20));
    r.score += points;
    r.kills += 1;
    r.killTimes = r.killTimes.filter((time) => r.time - time < 2.6).concat(r.time);
    const screen = project(at);
    emit({ type: "kill", x: screen.x, y: screen.y, score: points, big });
    if (r.killTimes.length >= 2 && cause !== "chain") emit({ type: "multikill", count: r.killTimes.length });
    else if (r.killTimes.length >= 2) window.setTimeout(() => emit({ type: "multikill", count: sim.current.killTimes.length }), 140);
    combatSfx.play("boom", big ? 1.4 : 1);
  };

  const damage = (live: Live, amount: number, at: THREE.Vector3, crit: boolean) => {
    const r = sim.current;
    live.hp -= amount;
    live.flash = 0.07;
    if (live.spec.kind === "ethereal" && live.ai && r.time - live.ai.hitAt > 0.6) { live.ai.hitAt = r.time; play(live, "HitReact", true); if (!live.actions?.HitReact) play(live, "HitRecieve", true); }
    r.combo += 1;
    r.comboTimer = 2.8;
    r.score += Math.round(10 * amount * (1 + r.combo / 25));
    const screen = project(at);
    emit({ type: "hit", x: screen.x, y: screen.y, damage: amount * (crit ? 37 : 23) + Math.floor(Math.random() * 9), crit });
    combatSfx.play("hit");
    if (live.hp <= 0) explode(live, "shot");
  };

  const shoot = () => {
    const r = sim.current;
    camera.getWorldPosition(tmp.o);
    camera.getWorldDirection(tmp.d);
    tmp.d.x += (Math.random() - 0.5) * 0.016;
    tmp.d.y += (Math.random() - 0.5) * 0.016;
    tmp.d.z += (Math.random() - 0.5) * 0.016;
    tmp.d.normalize();
    const o = enu(tmp.o), d = enu(tmp.d);
    const s = state.current;
    const minT = s && !firstPerson ? three(s.position, tmp.drone).distanceTo(tmp.o) + 0.6 : 0.2;
    let best = range, normal: V3 = [0, 0, 1], hitTarget: Live | undefined, surface: "ground" | "wall" | "sky" = "sky";
    for (const live of targets) {
      if (!live.alive || !live.group) continue;
      const c = enu(live.group.position);
      const t = raySphere(o, d, c, radiusOf(live.spec, scale));
      if (t !== undefined && t > minT && t < best) { best = t; hitTarget = live; }
    }
    for (const obstacle of world.obstacles) {
      const hit = rayBox(o, d, obstacle, best);
      if (hit && hit.t > minT && hit.t < best) { best = hit.t; normal = hit.n; hitTarget = undefined; surface = "wall"; }
    }
    if (d[2] < 0) { const t = -o[2] / d[2]; if (t > minT && t < best) { best = t; normal = [0, 0, 1]; hitTarget = undefined; surface = "ground"; } }
    if (ceiling !== undefined && d[2] > 0) { const t = (ceiling - o[2]) / d[2]; if (t > minT && t < best) { best = t; normal = [0, 0, -1]; hitTarget = undefined; surface = "wall"; } }
    const hitPoint = tmp.o.clone().addScaledVector(tmp.d, best);

    // Muzzle: under the view in FPV, at the nose in third person.
    const muzzle = new THREE.Vector3();
    if (firstPerson || !s) {
      tmp.right.set(1, 0, 0).applyQuaternion(camera.quaternion);
      tmp.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
      muzzle.copy(tmp.o).addScaledVector(tmp.d, 0.9).addScaledVector(tmp.right, 0.24).addScaledVector(tmp.up, -0.3);
    } else muzzle.copy(tmp.drone).addScaledVector(tmp.d, 0.45);
    const tr = fx.tracer[fx.nextTracer]!;
    fx.nextTracer = (fx.nextTracer + 1) % fx.tracer.length;
    tr.from.copy(muzzle);
    tr.dir.copy(hitPoint).sub(muzzle);
    tr.length = tr.dir.length();
    tr.dir.normalize();
    tr.age = 0;
    fx.muzzle.position.copy(muzzle);
    fx.muzzle.quaternion.copy(camera.quaternion);
    fx.muzzle.rotateZ(Math.random() * Math.PI);
    fx.muzzle.scale.setScalar((firstPerson ? 0.05 : 0.32) * (0.8 + Math.random() * 0.5));
    fx.muzzleUntil = r.time + 0.045;

    if (hitTarget) damage(hitTarget, Math.random() < 0.15 ? 2 : 1, hitPoint, Math.random() < 0.15);
    else if (surface !== "sky") spawnSparks(hitPoint, three(normal), 5, surface === "ground" ? "#cbbd9c" : "#fff0a8");

    queueKick([-d[0] * 0.14, -d[1] * 0.14, -d[2] * 0.14]);
    if (effectsEnabled) addTrauma(0.035);
    combatSfx.play("shot");
    r.heat += HEAT_PER_SHOT;
    if (r.heat >= 1) { r.heat = 1; r.overheated = true; emit({ type: "overheat" }); }
  };

  // Fresh stats per world, and never leave HUD state (e.g. overheat) behind.
  useEffect(() => { combatStats.reset(); return () => combatStats.reset(); }, [mapId]);
  // Read-only inspection hook for browser tests and debugging.
  useEffect(() => {
    const hook = {
      targets: () => targets.map((t) => ({ id: t.spec.id, kind: t.spec.kind, alive: t.alive, hp: t.hp, position: t.group ? enu(t.group.position) : t.spec.position, extent: t.group ? new THREE.Box3().setFromObject(t.group).getSize(new THREE.Vector3()).toArray().map((v) => +v.toFixed(1)) : undefined })),
      stats: () => combatStats.get(),
    };
    (window as unknown as { dronelabCombat?: typeof hook }).dronelabCombat = hook;
    return () => { delete (window as unknown as { dronelabCombat?: typeof hook }).dronelabCombat; };
  }, [targets]);

  useFrame(({ camera: cam }, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const r = sim.current;
    r.time += dt;
    const s = state.current;
    // A fresh flight (time went backwards) resets the arena and scores.
    if (s && s.time < r.lastSimTime - 0.5) {
      Object.assign(r, { fireClock: 0, heat: 0, overheated: false, combo: 0, comboTimer: 0, score: 0, kills: 0, killTimes: [], lastImpactStep: -1 });
      for (const live of targets) { live.alive = true; live.hp = maxHp(live.spec); live.pendingDeathAt = Infinity; live.spawnedAt = r.time; if (live.group) { live.group.visible = true; three(live.spec.position, live.group.position); } }
      combatStats.reset();
    }
    const simLive = !!s && s.time > r.lastSimTime && !s.terminated && !s.truncated;
    if (s) r.lastSimTime = s.time;

    // Trigger + heat.
    r.heat = Math.max(0, r.heat - (r.overheated ? HEAT_VENT : HEAT_COOL * (combatInput.trigger ? 0.35 : 1)) * dt);
    if (r.overheated && r.heat < HEAT_RESUME) r.overheated = false;
    if (combatInput.trigger && !r.overheated) {
      r.fireClock += dt;
      while (r.fireClock >= 1 / FIRE_RATE && !r.overheated) { r.fireClock -= 1 / FIRE_RATE; shoot(); }
    } else r.fireClock = 1 / FIRE_RATE;

    // Targets: bob, face the player, flash, respawn, chain deaths, ramming,
    // and Ethereal AI (chase, headbutt/punch with knockback).
    if (s) three(s.position, tmp.drone);
    for (const live of targets) {
      const g = live.group;
      if (!g) continue;
      live.mixer?.update(dt);
      if (!live.alive) {
        if (r.time >= live.respawnAt) {
          live.alive = true; live.hp = maxHp(live.spec); live.spawnedAt = r.time; g.visible = true;
          three(live.spec.position, g.position);
          live.current = undefined;
        }
        continue;
      }
      if (r.time >= live.pendingDeathAt) { explode(live, "chain"); continue; }
      const base = three(live.spec.position, tmp.p);
      const phase = live.spec.id.length * 1.7;
      if (live.spec.kind === "bot") {
        g.position.set(base.x + Math.sin(r.time * 0.6 + phase) * 1.2 * scale, base.y + Math.sin(r.time * 1.3 + phase) * 0.5 * scale, base.z + Math.cos(r.time * 0.5 + phase) * 1.2 * scale);
        g.lookAt(cam.position);
        const halo = g.getObjectByName("halo");
        if (halo) halo.rotation.z = r.time * 2.4;
        if (live.eyes) live.eyes.color.set(live.hp < HP.bot * 0.4 ? "#ff3b5c" : "#ffe14d").multiplyScalar(Math.sin(r.time * 3 + phase) > 0.96 ? 0.1 : 1.6);
      } else if (live.spec.kind === "car" && live.fire) {
        const tick = Math.floor(r.time * 12);
        live.fire.children.forEach((cone, i) => { cone.scale.set(1, 0.75 + ((tick * 7 + i * 13) % 10) / 22, 1); });
      } else if (live.spec.kind === "ethereal" && live.ai && s) {
        const brute = live.spec.boss;
        const toDrone = tmp.s.copy(tmp.drone).sub(g.position);
        if (brute) toDrone.y = 0;
        const dist = toDrone.length();
        // Only hunt while the flight is live, with a short grace period after launch.
        const aggro = simLive && s.time > 3 && dist < (brute ? 45 : 60);
        const hitReacting = r.time - live.ai.hitAt < 0.45;
        const lunging = r.time - live.ai.lungeAt < 0.55;
        if (aggro && !hitReacting) {
          const keep = brute ? 4 : 2.6;
          const speed = brute ? 7.5 : 10;
          if (dist > keep) g.position.addScaledVector(toDrone.normalize(), Math.min(dist - keep, speed * dt));
          if (!brute) g.position.y = THREE.MathUtils.lerp(g.position.y, tmp.drone.y + Math.sin(r.time * 2 + phase) * 0.6, 1 - Math.exp(-dt * 2.5));
          const lowEnough = !brute || tmp.drone.y < 9;
          if (dist < keep + 1.6 && lowEnough && r.time > live.ai.attackReady) {
            live.ai.attackReady = r.time + (brute ? 2.2 : 1.6);
            live.ai.lungeAt = r.time;
            play(live, brute ? "Punch" : "Headbutt", true);
            // The hit lands a beat into the swing: knockback + shake + SFX.
            window.setTimeout(() => {
              const s2 = state.current;
              if (!live.alive || !s2 || !live.group) return;
              const d2 = three(s2.position, new THREE.Vector3()).sub(live.group.position);
              if (d2.length() > (brute ? 7.5 : 4.8)) return;
              const kick = d2.normalize().multiplyScalar(brute ? 26 : 16);
              kick.y += brute ? 10 : 4;
              queueKick(enu(kick));
              if (effectsEnabled) addTrauma(brute ? 0.75 : 0.45, brute ? 1 : 0.5);
              const screen = project(three(s2.position, new THREE.Vector3()));
              emit({ type: "bounce", x: screen.x, y: screen.y, speed: brute ? 40 : 24 });
              combatSfx.play("bounce", brute ? 30 : 18);
            }, brute ? 380 : 260);
          } else if (!lunging) play(live, "Fast_Flying");
        } else if (!hitReacting && !lunging) {
          // Drift home and idle.
          const home = toDrone.copy(base).sub(g.position);
          if (home.length() > 0.5) g.position.addScaledVector(home.normalize(), Math.min(home.length(), 4 * dt));
          if (!brute) g.position.y += Math.sin(r.time * 1.4 + phase) * 0.01;
          play(live, "Flying_Idle");
        }
        tmp.q.setFromAxisAngle(tmp.up.set(0, 1, 0), Math.atan2(tmp.drone.x - g.position.x, tmp.drone.z - g.position.z));
        g.quaternion.slerp(tmp.q, 1 - Math.exp(-dt * 8));
      }
      const spawn = Math.min(1, (r.time - live.spawnedAt) / 0.35);
      const pop = spawn < 1 ? 1 + Math.sin(spawn * Math.PI) * 0.35 : 1;
      g.scale.setScalar((live.spec.kind === "bot" ? scale : 1) * (spawn < 1 ? spawn * pop : 1) * (live.flash > 0 ? 1.08 : 1));
      live.flash = Math.max(0, live.flash - dt);
      for (const m of live.materials) {
        const baseEmissive = (m.userData.baseEmissive as THREE.Color | undefined) ?? (m.userData.baseEmissive = m.emissive.clone());
        if (live.flash > 0) m.emissive.setScalar(0.9); else m.emissive.copy(baseEmissive);
      }
      if (s) {
        const reach = radiusOf(live.spec, scale) + 0.45;
        if (g.position.distanceTo(tmp.drone) < reach + (live.spec.kind === "car" ? 0 : 0) && !(live.spec.kind === "car" && tmp.drone.y > 3.4)) {
          // Ramming detonates a target and bounces the drone off; the brute just shrugs harder.
          const away = tmp.drone.clone().sub(g.position).normalize().multiplyScalar(live.spec.boss ? 20 : 14);
          away.y += 4;
          queueKick(enu(away));
          r.combo += 3;
          r.comboTimer = 2.8;
          if (live.spec.boss) { live.hp -= 12; live.flash = 0.1; if (live.hp <= 0) explode(live, "ram"); }
          else explode(live, "ram");
        }
      }
    }
    // Flying car parts: ballistic, spinning, a little bounce, then gone.
    for (const d of debris) {
      if (d.life <= 0) continue;
      d.life -= dt;
      d.v.y -= 22 * dt;
      d.mesh.position.addScaledVector(d.v, dt);
      if (d.mesh.position.y < 0.3 && d.v.y < 0) { d.mesh.position.y = 0.3; d.v.y *= -0.35; d.v.x *= 0.6; d.v.z *= 0.6; d.spin.multiplyScalar(0.5); }
      d.mesh.rotation.x += d.spin.x * dt; d.mesh.rotation.y += d.spin.y * dt; d.mesh.rotation.z += d.spin.z * dt;
      if (d.life <= 0) d.mesh.visible = false;
    }

    // Bounces from the simulator become reactions: SFX, squash, shake.
    if (s?.impact && s.impact.step !== r.lastImpactStep) {
      const fresh = r.lastImpactStep !== -1 || s.impact.step > 0;
      r.lastImpactStep = s.impact.step;
      if (fresh && s.impact.speed > 3) {
        const screen = project(tmp.drone);
        emit({ type: "bounce", x: screen.x, y: screen.y, speed: s.impact.speed });
        combatSfx.play("bounce", s.impact.speed);
        droneFx.squashAt = performance.now();
        droneFx.squashStrength = Math.min(1, s.impact.speed / 30);
        if (effectsEnabled) addTrauma(Math.min(0.5, s.impact.speed / 60));
        const n = s.impact.normal;
        spawnSparks(tmp.drone.clone().addScaledVector(new THREE.Vector3(n[0], n[2], -n[1]), -0.3), new THREE.Vector3(n[0], n[2], -n[1]), 8, "#fff4df", 6);
      }
    }

    // Combo decay and throttled HUD stats.
    if (r.combo > 0) { r.comboTimer -= dt; if (r.comboTimer <= 0) r.combo = 0; }
    r.statsClock += dt;
    if (r.statsClock > 0.05) {
      r.statsClock = 0;
      combatStats.set({ score: r.score, combo: r.combo, kills: r.kills, heat: r.heat, overheated: r.overheated, comboLeft: Math.max(0, r.comboTimer / 2.8) });
    }

    // Effects.
    fx.explosions.forEach((e) => e.update(dt, cam));
    fx.muzzle.visible = r.time < fx.muzzleUntil;
    for (let i = 0; i < fx.tracer.length; i++) {
      const t = fx.tracer[i]!;
      t.age += dt;
      const head = Math.min(t.length, t.age * 420);
      const tail = Math.max(0, head - 7);
      if (tail >= t.length || t.age > 1) { tmp.m.makeScale(0, 0, 0); fx.tracers.setMatrixAt(i, tmp.m); continue; }
      tmp.p.copy(t.from).addScaledVector(t.dir, tail);
      tmp.q.setFromUnitVectors(tmp.z, t.dir);
      tmp.s.set(0.05, 0.05, Math.max(0.01, head - tail));
      tmp.m.compose(tmp.p, tmp.q, tmp.s);
      fx.tracers.setMatrixAt(i, tmp.m);
    }
    fx.tracers.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < fx.spark.length; i++) {
      const sp = fx.spark[i]!;
      if (sp.life <= 0) { tmp.m.makeScale(0, 0, 0); fx.sparks.setMatrixAt(i, tmp.m); continue; }
      sp.life -= dt;
      sp.v.y -= 18 * dt;
      sp.p.addScaledVector(sp.v, dt);
      tmp.q.setFromUnitVectors(tmp.z, tmp.d.copy(sp.v).normalize());
      tmp.m.compose(sp.p, tmp.q, tmp.s.setScalar(Math.max(0.2, sp.life * 3)));
      fx.sparks.setMatrixAt(i, tmp.m);
      fx.sparks.setColorAt(i, sp.color);
    }
    fx.sparks.instanceMatrix.needsUpdate = true;
    if (fx.sparks.instanceColor) fx.sparks.instanceColor.needsUpdate = true;
  });

  return (
    <>
      <primitive object={root} />
      <primitive object={fx.group} />
      {debris.map((d, i) => <primitive key={i} object={d.mesh} />)}
    </>
  );
}

const CAR_URL = (name: string) => `${import.meta.env.BASE_URL}models/cars/${name}.glb`;
const ETHEREAL_URL = (name: string) => `${import.meta.env.BASE_URL}models/ethereals/${name}.glb`;
const CAR_NAMES = [...new Set(CAR_MODELS)];
const ETHEREAL_NAMES = ["goleling", "squidle", "dragonfly"];
const DEBRIS_NAMES = ["debris-tire", "debris-door", "debris-bumper"];

/** City combat: loads Kenney cars/debris and the Ethereal monsters, then runs the shared combat layer. */
export function CityCombatLayer(props: Omit<Parameters<typeof CombatLayer>[0], "models">) {
  const cars = useGLTF(CAR_NAMES.map(CAR_URL));
  const monsters = useGLTF(ETHEREAL_NAMES.map(ETHEREAL_URL));
  const debris = useGLTF(DEBRIS_NAMES.map(CAR_URL));
  const models = useMemo<CombatModels>(() => ({
    cars: Object.fromEntries(CAR_NAMES.map((n, i) => [n, cars[i]!.scene])),
    ethereals: Object.fromEntries(ETHEREAL_NAMES.map((n, i) => [n, { scene: monsters[i]!.scene, animations: monsters[i]!.animations }])),
    debris: debris.map((d) => d.scene),
  }), [cars, monsters, debris]);
  return <CombatLayer {...props} models={models} />;
}
