import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { ArrowUpRight, Camera, Crosshair, Gamepad2, MapPin, Pause, Play, RotateCcw, Settings2 } from "lucide-react";
import type { ControllerId, PhysicalState, Scenario } from "../../../packages/contracts";
import { FREE_WORLD } from "../../../packages/contracts/free-world";
import { PIZZERIA_WORLD } from "../../../packages/contracts/pizzeria-world";
import type { CameraMode } from "./Scene";
import type { FlightLook } from "./flight-controls";

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
  const [waypoint, setWaypoint] = useState(1);
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
    if (changed) setVisited([...visits.current]);
  }, [active, free, p.flight, world, worldId]);
  const destination = world.landmarks[waypoint % world.landmarks.length];
  const distance = destination ? Math.hypot(...destination.position.map((v, i) => v - position[i])) : 0;
  const q = p.flight?.quaternion ?? [0, 0, 0, 1];
  const yaw = Math.atan2(2 * (q[3] * q[2] + q[0] * q[1]), 1 - 2 * (q[1] ** 2 + q[2] ** 2)) + p.lookRef.current.yaw;
  const heading = ((90 - yaw * 180 / Math.PI) % 360 + 360) % 360;
  const map = (v: number) => 100 + v / world.bounds * 88;
  const smallMap = worldId === "pizzeria";

  return <div className={`game-overlay ${active ? "is-flying" : "is-idle"}`}>
    <div className="world-heading">
      <div className="live-tag"><i /> {free ? "FREE ROAM" : "TRAINING GROUND"} <span>•</span> {worldId === "pizzeria" && free ? "FAN MAP" : "GOLDEN HOUR"}</div>
      <h1>{free ? world.name : p.scenario?.name ?? "Loading flight deck"}<span>↗</span></h1>
      <p>{free ? (worldId === "pizzeria" ? "After hours. Through the party room and beyond." : "No finish line. Just your next good line.") : p.scenario?.description}</p>
      <div className="world-switch" aria-label="Choose a world">
        <button disabled={p.busy} className={free && worldId === "valley" ? "selected" : ""} onClick={() => p.onWorldChange("valley")}>01 <span>Aster Valley</span></button>
        <button disabled={p.busy} className={free && worldId === "pizzeria" ? "selected" : ""} onClick={() => p.onWorldChange("pizzeria")}>02 <span>Freddy’s Pizzeria</span></button>
      </div>
    </div>

    <div className="flight-compass" aria-label={`Heading ${fmt(heading)} degrees`}>
      <span>N</span><i /><span>E</span><b>{fmt(heading).padStart(3, "0")}°</b><span>S</span><i /><span>W</span>
      <small>▼</small>
    </div>
    <div className="pilot-tools">
      <button onClick={p.onSetup}><Settings2 size={16} /><span>Flight setup</span></button>
      <button onClick={() => setGuide(!guide)} aria-expanded={guide}><Gamepad2 size={16} /><span>Controls</span></button>
      <span className="performance"><i /> {p.fps} FPS</span>
    </div>
    {guide && <div className="control-guide">
      <div><b>Your flight deck</b><button onClick={() => setGuide(false)} aria-label="Close controls">×</button></div>
      <p><kbd>Mouse</kbd> Look around. Click “Mouse look” to capture the cursor, or drag on the world. <kbd>Esc</kbd> releases and pauses.</p>
      <dl>
        <dt><kbd>W A S D</kbd></dt><dd>{p.controller === "rate" ? "Pitch / roll the drone" : "Move relative to your view"}</dd>
        <dt><kbd>Space / Shift</kbd></dt><dd>{p.controller === "rate" ? "Increase / decrease throttle" : "Climb / descend"}</dd>
        <dt><kbd>Q / E</kbd></dt><dd>Yaw left / right</dd>
        <dt><kbd>Ctrl</kbd></dt><dd>Boost in Assisted</dd>
        <dt><kbd>R</kbd> <kbd>C</kbd> <kbd>P</kbd></dt><dd>Retry · camera · pause</dd>
      </dl>
      <p>{p.controller === "rate" ? "Acro has no automatic leveling. Small inputs work best; a gamepad gives finer control." : "Assisted keeps the drone level and brakes when you release movement."}</p>
      <p>Desktop keyboard or Mode 2 gamepad. Each recorded flight lasts up to two minutes; retry for a fresh session. {free ? `Map limits: ±${world.bounds} m, ${world.ceiling} m ceiling.` : "Practice missions have their own arena limits."}</p>
    </div>}

    {p.camera === "FPV" && <div className="fpv-reticle" aria-hidden="true"><i /><b /><i /></div>}
    <div className="flight-telemetry">
      <div className="speed"><strong>{fmt(speed)}</strong><span>KM/H<small>FLIGHT SPEED</small></span></div>
      <div className="telemetry-row"><span>ALT <b>{fmt(position[2], 1)}<small> m</small></b></span><span>TIME <b>{fmt(p.flight?.time ?? 0, 1)}<small> s</small></b></span><span>PACK <b>{fmt((p.flight?.battery ?? 1) * 100)}<small> %</small></b></span></div>
      {p.controller === "rate" && <div className="throttle-meter"><span>THROTTLE {fmt(p.throttle * 100)}%</span><i><b style={{width: `${p.throttle * 100}%`}} /></i></div>}
      <div className="flight-camera" aria-label="Flight camera"><Camera size={14}/>{(["FPV", "Chase", "Orbit"] as CameraMode[]).map(c => <button key={c} className={p.camera === c ? "on" : ""} onClick={() => p.onCamera(c)}>{c}</button>)}</div>
    </div>

    <div className="flight-dock">
      {ended && <div className="flight-ended" role="status">{p.flight?.reason === "success" ? "Nice flight." : p.flight?.reason === "timeout" ? "Flight recorded. Ready for another?" : "A little too close. Find another line."} <span>{p.flight?.reason?.replaceAll("_", " ")}</span></div>}
      <div className="pilot-modes" aria-label="Flight handling">
        <button className={p.controller === "manual" ? "selected" : ""} disabled={p.busy} onClick={() => p.onController("manual")}><i />Assisted <small>CRUISE</small></button>
        <button className={p.controller === "rate" ? "selected" : ""} disabled={p.busy} onClick={() => p.onController("rate")}><i />Acro <small>FULL CONTROL</small></button>
      </div>
      <div className="flight-actions">
        <button className="take-flight" disabled={p.busy} onClick={active ? p.onPause : ended || !started ? p.onLaunch : p.onPause}>{active ? <Pause size={17}/> : <Play size={17}/>} {p.busy ? "Preparing…" : active ? "Pause" : ended ? "Fly again" : started ? "Resume" : "Take flight"} {!active && <ArrowUpRight size={17}/>}</button>
        <button className={`look-button ${p.locked || p.dragging ? "selected" : ""}`} disabled={p.camera !== "FPV" || p.busy} onClick={p.onLook} title={p.camera === "FPV" ? "Capture the mouse to look around" : "Select FPV for mouse look"}><Crosshair size={16}/>{p.locked ? "Mouse captured" : p.dragging ? "Looking" : "Mouse look"}</button>
        <button className="retry-button" disabled={p.busy} onClick={p.onRestart} aria-label="Restart flight" title="Restart flight (R)"><RotateCcw size={16}/></button>
      </div>
      <div className="dock-hint"><kbd>WASD</kbd> {p.controller === "rate" ? "PITCH / ROLL" : "MOVE"} <kbd>SPACE / SHIFT</kbd> {p.controller === "rate" ? "THROTTLE" : "UP / DOWN"} <kbd>R</kbd> RETRY</div>
    </div>

    {free && <div className="explore-map">
      <div className="map-title"><span><MapPin size={12}/> FLIGHT MAP</span><b>{visited.length}/{world.landmarks.length} SPOTS</b></div>
      <svg viewBox="0 0 200 200" role="img" aria-label={`Map of ${world.name}. Your position ${fmt(position[0])}, ${fmt(position[1])} meters.`}>
        <defs><pattern id="map-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" fill="none" stroke="#d8e4c414" strokeWidth=".6"/></pattern></defs>
        <rect x="5" y="5" width="190" height="190" rx="3" fill="url(#map-grid)" />
        <rect x="12" y="12" width="176" height="176" fill="none" stroke="#aec3ad28" strokeDasharray="2 4" />
        {world.obstacles.map(o => <rect key={o.id} x={map(o.position[0]-o.size[0]/2)} y={200-map(o.position[1]+o.size[1]/2)} width={Math.max(.7,o.size[0]/world.bounds*88)} height={Math.max(.7,o.size[1]/world.bounds*88)} fill={smallMap ? "#758475" : "#799078"} opacity=".55" />)}
        {world.landmarks.map((l,i) => <g key={l.id} transform={`translate(${map(l.position[0])},${200-map(l.position[1])})`}><circle r={i===waypoint ? 5 : 3} fill={visited.includes(l.id) ? "#bbe990" : l.color} opacity={i===waypoint ? 1 : .7}/>{i===waypoint && <circle r="9" fill="none" stroke="#d8f7a8" strokeWidth=".7"/>}</g>)}
        <g transform={`translate(${map(position[0])},${200-map(position[1])}) rotate(${heading})`}><circle r="6" fill="#172321"/><path d="M0 -6 L4 5 L0 3 L-4 5 Z" fill="#eef7df"/></g>
        <text x="181" y="25" fill="#e8efdc" fontSize="8">N</text>
      </svg>
      <button className="next-spot" onClick={() => setWaypoint((waypoint+1)%world.landmarks.length)} title="Choose next landmark"><span><small>NEXT SPOT</small>{destination?.name}</span><b>{fmt(distance)} m ↗</b></button>
    </div>}
  </div>;
}
