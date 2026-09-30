import type { Obstacle, V3 } from "./index.ts";
import type { FreeWorldDefinition } from "./free-world.ts";

/**
 * Lumina District: a ruined, burning Manhattan-style grid inside a Hollow.
 * Buildings are Kenney City Kit (CC0) models placed on the grid; every
 * placement also produces the box collider sim-core uses, cut down to the
 * break height for collapsed towers, so physics and visuals agree.
 *
 * Grid (ENU): avenues run north–south at x = -88, -44, 0, 44, 88 (16 m wide);
 * streets run east–west at y = -96 … 96 every 32 m (12 m wide).
 */

/** Kenney model bounds in model space (Three: x, y up, z), unscaled. */
export const CITY_MODEL_BOUNDS: Record<string, { min: V3; max: V3 }> = {
  "building-a": { min: [-0.44, 0, -0.47], max: [0.44, 1.29, 0.47] },
  "building-e": { min: [-0.82, 0, -0.5], max: [0.82, 0.89, 0.5] },
  "building-g": { min: [-0.49, 0, -0.46], max: [0.49, 1.69, 0.46] },
  "building-i": { min: [-0.62, 0, -0.65], max: [0.62, 1.68, 0.65] },
  "building-j": { min: [-1.04, 0, -0.67], max: [1.04, 1.69, 0.67] },
  "building-l": { min: [-0.69, 0, -0.7], max: [0.69, 2.27, 0.7] },
  "building-m": { min: [-0.62, 0, -0.62], max: [0.62, 3.15, 0.62] },
  "building-n": { min: [-1.16, 0, -0.91], max: [1.16, 2.48, 0.91] },
  "building-skyscraper-a": { min: [-0.68, 0, -0.68], max: [0.68, 2.88, 0.68] },
  "building-skyscraper-b": { min: [-0.68, 0, -0.68], max: [0.68, 4.48, 0.68] },
  "building-skyscraper-d": { min: [-0.64, 0, -0.69], max: [0.64, 5.47, 0.69] },
  "building-skyscraper-e": { min: [-0.65, 0, -0.62], max: [0.65, 4.08, 0.62] },
};

export interface CityPlacement {
  id: string;
  model: string;
  /** ENU centre of the model origin (base centre). */
  x: number;
  y: number;
  /** Quarter turns CCW from above; 0 faces south (-y). */
  rot: 0 | 1 | 2 | 3;
  scale: number;
  /** Fraction of height still standing (collapsed tower), 1 = intact. */
  keep: number;
  /** Intact roofs carry an iconic wooden water tank. */
  tank: boolean;
  /** Billboard-lined landmark towers around the rift crossing. */
  billboards: boolean;
}

export const CITY_AVENUES = [-88, -44, 0, 44, 88];
export const CITY_STREETS = [-96, -64, -32, 0, 32, 64, 96];
export const CITY_BOUNDS = 110;

const hash = (a: number, b: number) => {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
};
const TOWERS = ["building-skyscraper-b", "building-skyscraper-d", "building-skyscraper-e", "building-skyscraper-a", "building-m", "building-l"];
const LOWS = ["building-a", "building-g", "building-i"];

function buildPlacements(): CityPlacement[] {
  const out: CityPlacement[] = [];
  const blockXs = [-66, -22, 22, 66];
  const blockYs = [-80, -48, -16, 16, 48, 80];
  blockXs.forEach((cx, i) => blockYs.forEach((cy, j) => {
    const r = hash(i + 1, j + 1);
    const facing: 0 | 2 = cy < 0 ? 2 : 0;
    const landmark = Math.abs(cx) === 22 && Math.abs(cy) === 16;
    if (landmark) {
      out.push({ id: `city-${i}-${j}`, model: j % 2 ? "building-skyscraper-d" : "building-skyscraper-b", x: cx, y: cy, rot: facing, scale: 13, keep: 1, tank: false, billboards: true });
      return;
    }
    if (r < 0.68) {
      const model = TOWERS[Math.floor(hash(j + 3, i + 7) * TOWERS.length)]!;
      const broken = hash(i + 11, j + 5) < 0.42;
      out.push({
        id: `city-${i}-${j}`, model, x: cx, y: cy, rot: facing, scale: 12.5,
        keep: broken ? 0.38 + hash(i, j + 9) * 0.3 : 1, tank: !broken && hash(i + 2, j) < 0.7, billboards: false,
      });
    } else {
      [-7, 7].forEach((dx, k) => {
        const model = LOWS[Math.floor(hash(i + k * 5, j + 2) * LOWS.length)]!;
        const broken = hash(i + k + 21, j + 3) < 0.3;
        out.push({
          id: `city-${i}-${j}-${k}`, model, x: cx + dx, y: cy, rot: facing, scale: model === "building-i" ? 9.6 : 11,
          keep: broken ? 0.5 + hash(k, j + i) * 0.25 : 1, tank: !broken && hash(k + 4, i + j) < 0.6, billboards: false,
        });
      });
    }
  }));
  return out;
}

export const CITY_PLACEMENTS: CityPlacement[] = buildPlacements();

/** ENU axis-aligned footprint + height of a placement, after rotation and collapse. */
export function placementBox(p: CityPlacement): { position: V3; size: V3; height: number } {
  const b = CITY_MODEL_BOUNDS[p.model]!;
  // Model space Three (x, z) → ENU (x, -z), then quarter-turn rotation.
  const corners: [number, number][] = [[b.min[0], -b.max[2]], [b.max[0], -b.min[2]]];
  const rotated = corners.map(([x, y]) => {
    let rx = x, ry = y;
    for (let k = 0; k < p.rot; k++) [rx, ry] = [-ry, rx];
    return [rx * p.scale, ry * p.scale] as [number, number];
  });
  const minX = Math.min(rotated[0]![0], rotated[1]![0]), maxX = Math.max(rotated[0]![0], rotated[1]![0]);
  const minY = Math.min(rotated[0]![1], rotated[1]![1]), maxY = Math.max(rotated[0]![1], rotated[1]![1]);
  const height = b.max[1] * p.scale * p.keep;
  return {
    position: [p.x + (minX + maxX) / 2, p.y + (minY + maxY) / 2, height / 2],
    size: [maxX - minX, maxY - minY, height],
    height,
  };
}

const box = (id: string, position: V3, size: V3): Obstacle => ({ id, position, size, kind: "box" });

/** Rubble mounds choking the streets (solid), and rooftop water tanks. */
export const CITY_RUBBLE: { id: string; position: V3; size: V3 }[] = [
  { id: "rubble-1", position: [-60, 32, 1.6], size: [9, 7, 3.2] },
  { id: "rubble-2", position: [20, -32, 1.4], size: [7, 6, 2.8] },
  { id: "rubble-3", position: [-44, 40, 2], size: [10, 8, 4] },
  { id: "rubble-4", position: [44, 20, 1.5], size: [8, 9, 3] },
  { id: "rubble-5", position: [66, 64, 1.8], size: [11, 6, 3.6] },
  { id: "rubble-6", position: [-22, -64, 1.3], size: [7, 6, 2.6] },
  { id: "rubble-7", position: [88, -40, 2.2], size: [9, 10, 4.4] },
  { id: "rubble-8", position: [-88, -72, 1.6], size: [8, 8, 3.2] },
];

function tankBox(p: CityPlacement): Obstacle {
  const { height } = placementBox(p);
  return box(`tank-${p.id}`, [p.x, p.y, height + 3.4], [4.4, 4.4, 6.8]);
}

export const CITY_WORLD: FreeWorldDefinition = {
  name: "Lumina District",
  bounds: CITY_BOUNDS,
  ceiling: 120,
  // West end of the central cross street, looking east down the canyon at the rift.
  spawn: [-104, 0, 8],
  landmarks: [
    { id: "gate", name: "West Gate", position: [-104, 0, 4], color: "#ffb13b" },
    { id: "rift", name: "Rift Crossing", position: [0, 0, 30], color: "#c04bff" },
    { id: "canyon", name: "Midtown Canyon", position: [-44, 64, 24], color: "#ff5a3d" },
    { id: "ruins", name: "Tower Ruins", position: [44, -64, 30], color: "#ffd23f" },
    { id: "yard", name: "East Yard", position: [98, 90, 10], color: "#3fe0d0" },
  ],
  obstacles: [
    ...CITY_PLACEMENTS.map((p) => { const b = placementBox(p); return box(p.id, b.position, b.size); }),
    ...CITY_PLACEMENTS.filter((p) => p.tank).map(tankBox),
    ...CITY_RUBBLE.map((r) => box(r.id, r.position, r.size)),
  ],
};
