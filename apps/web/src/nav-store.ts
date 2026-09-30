/**
 * Tiny shared store for exploration UX. GameOverlay owns the waypoint and
 * visit state; the 3D scene reads it for beacons and writes back the screen
 * projection of the active landmark for the HUD marker. Nothing here feeds
 * the simulator.
 */
export interface NavState {
  worldId: "valley" | "pizzeria" | "city";
  waypoint: number;
  visited: readonly string[];
}

let state: NavState = { worldId: "valley", waypoint: 1, visited: [] };
const listeners = new Set<() => void>();

export const navStore = {
  get: () => state,
  set(next: Partial<NavState>) {
    state = { ...state, ...next };
    listeners.forEach((listener) => listener());
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
};

/** Written by the scene every frame; read by the HUD marker's rAF loop. */
export const navMarker = { x: 0.5, y: 0.5, onScreen: false, active: false, distance: 0, angle: 0 };
