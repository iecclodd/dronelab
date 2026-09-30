import type { Obstacle, V3 } from "./index.ts";
import type { FreeWorldDefinition } from "./free-world.ts";

const box = (
  id: string,
  position: V3,
  size: V3,
): Obstacle => ({ id, position, size, kind: "box" });

/**
 * A compact fan pizzeria in ENU coordinates.  Every item here represents a
 * visible solid in PizzeriaWorld so the physics and the FPV view agree.
 */
export const PIZZERIA_WORLD: FreeWorldDefinition = {
  name: "Fazbear Fan Pizzeria",
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
    box("freddy-torso", [16.8, 0, 2.15], [1.7, 1.45, 2.35]),
    box("freddy-head", [16.8, 0, 3.8], [1.9, 1.7, 1.65]),
    box("freddy-left-arm", [16.8, 1.25, 2.15], [0.75, 0.65, 2.1]),
    box("freddy-right-arm", [16.8, -1.25, 2.15], [0.75, 0.65, 2.1]),
    // Dining furniture: the long central aisle remains clear and more than 2m wide.
    box("table-nw", [3, 5.2, 0.72], [3.6, 2.5, 1.44]),
    box("table-ne", [9, 5.2, 0.72], [3.6, 2.5, 1.44]),
    box("table-sw", [3, -5.2, 0.72], [3.6, 2.5, 1.44]),
    box("table-se", [9, -5.2, 0.72], [3.6, 2.5, 1.44]),
    box("table-west", [-5, 0, 0.72], [3.3, 2.7, 1.44]),
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
