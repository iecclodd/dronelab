import * as THREE from "three";

/**
 * Visibility culling for dense maps (Lumina District).
 *
 * 1. Frustum: bounding-sphere test against the camera frustum. This matters
 *    for skinned monsters, which can't use three's automatic culling because
 *    their geometry bounds don't follow the skeleton.
 * 2. Occlusion: CPU "software occluders". The city's towers are large
 *    axis-aligned boxes, so each candidate casts a few rays from the camera
 *    to sample points on its bounds; if every ray is blocked by a tower it's
 *    hidden. A Manhattan grid is the textbook case for this: from street
 *    level, most of the city is behind the canyon walls.
 *
 * Culled objects move to layer HIDDEN_LAYER instead of `visible = false`.
 * The main camera (colour and ink passes) only renders layer 0, while
 * shadow cameras enable HIDDEN_LAYER too, so hidden towers still cast the
 * shadows you can see. Recently-seen objects stay visible briefly
 * (hysteresis) to avoid popping at edges.
 */
export const HIDDEN_LAYER = 1;
const SHOW_FOR = 0.25;

export interface Cullable {
  object: THREE.Object3D;
  /** World-space bounding sphere; `update` refreshes it for moving objects. */
  center: THREE.Vector3;
  radius: number;
  /** Sample points relative to the centre for occlusion rays (default: centre + ring). */
  samples?: THREE.Vector3[];
  /** Index of the occluder this object *is* (a building), skipped in its own tests. */
  selfOccluder?: number;
  update?: (c: Cullable) => void;
  /** Written by the system. */
  visible: boolean;
  lastSeen: number;
  distance: number;
}

const cullables = new Set<Cullable>();
const occluders: THREE.Box3[] = [];

export const visibility = {
  register(c: Omit<Cullable, "visible" | "lastSeen" | "distance">): Cullable {
    const entry = { ...c, visible: true, lastSeen: -Infinity, distance: 0 } as Cullable;
    cullables.add(entry);
    return entry;
  },
  unregister(c: Cullable) {
    cullables.delete(c);
    setLayer(c.object, true);
  },
  /** Replace the occluder set (world-space boxes, Three coords). Returns their indices. */
  setOccluders(boxes: THREE.Box3[]) {
    occluders.length = 0;
    // Shrink slightly so rays grazing an edge count as visible (conservative).
    for (const b of boxes) occluders.push(b.clone().expandByScalar(-0.6));
  },
  clearOccluders() { occluders.length = 0; },
  stats: { tested: 0, hidden: 0, frustum: 0, occluded: 0 },
};

function setLayer(object: THREE.Object3D, show: boolean) {
  object.traverse((o) => { if (show) o.layers.set(0); else o.layers.set(HIDDEN_LAYER); });
}

const frustum = new THREE.Frustum();
const matrix = new THREE.Matrix4();
const sphere = new THREE.Sphere();
const ray = new THREE.Ray();
const point = new THREE.Vector3();
const toPoint = new THREE.Vector3();
const hit = new THREE.Vector3();
const DEFAULT_SAMPLES = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.8, 0), new THREE.Vector3(0.7, 0, 0), new THREE.Vector3(-0.7, 0, 0), new THREE.Vector3(0, 0, 0.7), new THREE.Vector3(0, 0, -0.7)];

function blocked(from: THREE.Vector3, to: THREE.Vector3, skip: number | undefined) {
  toPoint.subVectors(to, from);
  const length = toPoint.length();
  if (length < 1e-3) return false;
  ray.set(from, toPoint.divideScalar(length));
  for (let i = 0; i < occluders.length; i++) {
    if (i === skip) continue;
    const box = occluders[i]!;
    if (box.containsPoint(from)) continue;
    if (ray.intersectBox(box, hit) && hit.distanceToSquared(from) < (length - 0.5) ** 2) return true;
  }
  return false;
}

/** Sphere visibility against the frustum/occluders from the latest update (for batched effects). */
export function isSphereVisible(center: THREE.Vector3, radius: number) {
  sphere.set(center, radius);
  if (!frustum.intersectsSphere(sphere)) return false;
  if (!occluders.length) return true;
  for (const s of DEFAULT_SAMPLES) {
    point.copy(s).multiplyScalar(radius).add(center);
    if (!blocked(lastEye, point, undefined)) return true;
  }
  return false;
}
const lastEye = new THREE.Vector3();

/** Run once per frame before rendering. */
export function updateVisibility(camera: THREE.Camera, time: number) {
  camera.updateMatrixWorld();
  matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(matrix);
  const eye = camera.position;
  lastEye.copy(eye);
  const stats = visibility.stats;
  stats.tested = stats.hidden = stats.frustum = stats.occluded = 0;
  for (const c of cullables) {
    c.update?.(c);
    stats.tested++;
    c.distance = c.center.distanceTo(eye);
    sphere.set(c.center, c.radius);
    let seen = frustum.intersectsSphere(sphere);
    if (!seen) stats.frustum++;
    else if (occluders.length && c.distance > c.radius) {
      seen = false;
      for (const s of c.samples ?? DEFAULT_SAMPLES) {
        point.copy(s).multiplyScalar(c.samples ? 1 : c.radius).add(c.center);
        if (!blocked(eye, point, c.selfOccluder)) { seen = true; break; }
      }
      if (!seen) stats.occluded++;
    }
    if (seen) c.lastSeen = time;
    const show = seen || time - c.lastSeen < SHOW_FOR;
    if (show !== c.visible) { c.visible = show; setLayer(c.object, show); }
    if (!show) stats.hidden++;
  }
}
