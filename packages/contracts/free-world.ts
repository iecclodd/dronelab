import type { Obstacle, V3 } from "./index.ts";

export type FreeWorldMapId = "valley" | "pizzeria" | "city";

/**
 * A data-only flight map. Obstacles are the source of truth for both the
 * renderer's opaque structures and Rapier's fixed box colliders.
 */
export interface FreeWorldDefinition {
  name: string;
  /** Horizontal half-extent in metres. The playable square is ±bounds. */
  bounds: number;
  /** Documented altitude ceiling in metres; enforced by the simulator. */
  ceiling: number;
  spawn: V3;
  landmarks: { id: string; name: string; position: V3; color: string }[];
  obstacles: Obstacle[];
}

const box = (
  id: string,
  position: V3,
  size: V3,
  kind: Obstacle["kind"] = "box",
): Obstacle => ({ id, position, size, kind });

const frame = (id: string, position: V3, width: number, height: number) => {
  const [x, y, z] = position;
  const bar = 0.7;
  return [
    box(`${id}-left`, [x - width / 2, y, z], [bar, 1.2, height], "gate"),
    box(`${id}-right`, [x + width / 2, y, z], [bar, 1.2, height], "gate"),
    box(
      `${id}-top`,
      [x, y, z + height / 2 - bar / 2],
      [width + bar, 1.2, bar],
      "gate",
    ),
  ];
};

const forest = [
  [-148, 108], [-128, 142], [-109, 117], [-92, 154], [-70, 132],
  [-152, -111], [-126, -146], [-102, -118], [-78, -154], [-62, -126],
  [92, -132], [117, -153], [138, -113], [158, -145], [171, -92],
  [154, 112], [174, 139], [130, 152], [104, 126], [178, 88],
] as const;

const forestObstacles = forest.flatMap(([x, y], index) => {
  const height = 8 + (index % 3) * 2;
  return [
    box(`forest-${index}-trunk`, [x, y, height / 2], [1.2, 1.2, height]),
    box(
      `forest-${index}-crown`,
      [x, y, height + 2.4],
      [5.4, 5.4, 4.8],
    ),
  ];
});

/** Aster Valley, designed as a long, readable FPV line from the home strip. */
export const FREE_WORLD: FreeWorldDefinition = {
  name: "Aster Valley",
  bounds: 200,
  ceiling: 100,
  spawn: [0, 0, 2],
  landmarks: [
    { id: "home", name: "Aster Airfield", position: [0, 0, 0], color: "#47c7c0" },
    { id: "yard", name: "Mica Yard", position: [62, -43, 4], color: "#e4a849" },
    { id: "canyon", name: "Sundial Canyon", position: [122, 69, 14], color: "#d9784e" },
    { id: "lookout", name: "Kestrel Lookout", position: [151, 103, 22], color: "#78b9ad" },
  ],
  obstacles: [
    // Home is deliberately set off the runway so a new pilot can launch east.
    box("home-hangar", [-26, -21, 5], [22, 16, 10]),
    box("home-workshop", [-15, -36, 3.5], [12, 10, 7]),
    box("home-water-tower", [-38, 18, 8], [5, 5, 16]),
    box("home-solar-shed", [18, -24, 2.5], [14, 7, 5]),

    // A sequence of clean fly-through frames and container gaps in Mica Yard.
    ...frame("yard-frame-a", [36, -18, 5], 11, 10),
    ...frame("yard-frame-b", [55, -30, 6], 13, 12),
    ...frame("yard-frame-c", [74, -43, 7], 15, 14),
    box("yard-container-a", [46, -54, 2.1], [12, 3.2, 4.2]),
    box("yard-container-b", [60, -57, 2.1], [12, 3.2, 4.2]),
    box("yard-container-c", [74, -57, 2.1], [12, 3.2, 4.2]),
    box("yard-container-stack-a", [86, -30, 4.2], [12, 3.2, 8.4]),
    box("yard-container-stack-b", [86, -22, 4.2], [12, 3.2, 8.4]),
    box("yard-crane-column", [55, -63, 9], [2, 2, 18]),
    box("yard-crane-beam", [65, -63, 17], [22, 2, 2]),

    // Sandstone canyon pieces make a broad arch and a low viaduct crossing.
    box("canyon-west-butte", [103, 56, 14], [20, 22, 28]),
    box("canyon-east-butte", [145, 56, 17], [24, 24, 34]),
    box("canyon-arch-left", [112, 78, 10], [7, 9, 20]),
    box("canyon-arch-right", [136, 78, 10], [7, 9, 20]),
    box("canyon-arch-span", [124, 78, 20], [31, 9, 6]),
    box("viaduct-deck", [123, 102, 15], [48, 5, 4]),
    box("viaduct-pier-a", [104, 102, 7], [4, 5, 14]),
    box("viaduct-pier-b", [123, 102, 7], [4, 5, 14]),
    box("viaduct-pier-c", [142, 102, 7], [4, 5, 14]),

    // Kestrel Lookout is a box-built tower with an open perimeter approach.
    box("lookout-leg-nw", [146, 111, 10], [2, 2, 20]),
    box("lookout-leg-ne", [156, 111, 10], [2, 2, 20]),
    box("lookout-leg-sw", [146, 101, 10], [2, 2, 20]),
    box("lookout-leg-se", [156, 101, 10], [2, 2, 20]),
    box("lookout-deck", [151, 106, 20], [14, 14, 2]),
    box("lookout-cabin", [151, 106, 24], [8, 8, 6]),
    ...forestObstacles,
  ],
};
