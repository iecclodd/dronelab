import type { Obstacle, V3 } from "./index.ts";
import type { FreeWorldDefinition } from "./free-world.ts";

const box = (
  id: string,
  position: V3,
  size: V3,
): Obstacle => ({ id, position, size, kind: "box" });

/** The visible table is a thin top on four narrow legs, never a solid block. */
const table = (id: string, [x, y]: [number, number]): Obstacle[] => [
  box(`${id}-top`, [x, y, 0.72], [3.25, 2.2, 0.12]),
  ...[-1.25, 1.25].flatMap((offsetX) =>
    [-0.75, 0.75].map((offsetY) =>
      box(
        `${id}-leg-${offsetX}-${offsetY}`,
        [x + offsetX, y + offsetY, 0.36],
        [0.22, 0.22, 0.72],
      ),
    ),
  ),
];

/**
 * A compact fan pizzeria in ENU coordinates.  Every item here represents a
 * visible solid in PizzeriaWorld so the physics and the FPV view agree.
 */
export const PIZZERIA_WORLD: FreeWorldDefinition = {
  name: "Freddy’s Pizzeria",
  bounds: 25,
  ceiling: 6,
  spawn: [-15, 0, 1.45],
  landmarks: [
    { id: "stage", name: "Freddy's stage", position: [16.5, 0, 1.1], color: "#f5b94b" },
    { id: "dining", name: "Party tables", position: [2, 0, 1], color: "#d34c63" },
    { id: "arcade", name: "Arcade row", position: [0, 12.4, 1.5], color: "#45cfdf" },
    { id: "office", name: "Security office", position: [-13, 10, 1.3], color: "#8b79dc" },
    { id: "backstage", name: "Backstage", position: [15, -12, 1.4], color: "#b75d83" },
    { id: "exit", name: "EXIT / HOME", position: [-20, 0, 1.6], color: "#71dfa3" },
  ],
  obstacles: [
    // Exterior walls. The front is split at the visible EXIT doorway.
    box("wall-west", [-22, 0, 3], [0.5, 36, 6]),
    box("wall-east", [22, 0, 3], [0.5, 36, 6]),
    box("wall-north", [0, 18, 3], [44, 0.5, 6]),
    box("wall-south-left", [-12.5, -18, 3], [19, 0.5, 6]),
    box("wall-south-right", [12.5, -18, 3], [19, 0.5, 6]),
    // The raised stage and its three physical performers.
    box("stage-platform", [17, 0, 0.45], [7.5, 12, 0.9]),
    box("stage-backdrop", [20.5, 0, 3.1], [0.45, 12, 5.2]),
    box("freddy-torso", [16.8, 0, 1.72], [1.55, 1.5, 2.15]),
    box("freddy-head", [16.8, 0, 3.62], [1.9, 1.8, 1.8]),
    box("freddy-left-arm", [16.8, 1.05, 2.03], [0.7, 0.7, 1.75]),
    box("freddy-right-arm", [16.8, -1.05, 2.03], [0.7, 0.7, 1.75]),
    // Dining furniture: the long central aisle remains clear and more than 2m wide.
    ...table("table-nw", [3, 5.2]),
    ...table("table-ne", [9, 5.2]),
    ...table("table-sw", [3, -5.2]),
    ...table("table-se", [9, -5.2]),
    ...table("table-west", [-5, 5.2]),
    // Arcade cabinets hug the north wall, leaving a wide approach.
    box("arcade-1", [-1, 14.7, 1.45], [1.2, 0.85, 2.9]),
    box("arcade-2", [1.2, 14.7, 1.45], [1.2, 0.85, 2.9]),
    box("arcade-3", [3.4, 14.7, 1.45], [1.2, 0.85, 2.9]),
    box("arcade-4", [5.6, 14.7, 1.45], [1.2, 0.85, 2.9]),
    // Office/corridor loop, intentionally segmented at the two doorways.
    box("office-west", [-17, 10, 3], [0.45, 10, 6]),
    box("office-north", [-13, 15, 3], [8, 0.45, 6]),
    box("office-south-left", [-15.5, 5, 3], [3, 0.45, 6]),
    box("office-south-right", [-10.5, 5, 3], [3, 0.45, 6]),
    box("office-desk", [-13, 11, 1.15], [2.8, 1.1, 2.3]),
    // Backstage uses a pair of short partitions with a broad open entrance.
    box("backstage-north", [14, -10.5, 3], [12, 0.45, 6]),
    box("backstage-west-top", [8, -14.25, 3], [0.45, 7.5, 6]),
    box("backstage-east", [20, -14.25, 3], [0.45, 7.5, 6]),
    box("backstage-crate-a", [12, -14.5, 0.8], [1.8, 1.8, 1.6]),
    box("backstage-crate-b", [17.4, -14.5, 0.8], [1.8, 1.8, 1.6]),
  ],
};
