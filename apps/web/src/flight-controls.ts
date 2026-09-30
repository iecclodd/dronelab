import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { Action, ControllerId, PhysicalState, Q4, V3 } from "../../../packages/contracts";

export type FlightLook = { yaw: number; pitch: number };

const DEADZONE = 0.12;
const MAX_LOOK_PITCH = (80 * Math.PI) / 180;
const NAV_SPEED = 7;
const BOOST_SPEED = 13;
const HOVER_THRUST = 0.42;
const THROTTLE_STEP = 0.025;

export const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

/** Removes controller-center noise while preserving the full travel at the edge. */
export function deadzone(value: number, amount = DEADZONE): number {
  const limited = clamp(value, -1, 1);
  if (Math.abs(limited) <= amount) return 0;
  return (Math.abs(limited) - amount) / (1 - amount) * Math.sign(limited);
}

/** ENU horizontal forward from the FLU body x axis, with look yaw positive to the left. */
export function horizontalForward(quaternion: Q4, lookYaw = 0): V3 {
  const [x, y, z, w] = quaternion;
  const bodyX = 1 - 2 * (y * y + z * z);
  const bodyY = 2 * (x * y + w * z);
  const length = Math.hypot(bodyX, bodyY);
  const east = length > 1e-6 ? bodyX / length : 1;
  const north = length > 1e-6 ? bodyY / length : 0;
  const cos = Math.cos(lookYaw);
  const sin = Math.sin(lookYaw);
  return [east * cos - north * sin, east * sin + north * cos, 0];
}

export function assistedAction(
  quaternion: Q4,
  lookYaw: number,
  input: { forward: number; right: number; up: number; yaw: number; boost?: boolean },
): Action {
  const speed = input.boost ? BOOST_SPEED : NAV_SPEED;
  const forward = horizontalForward(quaternion, lookYaw);
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

/** FLU rate command: x roll, y pitch, z yaw. Positive pitch lifts the nose. */
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
}: FlightControlsOptions) {
  const lookRef = useRef<FlightLook>({ yaw: 0, pitch: 0 });
  const keys = useRef(new Set<string>());
  const throttleRef = useRef(HOVER_THRUST);
  const previousActive = useRef(false);
  const lockedRef = useRef(false);
  const draggingRef = useRef(false);
  const [locked, setLocked] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [throttle, setThrottle] = useState(HOVER_THRUST);
  const [sensitivity, setSensitivityState] = useState(0.0024);
  const sensitivityRef = useRef(sensitivity);

  const setSensitivity = useCallback((value: number) => {
    const next = clamp(value, 0.0002, 0.02);
    sensitivityRef.current = next;
    setSensitivityState(next);
  }, []);
  const resetLook = useCallback(() => {
    lookRef.current = { yaw: 0, pitch: 0 };
  }, []);
  const clearFlight = useCallback((shouldPause = false) => {
    keys.current.clear();
    previousActive.current = false;
    if (shouldPause) pause();
  }, [pause]);
  const applyLook = useCallback((movementX: number, movementY: number) => {
    const look = lookRef.current;
    look.yaw -= movementX * sensitivityRef.current;
    look.pitch = clamp(
      look.pitch - movementY * sensitivityRef.current,
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
    if (!canvas || !enabled) return;
    canvas.requestPointerLock?.();
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      clearFlight();
      releaseDrag();
    }
  }, [enabled, clearFlight, releaseDrag]);

  useEffect(() => {
    const pointerLockChange = () => {
      const canvas = document.querySelector<HTMLCanvasElement>("#flight-stage canvas");
      const nextLocked = !!canvas && document.pointerLockElement === canvas;
      const wasLocked = lockedRef.current;
      lockedRef.current = nextLocked;
      setLocked(nextLocked);
      if (nextLocked) releaseDrag();
      if (wasLocked && !nextLocked) clearFlight(true);
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
      if (!enabled || event.button !== 0 || lockedRef.current) return;
      draggingRef.current = true;
      setDragging(true);
      canvas?.setPointerCapture?.(event.pointerId);
    };
    const pointerMove = (event: PointerEvent) => {
      if (enabled && draggingRef.current && !lockedRef.current)
        applyLook(event.movementX, event.movementY);
    };
    const lockedMove = (event: MouseEvent) => {
      if (enabled && lockedRef.current) applyLook(event.movementX, event.movementY);
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
  }, [applyLook, enabled, releaseDrag]);

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
        restart();
        return;
      }
      if (event.code === "KeyC" && !event.repeat) {
        event.preventDefault();
        cycleCamera();
        return;
      }
      if (event.code === "KeyP" && !event.repeat) {
        event.preventDefault();
        pause();
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
  }, [clearFlight, cycleCamera, enabled, pause, restart]);

  useEffect(() => {
    const tick = () => {
      if (!enabled || modeRef.current !== "realtime" || !["manual", "rate"].includes(controller)) return;
      const keysNow = keys.current;
      const pad = navigator.getGamepads?.().find(Boolean);
      const axis = (index: number) =>
        deadzone((pad?.axes[index] ?? 0) - (calibrationRef.current[index] ?? 0));
      const assisted = {
        forward: keyAxis(keysNow, "KeyW", "KeyS") || -axis(3),
        right: keyAxis(keysNow, "KeyD", "KeyA") || axis(0),
        up: keyAxis(keysNow, "Space", "ShiftLeft") || keyAxis(keysNow, "Space", "ShiftRight") || -axis(1),
        yaw: keyAxis(keysNow, "KeyE", "KeyQ") || -axis(2),
        boost: keysNow.has("ControlLeft") || keysNow.has("ControlRight"),
      };
      let action: Action;
      let active = false;
      if (controller === "rate") {
        const vertical = keyAxis(keysNow, "Space", "ShiftLeft") || keyAxis(keysNow, "Space", "ShiftRight");
        if (vertical) {
          throttleRef.current = clamp(throttleRef.current + vertical * THROTTLE_STEP, 0, 1);
          setThrottle(throttleRef.current);
        } else if (Math.abs(axis(1)) > 0) {
          throttleRef.current = clamp(HOVER_THRUST - axis(1) * 0.5, 0, 1);
          setThrottle(throttleRef.current);
        }
        const rateInput = {
          roll: keyAxis(keysNow, "KeyD", "KeyA") || axis(0),
          pitch: keyAxis(keysNow, "KeyS", "KeyW") || axis(3),
          yaw: keyAxis(keysNow, "KeyE", "KeyQ") || -axis(2),
        };
        active = !!vertical || Object.values(rateInput).some((value) => Math.abs(value) > 0);
        action = acroAction(rateInput, throttleRef.current);
      } else {
        active = Math.abs(assisted.forward) > 0 || Math.abs(assisted.right) > 0 || Math.abs(assisted.up) > 0 || Math.abs(assisted.yaw) > 0;
        action = assistedAction(state.current?.quaternion ?? [0, 0, 0, 1], lookRef.current.yaw, assisted);
      }
      if (active || previousActive.current) sendAction(action);
      previousActive.current = active;
    };
    const id = window.setInterval(tick, 65);
    return () => window.clearInterval(id);
  }, [calibrationRef, controller, enabled, modeRef, sendAction, state]);

  return { lookRef, locked, dragging, throttle, engageLook, resetLook, sensitivity, setSensitivity };
}
