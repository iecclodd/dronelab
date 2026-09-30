import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { Action, ControllerId, PhysicalState, Q4, V3 } from "../../../packages/contracts";

export type FlightLook = { yaw: number; pitch: number };

const DEADZONE = 0.12;
const MAX_LOOK_PITCH = (80 * Math.PI) / 180;
const NAV_SPEED = 7;
const BOOST_SPEED = 13;
const HOVER_THRUST = 0.42;
const THROTTLE_STEP = 0.025;
const BASE_MOUSE_SENSITIVITY = 0.0024;
const DEFAULT_CAMERA_TILT = 15;

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

export function assistedAction(
  quaternion: Q4,
  lookYaw: number,
  input: { forward: number; right: number; up: number; yaw: number; boost?: boolean },
  lookPitch = 0,
): Action {
  const speed = input.boost ? BOOST_SPEED : NAV_SPEED;
  const forward = horizontalForward(quaternion, lookYaw, lookPitch);
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
};

const flightKey = new Set([
  "KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "Space",
  "ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight",
]);

const formOwnsInput = (target: EventTarget | null) => {
  const element = target instanceof Element ? target : document.activeElement;
  return !!element?.closest("input, select, textarea, [contenteditable='true']");
};

const keyAxis = (keys: Set<string>, positive: string, negative: string) =>
  (keys.has(positive) ? 1 : 0) - (keys.has(negative) ? 1 : 0);

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
  const lookEnabled = enabled && cameraMode === "FPV";

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
    previousActive.current = false;
    if (shouldPause) callbacks.current.pause();
  }, []);
  const applyLook = useCallback((movementX: number, movementY: number) => {
    const look = lookRef.current;
    look.yaw -= movementX * BASE_MOUSE_SENSITIVITY * sensitivityRef.current;
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
      if (event.code === "KeyC" && !event.repeat) {
        event.preventDefault();
        callbacks.current.cycleCamera();
        return;
      }
      if (event.code === "KeyP" && !event.repeat) {
        event.preventDefault();
        callbacks.current.pause();
        return;
      }
      if (!flightKey.has(event.code)) return;
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
    const tick = () => {
      if (!enabled || modeRef.current !== "realtime" || !["manual", "rate"].includes(controller)) return;
      const keysNow = keys.current;
      const pad = navigator.getGamepads?.().find(Boolean);
      const gamepad = mode2Axes(pad?.axes ?? [], calibrationRef.current);
      const assisted = {
        forward: keyAxis(keysNow, "KeyW", "KeyS") || gamepad.pitch,
        right: keyAxis(keysNow, "KeyD", "KeyA") || gamepad.roll,
        up: keyAxis(keysNow, "Space", "ShiftLeft") || keyAxis(keysNow, "Space", "ShiftRight") || gamepad.throttle,
        yaw: keyAxis(keysNow, "KeyQ", "KeyE") || gamepad.yaw,
        boost: keysNow.has("ControlLeft") || keysNow.has("ControlRight"),
      };
      let action: Action;
      let active = false;
      if (controller === "rate") {
        const vertical = keyAxis(keysNow, "Space", "ShiftLeft") || keyAxis(keysNow, "Space", "ShiftRight");
        if (vertical) {
          throttleRef.current = clamp(throttleRef.current + vertical * THROTTLE_STEP, 0, 1);
          setThrottle(throttleRef.current);
        } else if (Math.abs(gamepad.throttle) > 0) {
          throttleRef.current = clamp(HOVER_THRUST + gamepad.throttle * 0.5, 0, 1);
          setThrottle(throttleRef.current);
        }
        const rateInput = {
          roll: keyAxis(keysNow, "KeyD", "KeyA") || gamepad.roll,
          pitch: keyAxis(keysNow, "KeyW", "KeyS") || gamepad.pitch,
          yaw: keyAxis(keysNow, "KeyQ", "KeyE") || gamepad.yaw,
        };
        action = acroAction(rateInput, throttleRef.current);
        callbacks.current.sendAction(action);
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
    };
    const id = window.setInterval(tick, 65);
    return () => window.clearInterval(id);
  }, [calibrationRef, cameraTilt, controller, enabled, modeRef, state]);

  return { lookRef, locked, dragging, throttle, engageLook, resetLook, resetControls, sensitivity, setSensitivity };
}
