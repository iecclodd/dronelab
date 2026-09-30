import { describe, expect, it } from "vitest";
import { acroAction, assistedAction, deadzone, horizontalForward } from "../apps/web/src/flight-controls";

describe("flight control helpers", () => {
  it("uses ENU left-positive camera yaw for assisted forward movement", () => {
    const forward = horizontalForward([0, 0, 0, 1], Math.PI / 2);
    expect(forward[0]).toBeCloseTo(0);
    expect(forward.slice(1)).toEqual([1, 0]);
    const action = assistedAction([0, 0, 0, 1], Math.PI / 2, { forward: 1, right: 0, up: 0, yaw: 0 });
    expect(action.kind).toBe("nav");
    if (action.kind === "nav") {
      expect(action.velocity).toEqual([expect.closeTo(0), 7, 0]);
      expect(action.yawRate).toBe(0);
    }
  });

  it("maps assisted strafe to the camera right and clamps yaw", () => {
    expect(assistedAction([0, 0, 0, 1], 0, { forward: 0, right: 1, up: -1, yaw: 4, boost: true })).toEqual({
      kind: "nav", velocity: [0, -13, -13], yawRate: 1.5,
    });
  });

  it("preserves FLU rate axes and clamps manual throttle", () => {
    expect(acroAction({ roll: 2, pitch: -0.5, yaw: -2 }, 1.4)).toEqual({
      kind: "rate", rates: [1, -0.5, -1], thrust: 1,
    });
  });

  it("removes gamepad center noise and rescales outer travel", () => {
    expect(deadzone(0.12)).toBe(0);
    expect(deadzone(-0.56)).toBeCloseTo(-0.5);
    expect(deadzone(1)).toBe(1);
  });
});
