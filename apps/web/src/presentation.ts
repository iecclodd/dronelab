import * as THREE from "three";
import type { PhysicalState } from "../../../packages/contracts";

/**
 * Render-side smoothing of the simulator pose. The worker publishes a state
 * every ~33 ms (with timer jitter), while the screen refreshes at 60+ Hz, so
 * drawing raw states steps the camera by up to ~2 m per update at arcade
 * speeds. This predicts forward from the latest state's velocity, and when a
 * new state lands it blends the old/new difference out over a few frames
 * rather than snapping. Presentation only; the simulator is untouched.
 */
const basis = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
const basisInverse = basis.clone().invert();

export const presented = {
  valid: false,
  /** Three.js coordinates (x east, y up, z south). */
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
  step: -1,
  time: -1,
};

const base = new THREE.Vector3();
const velocity = new THREE.Vector3();
const error = new THREE.Vector3();
const target = new THREE.Quaternion();
const predicted = new THREE.Vector3();
let receivedAt = 0;

const toThree = (v: readonly number[], out: THREE.Vector3) => out.set(v[0]!, v[2]!, -v[1]!);

let lastState: PhysicalState | undefined;

export function updatePresentation(state: PhysicalState | undefined, now: number, dt: number) {
  if (!state) { presented.valid = false; lastState = undefined; return; }
  // Every published state is a new object; identity catches resets and world
  // switches even when step and time are unchanged (both 0 before takeoff).
  const fresh = state !== lastState;
  lastState = state;
  if (fresh) {
    const before = presented.position.clone();
    toThree(state.position, base);
    // A reset, world switch or replay jump: snap instead of smoothing across it.
    const discontinuity = !presented.valid || state.time < presented.time || Math.abs(state.step - presented.step) > 40 || before.distanceTo(base) > 12;
    toThree(state.velocity, velocity);
    receivedAt = now;
    presented.step = state.step;
    presented.time = state.time;
    target.set(...state.quaternion).premultiply(basis).multiply(basisInverse);
    if (discontinuity) {
      error.set(0, 0, 0);
      presented.quaternion.copy(target);
    } else {
      error.copy(before).sub(base);
      if (error.lengthSq() > 25) error.set(0, 0, 0);
    }
    presented.valid = true;
  }
  // Extrapolate briefly, then ease back to the last state if updates stall
  // (pause, replay, tab throttling) so a paused drone never drifts.
  const age = (now - receivedAt) / 1000;
  const lead = age < 0.08 ? age : Math.max(0, 0.16 - age);
  predicted.copy(base).addScaledVector(velocity, lead);
  error.multiplyScalar(Math.exp(-dt * 16));
  presented.position.copy(predicted).add(error);
  presented.quaternion.slerp(target, 1 - Math.exp(-dt * 26));
}
