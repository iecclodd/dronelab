import React, { useEffect, useRef, useState, type MutableRefObject } from "react";
import { ArrowUpRight, Camera, Crosshair, Gamepad2, MapPin, Pause, Play, RotateCcw, Settings2, Volume2, VolumeX } from "lucide-react";
import type { ControllerId, PhysicalState, Scenario } from "../../../packages/contracts";
import { FREE_WORLD } from "../../../packages/contracts/free-world";
import { PIZZERIA_WORLD } from "../../../packages/contracts/pizzeria-world";
import type { CameraMode } from "./Scene";
import type { FlightLook } from "./flight-controls";
import { navMarker, navStore } from "./nav-store";
import { CombatHud, focusLines } from "./CombatHud";

/** Screen-space pin for the chosen next spot; clamps to the edge with an arrow when off-screen. */
function WaypointMarker({ name, color, enabled }: { name?: string; color?: string; enabled: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  const distance = useRef<HTMLElement>(null);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const node = el.current;
      if (node) {
        const show = enabled && navMarker.active;
        node.style.opacity = show ? "1" : "0";
        if (show) {
          node.style.transform = `translate(${(navMarker.x * 100).toFixed(2)}vw, ${(navMarker.y * 100).toFixed(2)}vh)`;
          node.classList.toggle("is-offscreen", !navMarker.onScreen);
          node.style.setProperty("--pin-angle", `${navMarker.angle}rad`);
          if (distance.current) distance.current.textContent = `${Math.round(navMarker.distance)} m`;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [enabled]);
  return <div ref={el} className="waypoint-pin" aria-hidden="true" style={{ "--pin-color": color } as React.CSSProperties}>
    <div className="pin-body"><i className="pin-diamond" /><span className="pin-label">{name}</span><b ref={distance} className="pin-distance" /></div>
    <i className="pin-arrow" />
  </div>;
}

const CARDINALS: Record<number, string> = { 0: "N", 45: "NE", 90: "E", 135: "SE", 180: "S", 225: "SW", 270: "W", 315: "NW" };
/** Heading tape with landmark pips, so direction-to-spot reads without opening the map. */
function CompassTape({ heading, pips }: { heading: number; pips: { id: string; bearing: number; color: string; active: boolean; visited: boolean }[] }) {
  const span = 75;
  const place = (deg: number) => {
    const rel = ((deg - heading + 540) % 360) - 180;
    return Math.abs(rel) <= span ? 50 + (rel / span) * 50 : undefined;
  };
  const ticks: { deg: number; x: number }[] = [];
  for (let deg = 0; deg < 360; deg += 15) { const x = place(deg); if (x !== undefined) ticks.push({ deg, x }); }
  return <div className="compass-tape" aria-hidden="true">
    {ticks.map(({ deg, x }) => <span key={deg} className={`tape-tick ${CARDINALS[deg] ? "major" : ""}`} style={{ left: `${x}%` }}>{CARDINALS[deg] && <em>{CARDINALS[deg]}</em>}</span>)}
    {pips.map((pip) => {
      const x = place(pip.bearing);
      const rel = ((pip.bearing - heading + 540) % 360) - 180;
      const clamped = x ?? (rel < 0 ? 0 : 100);
      return <i key={pip.id} className={`tape-pip ${pip.active ? "active" : ""} ${pip.visited ? "visited" : ""} ${x === undefined ? "edge" : ""}`} style={{ left: `${clamped}%`, "--pip": pip.color } as React.CSSProperties} />;
    })}
  </div>;
}

type Props = {
  flight?: PhysicalState;
  scenario?: Scenario;
  controller: ControllerId;
  camera: CameraMode;
  mode: string;
  busy: boolean;
  locked: boolean;
  dragging: boolean;
  throttle: number;
  fps: number;
  lookRef: MutableRefObject<FlightLook>;
  soundEnabled?: boolean;
  onSound?: () => void;
  effectsEnabled?: boolean;
  onLaunch: () => void;
  onPause: () => void;
  onRestart: () => void;
  onLook: () => void;
  onSetup: () => void;
  onController: (mode: "manual" | "rate") => void;
  onCamera: (camera: CameraMode) => void;
  onWorldChange: (map: "valley" | "pizzeria") => void;
};

const fmt = (value: number, digits = 0) => Number.isFinite(value) ? value.toFixed(digits) : "0";
export function GameOverlay(p: Props) {
  const worldId = p.scenario?.mapId === "pizzeria" ? "pizzeria" : "valley";
  const world = worldId === "pizzeria" ? PIZZERIA_WORLD : FREE_WORLD;
  const free = p.scenario?.id === "free";
  const position = p.flight?.position ?? [0, 0, 0];
  const speed = Math.hypot(...(p.flight?.velocity ?? [0, 0, 0])) * 3.6;
  const active = p.mode === "realtime";
  const ended = !!(p.flight?.terminated || p.flight?.truncated);
  const started = (p.flight?.step ?? 0) > 0;
  const [guide, setGuide] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  // Focus lines "boil" (re-drawn) a few times a second, like inked frames.
  const [boil, setBoil] = useState(0);
  const speeding = !!p.effectsEnabled && p.mode === "realtime" && Math.hypot(...(p.flight?.velocity ?? [0, 0, 0])) * 3.6 > 55;
  useEffect(() => {
    if (!speeding) return;
    const id = window.setInterval(() => setBoil((n) => n + 1), 90);
    return () => window.clearInterval(id);
  }, [speeding]);
  const [waypoint, setWaypoint] = useState(1);
  const [toast, setToast] = useState<{ key: number; name: string; color: string; count: number; total: number }>();
  const toastTimer = useRef<number | undefined>(undefined);
  const [liftoff, setLiftoff] = useState(0);
  const wasActive = useRef(false);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);
  const [visited, setVisited] = useState<string[]>([]);
  const visits = useRef(new Set<string>());
  const visitWorld = useRef("");
  useEffect(() => {
    if (visitWorld.current !== worldId) {
      visitWorld.current = worldId;
      visits.current.clear();
      setVisited([]);
      setWaypoint(1);
    }
    if (!active || !free || !p.flight) return;
    let changed = false;
    for (const landmark of world.landmarks) {
      if (Math.hypot(...landmark.position.map((v, i) => v - p.flight!.position[i])) < (worldId === "pizzeria" ? 5 : 22) && !visits.current.has(landmark.id)) {
        visits.current.add(landmark.id);
        changed = true;
      }
    }
    if (changed) {
      const list = [...visits.current];
      setVisited(list);
      const latest = world.landmarks.find((l) => l.id === list[list.length - 1]);
      if (latest && (p.flight?.step ?? 0) > 60) {
        setToast({ key: Date.now(), name: latest.name, color: latest.color, count: list.length, total: world.landmarks.length });
        window.clearTimeout(toastTimer.current);
        toastTimer.current = window.setTimeout(() => setToast(undefined), 2800);
      }
    }
  }, [active, free, p.flight, world, worldId]);
  useEffect(() => { navStore.set({ worldId, waypoint, visited }); }, [worldId, waypoint, visited]);
  useEffect(() => {
    if (active && !wasActive.current && (p.flight?.step ?? 0) < 90) { setLiftoff(Date.now()); window.setTimeout(() => setLiftoff(0), 1100); }
    wasActive.current = active;
  }, [active, p.flight?.step]);
  const destination = world.landmarks[waypoint % world.landmarks.length];
  const distance = destination ? Math.hypot(...destination.position.map((v, i) => v - position[i])) : 0;
  const q = p.flight?.quaternion ?? [0, 0, 0, 1];
  const yaw = Math.atan2(2 * (q[3] * q[2] + q[0] * q[1]), 1 - 2 * (q[1] ** 2 + q[2] ** 2)) + p.lookRef.current.yaw;
  const heading = ((90 - yaw * 180 / Math.PI) % 360 + 360) % 360;
  const map = (v: number) => 100 + v / world.bounds * 88;
  const smallMap = worldId === "pizzeria";

  const lowPass = active && speed > 28 && position[2] < 3.5;
  const pips = free ? world.landmarks.map((l, i) => ({
    id: l.id, color: l.color, active: i === waypoint % world.landmarks.length, visited: visited.includes(l.id),
    bearing: ((Math.atan2(l.position[0] - position[0], l.position[1] - position[1]) * 180 / Math.PI) + 360) % 360,
  })) : [];
  const topSpeed = worldId === "pizzeria" && free ? 58 : 108;
  const cruise = worldId === "pizzeria" && free ? 36 : 65;
  const segments = 24;
  const lit = Math.round(Math.min(1, speed / topSpeed) * segments);
  return <div className={`game-overlay ${active ? "is-flying" : "is-idle"} ${free ? "is-arcade" : ""}`}>
    {p.effectsEnabled && active && speed > 55 && <svg className="speed-lines" viewBox="0 0 1000 700" preserveAspectRatio="none" aria-hidden="true" style={{opacity: Math.min(.85, (speed - 55) / 70)}}>
      {focusLines(46, boil, 0.62 - Math.min(0.14, (speed - 55) / 500))}
    </svg>}
    {free && <CombatHud effectsEnabled={!!p.effectsEnabled} showCrosshair={p.camera !== "Orbit"} />}
    <div className="world-heading" key={`${worldId}-${free}`}>
      <div className="live-tag"><i /> {free ? "FREE FLIGHT" : "PRACTICE"} <span>/</span> {worldId === "pizzeria" && free ? "AFTER HOURS" : "GOLDEN HOUR"}</div>
      <h1>{free ? world.name : p.scenario?.name ?? "Loading flight deck"}<span>↗</span></h1>
      <p>{free ? (worldId === "pizzeria" ? "A little after-hours exploration." : "Find your line.") : p.scenario?.description}</p>
      <div className="world-switch" aria-label="Choose a world">
        <button disabled={p.busy} className={free && worldId === "valley" ? "selected" : ""} onClick={() => p.onWorldChange("valley")}>01 <span>Aster Valley</span></button>
        <button disabled={p.busy} className={free && worldId === "pizzeria" ? "selected" : ""} onClick={() => p.onWorldChange("pizzeria")}>02 <span>Freddy’s Pizzeria</span></button>
      </div>
    </div>

    <div className="flight-compass" aria-label={`Heading ${fmt(heading)} degrees`}>
      <CompassTape heading={heading} pips={pips} />
      <b>{fmt(heading).padStart(3, "0")}°</b>
      <small className={lowPass ? "low-pass" : ""}>{lowPass ? "LOW PASS" : active ? "IN FLIGHT" : "READY"}</small>
    </div>
    <div className="pilot-tools">
      <button onClick={p.onSound} aria-label={p.soundEnabled ? "Mute drone sound" : "Enable drone sound"} title={p.soundEnabled ? "Mute drone sound" : "Enable drone sound"}>{p.soundEnabled ? <Volume2 size={16}/> : <VolumeX size={16}/>}</button>
      <button onClick={p.onSetup}><Settings2 size={16} /><span>Flight setup</span></button>
      <button onClick={() => setGuide(!guide)} aria-expanded={guide}><Gamepad2 size={16} /><span>Controls</span></button>
    </div>
    {guide && <div className="control-guide">
      <div><b>Your flight deck</b><button onClick={() => setGuide(false)} aria-label="Close controls">×</button></div>
      <p><kbd>Mouse</kbd> Look around. Click “Mouse look” to capture the cursor, or drag on the world. <kbd>Esc</kbd> releases and pauses.</p>
      {free && p.controller !== "rate" ? <dl>
        <dt><kbd>Mouse</kbd></dt><dd>Aim. The drone turns to follow the camera</dd>
        <dt><kbd>W A S D</kbd></dt><dd>Move where you're looking (look up + W climbs)</dd>
        <dt><kbd>Space / C</kbd></dt><dd>Rise / sink</dd>
        <dt><kbd>Shift</kbd></dt><dd>Dash (tap) · boost (hold)</dd>
        <dt><kbd>F</kbd> / <kbd>Click</kbd></dt><dd>Machine gun (watch the heat ring)</dd>
        <dt><kbd>Q / E</kbd></dt><dd>Turn the camera</dd>
        <dt><kbd>V</kbd> <kbd>R</kbd> <kbd>P</kbd></dt><dd>Camera · retry · pause</dd>
      </dl> : <dl>
        <dt><kbd>W S / ↑ ↓</kbd></dt><dd>{p.controller === "rate" ? "Pitch forward / back" : "Forward / backward"}</dd>
        <dt><kbd>A D / ← →</kbd></dt><dd>{p.controller === "rate" ? "Roll left / right" : "Strafe left / right"}</dd>
        <dt><kbd>Space / Shift</kbd></dt><dd>{p.controller === "rate" ? "Increase / decrease throttle" : "Climb / descend"}</dd>
        <dt><kbd>Q / E</kbd></dt><dd>Yaw left / right</dd>
        <dt><kbd>F</kbd></dt><dd>Boost in Assisted</dd>
        <dt><kbd>R</kbd> <kbd>C</kbd> <kbd>P</kbd></dt><dd>Retry · camera · pause</dd>
        {free && <><dt><kbd>F</kbd></dt><dd>Machine gun</dd></>}
      </dl>}
      <p>{p.controller === "rate" ? "Acro: full body rates, manual throttle and a body-mounted camera. Small inputs go a long way." : free ? "Arcade: everything bounces. Walls and the map edge fling you back, explosions knock you around, and ramming a bot detonates it. Chain barrels for big combos." : "Assisted: braking on release and a steady horizon. Hold F to boost."}</p>
      <p>Gamepad: left stick = yaw / throttle, right stick = roll / pitch. Plug in and move a stick to connect. Optional center calibration is in Flight setup.</p>
      <p>Each recorded flight lasts up to two minutes; retry for a fresh session. {free ? `Map: ±${world.bounds} m, ${world.ceiling} m ceiling, springy edges.` : "Practice missions use research physics."}</p>
      <p className="guide-diagnostics">{p.fps} FPS · {p.camera} camera · {p.soundEnabled ? "Sound enabled" : "Sound muted"}</p>
    </div>}

    {p.camera === "FPV" && !free && <div className="fpv-reticle" aria-hidden="true" style={{ "--spread": `${Math.min(1, speed / topSpeed)}` } as React.CSSProperties}><i /><b /><i /></div>}
    {free && active && <WaypointMarker name={destination?.name} color={destination?.color} enabled={p.camera !== "Orbit"} />}
    {toast && <div key={toast.key} className="discovery-toast" role="status" style={{ "--toast": toast.color } as React.CSSProperties}>
      <span>DISCOVERED</span><b>{toast.name}</b><small>{toast.count} / {toast.total} spots</small>
    </div>}
    {liftoff > 0 && p.effectsEnabled && <div key={liftoff} className="liftoff-card" aria-hidden="true"><span>LIFT</span><b>OFF</b></div>}
    <div className="flight-telemetry">
      <div className="speed"><strong>{fmt(speed)}</strong><span>km/h</span></div>
      <div className={`speed-gauge ${speed > cruise + 3 ? "is-boost" : ""}`} aria-hidden="true">
        {Array.from({ length: segments }, (_, i) => <i key={i} className={`${i < lit ? "on" : ""} ${i >= Math.round(cruise / topSpeed * segments) ? "boost-zone" : ""}`} />)}
      </div>
      <div className="telemetry-row"><span>ALT <b>{fmt(position[2], 1)}<small> m</small></b></span><span>TIME <b>{fmt(p.flight?.time ?? 0, 1)}<small> s</small></b></span></div>
      {p.controller === "rate" && <div className="throttle-meter"><span>THROTTLE {fmt(p.throttle * 100)}%</span><i><b style={{width: `${p.throttle * 100}%`}} /></i></div>}
      <div className="flight-camera" aria-label="Flight camera"><Camera size={14}/>{(["FPV", "Chase", "Orbit"] as CameraMode[]).map(c => <button key={c} className={p.camera === c ? "on" : ""} onClick={() => p.onCamera(c)}>{c}</button>)}</div>
    </div>

    <div className="flight-dock">
      {ended && <div className="flight-ended" role="status">{p.flight?.reason === "success" ? "Nice flight." : p.flight?.reason === "timeout" ? "Flight recorded. Ready for another?" : "A little too close. Find another line."} <span>{p.flight?.reason?.replaceAll("_", " ")}</span></div>}
      <div className="pilot-modes" aria-label="Flight handling">
        <button className={p.controller === "manual" ? "selected" : ""} disabled={p.busy} onClick={() => p.onController("manual")}><i />Assisted</button>
        <button className={p.controller === "rate" ? "selected" : ""} disabled={p.busy} onClick={() => p.onController("rate")}><i />Acro</button>
      </div>
      <div className="flight-actions">
        <button className="take-flight" disabled={p.busy} onClick={active ? p.onPause : ended || !started ? p.onLaunch : p.onPause}>{active ? <Pause size={17}/> : <Play size={17}/>} {p.busy ? "Preparing…" : active ? "Pause" : ended ? "Fly again" : started ? "Resume" : "Take flight"} {!active && <ArrowUpRight size={17}/>}</button>
        <button className={`look-button ${p.locked || p.dragging ? "selected" : ""}`} disabled={(p.camera !== "FPV" && !(free && p.camera === "Chase")) || p.busy} onClick={p.onLook} title={p.camera === "Orbit" ? "Select FPV or Chase for mouse look" : "Capture the mouse to aim"}><Crosshair size={16}/>{p.locked ? "Mouse captured" : p.dragging ? "Looking" : "Mouse look"}</button>
        <button className="retry-button" disabled={p.busy} onClick={p.onRestart} aria-label="Restart flight" title="Restart flight (R)"><RotateCcw size={16}/></button>
      </div>
      <div className="dock-hint"><kbd>WASD</kbd> {p.controller === "rate" ? "PITCH / ROLL" : "MOVE"} {p.controller === "rate" ? <><kbd>SPACE / SHIFT</kbd> THROTTLE</> : free ? <><kbd>SHIFT</kbd> DASH <kbd>F</kbd> FIRE</> : <><kbd>F</kbd> BOOST</>} <kbd>R</kbd> RETRY</div>
    </div>

    {free && <div className={`explore-map ${mapOpen ? "map-open" : "map-closed"}`}>
      <button className="map-title" onClick={() => setMapOpen(!mapOpen)} aria-label={mapOpen ? "Hide minimap" : "Show minimap"} aria-expanded={mapOpen}><span><MapPin size={12}/> {mapOpen ? "MINIMAP" : "MAP"}</span><b>{visited.length}/{world.landmarks.length}</b></button>
      {mapOpen && <svg viewBox="0 0 200 200" role="img" aria-label={`Map of ${world.name}. Your position ${fmt(position[0])}, ${fmt(position[1])} meters.`}>
        <defs><pattern id="map-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" fill="none" stroke="#d8e4c414" strokeWidth=".6"/></pattern></defs>
        <rect x="5" y="5" width="190" height="190" rx="3" fill="url(#map-grid)" />
        <rect x="12" y="12" width="176" height="176" fill="none" stroke="#aec3ad28" strokeDasharray="2 4" />
        {world.obstacles.map(o => <rect key={o.id} x={map(o.position[0]-o.size[0]/2)} y={200-map(o.position[1]+o.size[1]/2)} width={Math.max(.7,o.size[0]/world.bounds*88)} height={Math.max(.7,o.size[1]/world.bounds*88)} fill={smallMap ? "#758475" : "#799078"} opacity=".55" />)}
        {world.landmarks.map((l,i) => <g key={l.id} transform={`translate(${map(l.position[0])},${200-map(l.position[1])})`}><circle r={i===waypoint ? 5 : 3} fill={visited.includes(l.id) ? "#bbe990" : l.color} opacity={i===waypoint ? 1 : .7}/>{i===waypoint && <circle r="9" fill="none" stroke="#d8f7a8" strokeWidth=".7"/>}</g>)}
        <g transform={`translate(${map(position[0])},${200-map(position[1])}) rotate(${heading})`}><circle r="6" fill="#172321"/><path d="M0 -6 L4 5 L0 3 L-4 5 Z" fill="#eef7df"/></g>
        <text x="181" y="25" fill="#e8efdc" fontSize="8">N</text>
      </svg>}
      <button className="next-spot" onClick={() => setWaypoint((waypoint+1)%world.landmarks.length)} title="Choose next landmark"><span><small>NEXT SPOT</small>{destination?.name}</span><b>{fmt(distance)} m ↗</b></button>
    </div>}
  </div>;
}
