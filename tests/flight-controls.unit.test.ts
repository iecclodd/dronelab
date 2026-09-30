import { describe, expect, it } from "vitest";
import {
  acroAction,
  assistedAction,
  assistedSpeeds,
  deadzone,
  flightForward,
  horizontalForward,
  keyboardFlightAxes,
  levelFlightQuaternion,
  mode2Axes,
} from "../apps/web/src/flight-controls";

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

  it("applies yaw in the banked airframe frame rather than around world up", () => {
    const pitchDown45: [number, number, number, number] = [0, Math.sin(Math.PI / 8), 0, Math.cos(Math.PI / 8)];
    const forward = horizontalForward(pitchDown45, Math.PI / 4);
    expect(forward[0]).toBeCloseTo(1 / Math.sqrt(3));
    expect(forward[1]).toBeCloseTo(Math.sqrt(2 / 3));
    expect(flightForward([0, 0, 0, 1], 0, Math.PI / 2)).toEqual([
      expect.closeTo(0),
      0,
      expect.closeTo(1),
    ]);
  });

  it("maps assisted strafe to the camera right and clamps yaw", () => {
    expect(assistedAction([0, 0, 0, 1], 0, { forward: 0, right: 1, up: -1, yaw: 4, boost: true })).toEqual({
      kind: "nav", velocity: [0, -13, -13], yawRate: 1.5,
    });
  });

  it("uses fast map-aware arcade setpoints while omitted profiles retain research speeds", () => {
    expect(assistedSpeeds()).toEqual({ cruise: 7, boost: 13 });
    expect(assistedSpeeds("arcade", "valley")).toEqual({ cruise: 18, boost: 30 });
    expect(assistedSpeeds("arcade", "pizzeria")).toEqual({ cruise: 10, boost: 16 });
    expect(
      assistedAction([0, 0, 0, 1], 0, {
        forward: 1,
        right: 0,
        up: 0,
        yaw: 0,
        boost: true,
        flightFeel: "arcade",
        mapId: "valley",
      }),
    ).toMatchObject({ kind: "nav", velocity: [30, 0, 0] });
  });

  it("levels arcade Assisted steering while retaining ENU heading and mouse look", () => {
    const multiply = (a: [number, number, number, number], b: [number, number, number, number]) => [
      a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
      a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
      a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
      a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ] as [number, number, number, number];
    const yaw = 0.8;
    const pitchedRolled = multiply(
      multiply(
        [0, 0, Math.sin(yaw / 2), Math.cos(yaw / 2)],
        [0, Math.sin(0.64), 0, Math.cos(0.64)],
      ),
      [Math.sin(0.38), 0, 0, Math.cos(0.38)],
    );
    const leveled = levelFlightQuaternion(pitchedRolled);
    const rawForward = flightForward(pitchedRolled);
    const levelForward = flightForward(leveled);
    expect(leveled.slice(0, 2)).toEqual([0, 0]);
    expect(leveled[2]).toBeCloseTo(Math.sin(Math.atan2(rawForward[1], rawForward[0]) / 2));
    expect(leveled[3]).toBeCloseTo(Math.cos(Math.atan2(rawForward[1], rawForward[0]) / 2));
    expect(levelForward[2]).toBeCloseTo(0);

    const lookYaw = 0.45;
    const lookPitch = -0.3;
    const expectedForward = horizontalForward(leveled, lookYaw, lookPitch);
    const action = assistedAction(
      pitchedRolled,
      lookYaw,
      { forward: 1, right: 0, up: 0, yaw: 0, flightFeel: "arcade" },
      lookPitch,
    );
    expect(action).toMatchObject({
      kind: "nav",
      velocity: [expectedForward[0] * 18, expectedForward[1] * 18, 0],
    });
  });

  it("keeps research steering math plus vertical and yaw axes unchanged", () => {
    const pitched = [0, Math.sin(Math.PI / 8), 0, Math.cos(Math.PI / 8)] as [number, number, number, number];
    const lookYaw = Math.PI / 4;
    const expectedResearchForward = horizontalForward(pitched, lookYaw);
    expect(
      assistedAction(pitched, lookYaw, { forward: 1, right: 0, up: 0, yaw: 0 }),
    ).toMatchObject({
      kind: "nav",
      velocity: [expectedResearchForward[0] * 7, expectedResearchForward[1] * 7, 0],
    });
    const verticalArcade = assistedAction(pitched, lookYaw, {
      forward: 0,
      right: 0,
      up: -0.5,
      yaw: -0.7,
      flightFeel: "arcade",
    });
    expect(verticalArcade).toMatchObject({ kind: "nav", velocity: [0, 0, -9] });
    expect(verticalArcade.kind === "nav" && verticalArcade.yawRate).toBeCloseTo(-1.05);
  });

  it("preserves FLU rate axes and clamps manual throttle", () => {
    expect(acroAction({ roll: 2, pitch: 0.5, yaw: -2 }, 1.4)).toEqual({
      kind: "rate", rates: [1, 0.5, -1], thrust: 1,
    });
    expect(assistedAction([0, 0, 0, 1], 0, { forward: 0, right: 0, up: 0, yaw: -1 })).toMatchObject({
      kind: "nav", yawRate: -1.5,
    });
  });

  it("removes gamepad center noise and rescales outer travel", () => {
    expect(deadzone(0.12)).toBe(0);
    expect(deadzone(-0.56)).toBeCloseTo(-0.5);
    expect(deadzone(1)).toBe(1);
  });

  it("uses conventional Mode 2 yaw, throttle, roll, and pitch axes", () => {
    expect(mode2Axes([0.5, -0.5, 0.25, -0.75], [], 0)).toEqual({
      yaw: -0.5,
      throttle: 0.5,
      roll: 0.25,
      pitch: 0.75,
    });
    expect(mode2Axes([0.4, 0, 0, 0], [0.4, 0, 0, 0], 0)).toMatchObject({ yaw: 0 });
  });

  it("maps every keyboard flight axis, arrows, and both Shift keys without opposing-axis leaks", () => {
    expect(keyboardFlightAxes(new Set(["KeyW", "KeyD", "Space", "KeyQ", "ControlLeft"]))).toEqual({
      forward: 1, right: 1, up: 1, yaw: 1, boost: true,
    });
    expect(keyboardFlightAxes(new Set(["KeyS", "KeyA", "ShiftRight", "KeyE"]))).toEqual({
      forward: -1, right: -1, up: -1, yaw: -1, boost: false,
    });
    expect(keyboardFlightAxes(new Set(["ArrowUp", "ArrowRight", "ShiftLeft"]))).toMatchObject({
      forward: 1, right: 1, up: -1,
    });
    expect(keyboardFlightAxes(new Set(["Space", "ShiftLeft", "ShiftRight"]))).toMatchObject({ up: 0 });
    expect(keyboardFlightAxes(new Set(["KeyW", "KeyS", "KeyA", "KeyD", "KeyQ", "KeyE"]))).toMatchObject({
      forward: 0, right: 0, yaw: 0,
    });
  });
});
