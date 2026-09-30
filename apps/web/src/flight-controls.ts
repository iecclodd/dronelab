import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { ACTION_REPEAT, DT, type Action, type ControllerId, type FlightFeel, type PhysicalState, type Q4, type V3 } from "../../../packages/contracts";
import { combatEvents, combatInput, queueKick, takeKick } from "./combat-store";

/**
 * `yaw`/`pitch` are relative to the airframe heading. In arcade Explore the
 * camera also owns an absolute ENU heading, `world`; `yaw` is then derived
 * from it each frame, and the airframe chases it.
 */
export type FlightLook = { yaw: number; pitch: number; world?: number };

const DEADZONE = 0.12;
const MAX_LOOK_PITCH = (80 * Math.PI) / 180;
const RESEARCH_NAV_SPEED = 7;
const RESEARCH_BOOST_SPEED = 13;
const ARCADE_OUTDOOR_NAV_SPEED = 20;
const ARCADE_OUTDOOR_BOOST_SPEED = 32;
const ARCADE_INDOOR_NAV_SPEED = 11;
const ARCADE_INDOOR_BOOST_SPEED = 17;
/** Arcade dash (Shift tap): a one-shot kick in the move/aim direction. */
const DASH_KICK = 19;
const DASH_COOLDOWN = 0.6;
/** Keyboard turning (Q/E) of the camera, which the drone then follows. */
const KEY_TURN_RATE = 2.4;
/** How hard the drone's heading chases the camera's (rad/s per rad of error). */
const HEADING_FOLLOW_GAIN = 8;
const HOVER_THRUST = 0.42;
const THROTTLE_RATE = 0.38;
const BASE_MOUSE_SENSITIVITY = 0.0024;
const DEFAULT_CAMERA_TILT = 15;
const ACTION_SEND_PERIOD = DT * ACTION_REPEAT * 2;

export const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

/** Removes controller-center noise while preserving the full travel at the edge. */
export function deadzone(value: number, amount = DEADZONE): number {
  const limited = clamp(value, -1, 1);
  if (Math.abs(limited) <= amount) return 0;
  return (Math.abs(limited) - amount) / (1 - amount) * Math.sign(limited);
}

type Quat = [number, number, number, number];

const quaternionProduct = (a: Q4, b: Q4): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

const axisAngle = (axis: V3, angle: number): Quat => {
  const half = angle / 2;
  const sin = Math.sin(half);
  return [axis[0] * sin, axis[1] * sin, axis[2] * sin, Math.cos(half)];
};

const rotate = (q: Q4, [x, y, z]: V3): V3 => {
  const [qx, qy, qz, qw] = q;
  const uv: V3 = [qy * z - qz * y, qz * x - qx * z, qx * y - qy * x];
  const uuv: V3 = [
    qy * uv[2] - qz * uv[1],
    qz * uv[0] - qx * uv[2],
    qx * uv[1] - qy * uv[0],
  ];
  return [
    x + 2 * (qw * uv[0] + uuv[0]),
    y + 2 * (qw * uv[1] + uuv[1]),
    z + 2 * (qw * uv[2] + uuv[2]),
  ];
};

/** Camera forward in ENU from FLU body orientation and local FPV look offsets. */
export function flightForward(
  quaternion: Q4,
  lookYaw = 0,
  lookPitch = 0,
): V3 {
  const yaw = axisAngle([0, 0, 1], lookYaw);
  // Camera pitch rotates around its right axis (-body y): positive looks up.
  const pitch = axisAngle([0, -1, 0], lookPitch);
  return rotate(quaternionProduct(quaternionProduct(quaternion, yaw), pitch), [1, 0, 0]);
}

/** ENU horizontal FPV forward, with yaw applied in the airframe's local frame. */
export function horizontalForward(
  quaternion: Q4,
  lookYaw = 0,
  lookPitch = 0,
): V3 {
  const [bodyX, bodyY] = flightForward(quaternion, lookYaw, lookPitch);
  const length = Math.hypot(bodyX, bodyY);
  const east = length > 1e-6 ? bodyX / length : 1;
  const north = length > 1e-6 ? bodyY / length : 0;
  return [east, north, 0];
}

/**
 * Removes bank and pitch while retaining the FLU forward axis's ENU heading.
 * Arcade Assisted uses this for movement so its horizon can stay readable
 * while mouse look remains relative to the rendered camera rig.
 */
export function levelFlightQuaternion(quaternion: Q4): Q4 {
  const forward = rotate(quaternion, [1, 0, 0]);
  const heading = Math.atan2(forward[1], forward[0]);
  const half = heading / 2;
  return [0, 0, Math.sin(half), Math.cos(half)];
}

/** Player-facing setpoints. The simulator independently enforces its profile cap. */
export function assistedSpeeds(
  flightFeel: FlightFeel = "research",
  mapId?: "valley" | "pizzeria",
) {
  if (flightFeel !== "arcade")
    return { cruise: RESEARCH_NAV_SPEED, boost: RESEARCH_BOOST_SPEED };
  return mapId === "pizzeria"
    ? { cruise: ARCADE_INDOOR_NAV_SPEED, boost: ARCADE_INDOOR_BOOST_SPEED }
    : { cruise: ARCADE_OUTDOOR_NAV_SPEED, boost: ARCADE_OUTDOOR_BOOST_SPEED };
}

export function assistedAction(
  quaternion: Q4,
  lookYaw: number,
  input: {
    forward: number;
    right: number;
    up: number;
    yaw: number;
    boost?: boolean;
    flightFeel?: FlightFeel;
    mapId?: "valley" | "pizzeria";
  },
  lookPitch = 0,
): Action {
  const speeds = assistedSpeeds(input.flightFeel, input.mapId);
  const speed = input.boost ? speeds.boost : speeds.cruise;
  const steeringQuaternion =
    input.flightFeel === "arcade"
      ? levelFlightQuaternion(quaternion)
      : quaternion;
  const forward = horizontalForward(steeringQuaternion, lookYaw, lookPitch);
  const right: V3 = [forward[1], -forward[0], 0];
  return {
    kind: "nav",
    velocity: [
      (forward[0] * input.forward + right[0] * input.right) * speed,
      (forward[1] * input.forward + right[1] * input.right) * speed,
      input.up * speed,
    ],
    yawRate: clamp(input.yaw, -1, 1) * 1.5,
  };
}

const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** ENU heading (radians from east, CCW) of the airframe's forward axis. */
export function headingOf(quaternion: Q4) {
  const forward = rotate(quaternion, [1, 0, 0]);
  return Math.atan2(forward[1], forward[0]);
}

/**
 * Arcade Explore: movement is camera-relative. W/S follow the full aim
 * direction (look up and W climbs), A/D strafe along the camera's horizontal
 * right, Space/C are world up/down, and the airframe's heading chases the
 * camera heading so the controls always match what's on screen.
 */
export function cameraRelativeAction(
  quaternion: Q4,
  look: FlightLook,
  input: { forward: number; right: number; up: number; boost?: boolean; mapId?: "valley" | "pizzeria" },
): Extract<Action, { kind: "nav" }> {
  const speeds = assistedSpeeds("arcade", input.mapId);
  const speed = input.boost ? speeds.boost : speeds.cruise;
  const aim = flightForward(levelFlightQuaternion(quaternion), look.yaw, look.pitch);
  const horizontal = horizontalForward(levelFlightQuaternion(quaternion), look.yaw);
  const right: V3 = [horizontal[1], -horizontal[0], 0];
  const direction: V3 = [
    aim[0] * input.forward + right[0] * input.right,
    aim[1] * input.forward + right[1] * input.right,
    aim[2] * input.forward + input.up,
  ];
  const size = Math.hypot(...direction);
  const scale = size > 1 ? speed / size : speed;
  return {
    kind: "nav",
    velocity: [direction[0] * scale, direction[1] * scale, direction[2] * scale],
    yawRate: clamp(wrapAngle(look.yaw) * HEADING_FOLLOW_GAIN, -9, 9),
  };
}

/** Arcade Explore bindings: WASD move, Space/C rise/sink, Q/E turn, Shift dash/boost, F fire. */
export function arcadeKeyboardAxes(keys: ReadonlySet<string>) {
  return {
    forward: keyAxis(keys, ["KeyW", "ArrowUp"], ["KeyS", "ArrowDown"]),
    right: keyAxis(keys, ["KeyD", "ArrowRight"], ["KeyA", "ArrowLeft"]),
    up: keyAxis(keys, "Space", "KeyC"),
    turn: keyAxis(keys, "KeyQ", "KeyE"),
    boost: keys.has("ShiftLeft") || keys.has("ShiftRight"),
    fire: keys.has("KeyF"),
  };
}

/** FLU rate command: x roll, y pitch, z yaw. Positive pitch lowers the nose. */
export function acroAction(
  input: { roll: number; pitch: number; yaw: number },
  thrust: number,
): Action {
  return {
    kind: "rate",
    rates: [
      clamp(input.roll, -1, 1),
      clamp(input.pitch, -1, 1),
      clamp(input.yaw, -1, 1),
    ],
    thrust: clamp(thrust, 0, 1),
  };
}

/** Standard Mode 2 gamepad axes: yaw, throttle, roll, pitch. */
export function mode2Axes(
  axes: readonly number[],
  calibration: readonly number[] = [],
  amount = DEADZONE,
) {
  const axis = (index: number) => deadzone((axes[index] ?? 0) - (calibration[index] ?? 0), amount);
  const yaw = axis(0);
  const throttle = axis(1);
  const roll = axis(2);
  const pitch = axis(3);
  return {
    yaw: yaw === 0 ? 0 : -yaw,
    throttle: throttle === 0 ? 0 : -throttle,
    roll,
    pitch: pitch === 0 ? 0 : -pitch,
  };
}

type FlightControlsOptions = {
  state: MutableRefObject<PhysicalState | undefined>;
  controller: ControllerId;
  modeRef: MutableRefObject<string>;
  enabled: boolean;
  sendAction: (action: Action) => void;
  pause: () => void;
  restart: () => void;
  cycleCamera: () => void;
  calibrationRef: MutableRefObject<number[]>;
  cameraMode?: "FPV" | "Chase" | "Orbit";
  cameraTilt?: number;
  flightFeel?: FlightFeel;
  mapId?: "valley" | "pizzeria";
};

const flightKey = new Set([
  "KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "ArrowUp",
  "ArrowDown", "ArrowLeft", "ArrowRight", "Space",
  "ShiftLeft", "ShiftRight", "KeyF",
]);

const formOwnsInput = (target: EventTarget | null) => {
  const element = target instanceof Element ? target : document.activeElement;
  return !!element?.closest("input, select, textarea, [contenteditable='true']");
};

const keyAxis = (
  keys: ReadonlySet<string>,
  positive: string | readonly string[],
  negative: string | readonly string[],
) => {
  const contains = (bindings: string | readonly string[]) =>
    (typeof bindings === "string" ? [bindings] : bindings).some((binding) =>
      keys.has(binding),
    );
  return (contains(positive) ? 1 : 0) - (contains(negative) ? 1 : 0);
};

/** Keyboard bindings for a standard six-DOF FPV control surface. */
export function keyboardFlightAxes(keys: ReadonlySet<string>) {
  return {
    forward: keyAxis(keys, ["KeyW", "ArrowUp"], ["KeyS", "ArrowDown"]),
    right: keyAxis(keys, ["KeyD", "ArrowRight"], ["KeyA", "ArrowLeft"]),
    up: keyAxis(keys, "Space", ["ShiftLeft", "ShiftRight"]),
    yaw: keyAxis(keys, "KeyQ", "KeyE"),
    boost: keys.has("KeyF"),
  };
}

export function useFlightControls({
  state,
  controller,
  modeRef,
  enabled,
  sendAction,
  pause,
  restart,
  cycleCamera,
  calibrationRef,
  cameraMode = "FPV",
  cameraTilt = DEFAULT_CAMERA_TILT,
  flightFeel = "research",
  mapId,
}: FlightControlsOptions) {
  const lookRef = useRef<FlightLook>({ yaw: 0, pitch: 0 });
  const keys = useRef(new Set<string>());
  const throttleRef = useRef(HOVER_THRUST);
  const previousActive = useRef(false);
  const lockedRef = useRef(false);
  const draggingRef = useRef(false);
  const intentionalCameraUnlock = useRef(false);
  const [locked, setLocked] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [throttle, setThrottle] = useState(HOVER_THRUST);
  const [sensitivity, setSensitivityState] = useState(1);
  const sensitivityRef = useRef(sensitivity);
  const callbacks = useRef({ sendAction, pause, restart, cycleCamera });
  const arcadeExplore = flightFeel === "arcade";
  // Arcade Explore is a third-person action camera too, so Chase can aim.
  const lookEnabled = enabled && (cameraMode === "FPV" || (arcadeExplore && cameraMode === "Chase"));
  const arcadeRef = useRef(arcadeExplore);
  arcadeRef.current = arcadeExplore;
  const mouseFire = useRef(false);

  useEffect(() => {
    callbacks.current = { sendAction, pause, restart, cycleCamera };
  }, [sendAction, pause, restart, cycleCamera]);

  const setSensitivity = useCallback((value: number) => {
    const next = clamp(value, 0.25, 2);
    sensitivityRef.current = next;
    setSensitivityState(next);
  }, []);
  const resetControls = useCallback(() => {
    keys.current.clear();
    previousActive.current = false;
    lookRef.current = { yaw: 0, pitch: 0 };
    throttleRef.current = HOVER_THRUST;
    setThrottle(HOVER_THRUST);
  }, []);
  const resetLook = useCallback(() => { lookRef.current = { yaw: 0, pitch: 0 }; }, []);
  const clearFlight = useCallback((shouldPause = false) => {
    keys.current.clear();
    mouseFire.current = false;
    combatInput.trigger = false;
    previousActive.current = false;
    if (shouldPause) callbacks.current.pause();
  }, []);
  const applyLook = useCallback((movementX: number, movementY: number) => {
    const look = lookRef.current;
    const turn = movementX * BASE_MOUSE_SENSITIVITY * sensitivityRef.current;
    look.yaw -= turn;
    if (look.world !== undefined) look.world -= turn;
    look.pitch = clamp(
      look.pitch - movementY * BASE_MOUSE_SENSITIVITY * sensitivityRef.current,
      -MAX_LOOK_PITCH,
      MAX_LOOK_PITCH,
    );
  }, []);
  const releaseDrag = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
  }, []);
  const engageLook = useCallback(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("#flight-stage canvas");
    if (!canvas || !lookEnabled) return;
    try {
      const request = canvas.requestPointerLock?.();
      void request?.catch(() => {
        lockedRef.current = false;
        setLocked(false);
        releaseDrag();
      });
    } catch {
      lockedRef.current = false;
      setLocked(false);
      releaseDrag();
    }
  }, [lookEnabled, releaseDrag]);

  useEffect(() => {
    if (!enabled) {
      clearFlight();
      releaseDrag();
    }
  }, [enabled, clearFlight, releaseDrag]);

  useEffect(() => {
    if (lookEnabled) return;
    releaseDrag();
    if (lockedRef.current) {
      if (cameraMode !== "FPV") intentionalCameraUnlock.current = true;
      document.exitPointerLock?.();
    }
  }, [cameraMode, lookEnabled, releaseDrag]);

  useEffect(() => {
    if (controller === "rate") resetControls();
  }, [controller, resetControls]);

  useEffect(() => {
    const pointerLockChange = () => {
      const canvas = document.querySelector<HTMLCanvasElement>("#flight-stage canvas");
      const nextLocked = !!canvas && document.pointerLockElement === canvas;
      const wasLocked = lockedRef.current;
      const intentional = intentionalCameraUnlock.current;
      intentionalCameraUnlock.current = false;
      lockedRef.current = nextLocked;
      setLocked(nextLocked);
      if (nextLocked) releaseDrag();
      if (!nextLocked) mouseFire.current = false;
      if (wasLocked && !nextLocked && !intentional) clearFlight(true);
    };
    document.addEventListener("pointerlockchange", pointerLockChange);
    return () => document.removeEventListener("pointerlockchange", pointerLockChange);
  }, [clearFlight, releaseDrag]);

  useEffect(() => {
    let canvas: HTMLCanvasElement | undefined;
    const attach = () => {
      const next = document.querySelector<HTMLCanvasElement>("#flight-stage canvas");
      if (!next || next === canvas) return;
      detach();
      canvas = next;
      canvas.addEventListener("pointerdown", pointerDown);
      canvas.addEventListener("pointermove", pointerMove);
    };
    const detach = () => {
      canvas?.removeEventListener("pointerdown", pointerDown);
      canvas?.removeEventListener("pointermove", pointerMove);
      canvas = undefined;
    };
    const pointerDown = (event: PointerEvent) => {
      if (!lookEnabled || event.button !== 0 || lockedRef.current) return;
      draggingRef.current = true;
      setDragging(true);
      canvas?.setPointerCapture?.(event.pointerId);
    };
    const pointerMove = (event: PointerEvent) => {
      if (lookEnabled && draggingRef.current && !lockedRef.current)
        applyLook(event.movementX, event.movementY);
    };
    const lockedMove = (event: MouseEvent) => {
      if (lookEnabled && lockedRef.current) applyLook(event.movementX, event.movementY);
    };
    // With the cursor captured, the left button is the trigger.
    const lockedDown = (event: MouseEvent) => {
      if (lockedRef.current && event.button === 0 && arcadeRef.current) mouseFire.current = true;
    };
    const lockedUp = (event: MouseEvent) => {
      if (event.button === 0) mouseFire.current = false;
    };
    document.addEventListener("mousedown", lockedDown);
    document.addEventListener("mouseup", lockedUp);
    attach();
    const observer = new MutationObserver(attach);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("mousemove", lockedMove);
    window.addEventListener("pointerup", releaseDrag);
    window.addEventListener("blur", releaseDrag);
    return () => {
      observer.disconnect();
      detach();
      document.removeEventListener("mousemove", lockedMove);
      document.removeEventListener("mousedown", lockedDown);
      document.removeEventListener("mouseup", lockedUp);
      window.removeEventListener("pointerup", releaseDrag);
      window.removeEventListener("blur", releaseDrag);
    };
  }, [applyLook, lookEnabled, releaseDrag]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (!enabled || formOwnsInput(event.target)) return;
      if (event.code === "Escape") {
        const releasingLock = lockedRef.current;
        clearFlight(!releasingLock);
        if (releasingLock) document.exitPointerLock?.();
        return;
      }
      if (event.code === "KeyR" && !event.repeat) {
        event.preventDefault();
        resetControls();
        callbacks.current.restart();
        return;
      }
      // Arcade uses C to sink, so V cycles cameras there (V always works).
      if ((event.code === "KeyV" || (event.code === "KeyC" && !arcadeRef.current)) && !event.repeat) {
        event.preventDefault();
        callbacks.current.cycleCamera();
        return;
      }
      if (event.code === "KeyP" && !event.repeat) {
        event.preventDefault();
        callbacks.current.pause();
        return;
      }
      if (!flightKey.has(event.code) && !(arcadeRef.current && event.code === "KeyC")) return;
      event.preventDefault();
      keys.current.add(event.code);
    };
    const up = (event: KeyboardEvent) => keys.current.delete(event.code);
    const blur = () => clearFlight(true);
    const visibility = () => {
      if (document.hidden) blur();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [clearFlight, enabled, resetControls]);

  useEffect(() => {
    let frame = 0;
    let previousTime: number | undefined;
    let sinceLastAction = ACTION_SEND_PERIOD;
    let dashReady = 0;
    let dashHeld = false;
    const arcade = flightFeel === "arcade";
    const tick = (now: number) => {
      const elapsed = previousTime === undefined ? 0 : Math.min((now - previousTime) / 1000, 0.1);
      previousTime = now;
      sinceLastAction += elapsed;
      const flying = enabled && modeRef.current === "realtime";
      combatInput.trigger = flying && arcade && (keys.current.has("KeyF") || mouseFire.current);
      if (arcade && controller === "manual" && state.current) {
        // Camera-follow: the camera owns an absolute heading (mouse, Q/E);
        // the look offset is re-derived from it so the airframe chases it.
        const look = lookRef.current;
        const heading = headingOf(levelFlightQuaternion(state.current.quaternion));
        if (look.world === undefined) look.world = heading + look.yaw;
        if (flying) look.world += arcadeKeyboardAxes(keys.current).turn * KEY_TURN_RATE * elapsed;
        look.world = wrapAngle(look.world);
        look.yaw = wrapAngle(look.world - heading);
      } else lookRef.current.world = undefined;
      if (arcade && flying && controller === "manual") {
        dashReady = Math.max(0, dashReady - elapsed);
        const axes = arcadeKeyboardAxes(keys.current);
        if (axes.boost && !dashHeld && dashReady === 0 && state.current) {
          const dir = cameraRelativeAction(state.current.quaternion, lookRef.current, { ...axes, forward: axes.forward || axes.right || axes.up ? axes.forward : 1, mapId }).velocity;
          const size = Math.hypot(...dir) || 1;
          queueKick([dir[0] / size * DASH_KICK, dir[1] / size * DASH_KICK, dir[2] / size * DASH_KICK]);
          dashReady = DASH_COOLDOWN;
          combatEvents.emit({ type: "dash" });
          sinceLastAction = ACTION_SEND_PERIOD;
        }
        dashHeld = axes.boost;
      }
      if (sinceLastAction < ACTION_SEND_PERIOD) {
        frame = window.requestAnimationFrame(tick);
        return;
      }
      sinceLastAction = 0;
      if (!enabled || modeRef.current !== "realtime" || !["manual", "rate"].includes(controller)) {
        frame = window.requestAnimationFrame(tick);
        return;
      }
      const keysNow = keys.current;
      const pad = navigator.getGamepads?.().find(Boolean);
      const gamepad = mode2Axes(pad?.axes ?? [], calibrationRef.current);
      const keyboard = keyboardFlightAxes(keysNow);
      const assisted = {
        forward: keyboard.forward || gamepad.pitch,
        right: keyboard.right || gamepad.roll,
        up: keyboard.up || gamepad.throttle,
        yaw: keyboard.yaw || gamepad.yaw,
        boost: keyboard.boost,
        flightFeel,
        mapId,
      };
      let action: Action;
      let active = false;
      if (controller === "rate") {
        const vertical = keyboard.up;
        if (vertical) {
          throttleRef.current = clamp(throttleRef.current + vertical * THROTTLE_RATE * Math.max(elapsed, ACTION_SEND_PERIOD), 0, 1);
          setThrottle(throttleRef.current);
        } else if (Math.abs(gamepad.throttle) > 0) {
          throttleRef.current = clamp(HOVER_THRUST + gamepad.throttle * 0.5, 0, 1);
          setThrottle(throttleRef.current);
        }
        const rateInput = {
          roll: keyboard.right || gamepad.roll,
          pitch: keyboard.forward || gamepad.pitch,
          yaw: keyboard.yaw || gamepad.yaw,
        };
        action = { ...acroAction(rateInput, throttleRef.current), ...(arcade ? takeKick() : undefined) };
        callbacks.current.sendAction(action);
      } else if (arcade) {
        const axes = arcadeKeyboardAxes(keysNow);
        const input = {
          forward: axes.forward || gamepad.pitch,
          right: axes.right || gamepad.roll,
          up: axes.up || gamepad.throttle,
          boost: axes.boost,
          mapId,
        };
        if (gamepad.yaw && lookRef.current.world !== undefined) lookRef.current.world += gamepad.yaw * KEY_TURN_RATE * Math.max(elapsed, ACTION_SEND_PERIOD);
        const kick = takeKick();
        active = Math.abs(input.forward) > 0 || Math.abs(input.right) > 0 || Math.abs(input.up) > 0 || Math.abs(wrapAngle(lookRef.current.yaw)) > 0.01 || !!kick;
        action = { ...cameraRelativeAction(state.current?.quaternion ?? [0, 0, 0, 1], lookRef.current, input), ...kick };
        if (active || previousActive.current) callbacks.current.sendAction(action);
      } else {
        active = Math.abs(assisted.forward) > 0 || Math.abs(assisted.right) > 0 || Math.abs(assisted.up) > 0 || Math.abs(assisted.yaw) > 0;
        action = assistedAction(
          state.current?.quaternion ?? [0, 0, 0, 1],
          lookRef.current.yaw,
          assisted,
          lookRef.current.pitch + (cameraTilt * Math.PI) / 180,
        );
        if (active || previousActive.current) callbacks.current.sendAction(action);
      }
      previousActive.current = active;
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [calibrationRef, cameraTilt, controller, enabled, flightFeel, mapId, modeRef, state]);

  return { lookRef, locked, dragging, throttle, engageLook, resetLook, resetControls, sensitivity, setSensitivity };
}
