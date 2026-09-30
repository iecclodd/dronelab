import type { V3 } from "../../../packages/contracts";

/**
 * Shared combat state for Explore. Input (flight-controls) writes the trigger
 * and dash; the 3D CombatLayer resolves shots, targets and explosions; the
 * HUD subscribes to events and the throttled stats snapshot. Kicks to the
 * drone (recoil, knockback, dash) are queued here and delivered to the
 * simulator inside the next action as a one-shot `impulse`.
 */

export const combatInput = { trigger: false };

const pendingKick: V3 = [0, 0, 0];
let pulse = 0;
export function queueKick(v: V3) {
  pendingKick[0] += v[0];
  pendingKick[1] += v[1];
  pendingKick[2] += v[2];
}
/** Returns the queued kick (clamped to the contract limit) and clears it. */
export function takeKick(): { impulse: V3; pulse: number } | undefined {
  const size = Math.hypot(...pendingKick);
  if (size < 0.05) return undefined;
  const scale = size > 39.5 ? 39.5 / size : 1;
  const impulse: V3 = [pendingKick[0] * scale, pendingKick[1] * scale, pendingKick[2] * scale];
  pendingKick[0] = pendingKick[1] = pendingKick[2] = 0;
  pulse += 1;
  return { impulse, pulse };
}

export type CombatEvent =
  | { type: "hit"; x: number; y: number; damage: number; crit: boolean }
  | { type: "kill"; x: number; y: number; score: number; big: boolean }
  | { type: "multikill"; count: number }
  | { type: "dash" }
  | { type: "bounce"; x: number; y: number; speed: number }
  | { type: "overheat" }
  | { type: "blast"; x: number; y: number };

const listeners = new Set<(event: CombatEvent) => void>();
export const combatEvents = {
  emit(event: CombatEvent) { listeners.forEach((listener) => listener(event)); },
  subscribe(listener: (event: CombatEvent) => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
};

export interface CombatStats {
  score: number;
  combo: number;
  kills: number;
  heat: number;
  overheated: boolean;
  /** 0..1 time left before the combo drops. */
  comboLeft: number;
}
let stats: CombatStats = { score: 0, combo: 0, kills: 0, heat: 0, overheated: false, comboLeft: 0 };
const statListeners = new Set<() => void>();
export const combatStats = {
  get: () => stats,
  set(next: Partial<CombatStats>) {
    stats = { ...stats, ...next };
    statListeners.forEach((listener) => listener());
  },
  reset() { combatStats.set({ score: 0, combo: 0, kills: 0, heat: 0, overheated: false, comboLeft: 0 }); },
  subscribe(listener: () => void) {
    statListeners.add(listener);
    return () => { statListeners.delete(listener); };
  },
};

/** ZZZ-style rank letter from the running combo. */
export function comboRank(combo: number) {
  return combo >= 120 ? "SS" : combo >= 70 ? "S" : combo >= 40 ? "A" : combo >= 20 ? "B" : combo >= 8 ? "C" : "D";
}

/** Camera trauma (Vlambeer-style): shake = trauma², decays each frame. */
export const cameraShake = { trauma: 0, punch: 0 };
export function addTrauma(amount: number, punch = 0) {
  cameraShake.trauma = Math.min(1, cameraShake.trauma + amount);
  cameraShake.punch = Math.max(cameraShake.punch, punch);
}

/** Audio sink registered by App (keeps combat code free of audio lifecycle). */
export const combatSfx: { play: (kind: "shot" | "hit" | "dash" | "boom" | "bounce", strength?: number) => void } = { play: () => undefined };

/** Bounce squash-and-stretch for the drone model (set on sim impacts). */
export const droneFx = { squashAt: -1e9, squashStrength: 0 };
