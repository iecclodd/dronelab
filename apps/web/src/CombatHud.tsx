import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { combatEvents, combatStats, comboRank, type CombatEvent } from "./combat-store";

type Pop = { id: number; kind: "dmg" | "sfx" | "score"; x: number; y: number; text: string; sub?: string; crit?: boolean; tilt: number; tone?: string };

const KILL_SFX = [["ドカーン", "BOOM"], ["ズドン", "KA-BLAM"], ["バーン", "BLAM"], ["ボカン", "KRAK"]];
const BOUNCE_SFX = [["ボヨン", "BOING"], ["ドン", "DON"], ["バイン", "BWANG"]];
const MULTI = ["", "", "DOUBLE", "TRIPLE", "QUAD", "RAMPAGE"];

/**
 * Explore combat HUD: crosshair + heat ring, hit/kill markers, damage numbers,
 * manga onomatopoeia, ZZZ-style combo rank, overheat banner and multi-kill
 * cut-ins. Purely presentational; reads combat-store events and stats.
 */
export function CombatHud({ effectsEnabled, showCrosshair }: { effectsEnabled: boolean; showCrosshair: boolean }) {
  const stats = useSyncExternalStore(combatStats.subscribe, combatStats.get);
  const [pops, setPops] = useState<Pop[]>([]);
  const [hitMark, setHitMark] = useState(0);
  const [killMark, setKillMark] = useState(0);
  const [cutIn, setCutIn] = useState<{ id: number; count: number }>();
  const [overheat, setOverheat] = useState(0);
  const [dash, setDash] = useState(0);
  const nextId = useRef(1);
  const timers = useRef(new Set<number>());

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  useEffect(() => combatEvents.subscribe((event: CombatEvent) => {
    const later = (fn: () => void, ms: number) => {
      const t = window.setTimeout(() => { timers.current.delete(t); fn(); }, ms);
      timers.current.add(t);
    };
    const push = (pop: Omit<Pop, "id" | "tilt">, life: number) => {
      const id = nextId.current++;
      setPops((list) => [...list.slice(-24), { ...pop, id, tilt: (Math.random() - 0.5) * 18 }]);
      later(() => setPops((list) => list.filter((p) => p.id !== id)), life);
    };
    const onScreen = (x: number, y: number) => x > -0.1 && x < 1.1 && y > -0.1 && y < 1.1;
    if (event.type === "hit") {
      setHitMark((n) => n + 1);
      if (onScreen(event.x, event.y)) push({ kind: "dmg", x: event.x + (Math.random() - 0.5) * 0.03, y: event.y - 0.02, text: String(event.damage), crit: event.crit }, 700);
    } else if (event.type === "kill") {
      setKillMark((n) => n + 1);
      if (effectsEnabled && onScreen(event.x, event.y)) {
        const [jp, en] = KILL_SFX[Math.floor(Math.random() * KILL_SFX.length)]!;
        push({ kind: "sfx", x: event.x, y: event.y - 0.05, text: jp, sub: en, tone: event.big ? "#ff5a3d" : "#ffd23f" }, 900);
      }
      push({ kind: "score", x: 0.5, y: 0.6, text: `+${event.score}` }, 900);
    } else if (event.type === "bounce" && effectsEnabled && event.speed > 7 && onScreen(event.x, event.y)) {
      const [jp, en] = BOUNCE_SFX[Math.floor(Math.random() * BOUNCE_SFX.length)]!;
      push({ kind: "sfx", x: event.x + 0.06, y: event.y - 0.08, text: jp, sub: en, tone: "#fff4df" }, 650);
    } else if (event.type === "multikill" && event.count >= 2) {
      const id = nextId.current++;
      setCutIn({ id, count: event.count });
      later(() => setCutIn((c) => (c?.id === id ? undefined : c)), 1150);
    } else if (event.type === "overheat") {
      // A short callout; the crosshair ring carries the cooling state.
      const id = nextId.current++;
      setOverheat(id);
      later(() => setOverheat((current) => (current === id ? 0 : current)), 1100);
    } else if (event.type === "dash" && effectsEnabled) {
      setDash((n) => n + 1);
    }
  }), [effectsEnabled]);

  const rank = comboRank(stats.combo);
  const heatDash = `${(stats.heat * 100).toFixed(1)} 100`;
  return (
    <div className="combat-hud" aria-hidden="true">
      {showCrosshair && (
        <div className={`crosshair ${stats.overheated ? "is-hot" : ""}`}>
          <svg viewBox="-30 -30 60 60">
            <circle className="heat-track" r="22" pathLength={100} />
            <circle className="heat-fill" r="22" pathLength={100} strokeDasharray={heatDash} transform="rotate(-90)" />
            <path className="ticks" d="M-12 0H-5M5 0H12M0 -12V-5M0 5V12" />
            <circle className="pip" r="1.6" />
          </svg>
          {hitMark > 0 && <svg key={`h${hitMark}`} className="hit-mark" viewBox="-30 -30 60 60"><path d="M-13 -13L-6 -6M13 -13L6 -6M-13 13L-6 6M13 13L6 6" /></svg>}
          {killMark > 0 && <svg key={`k${killMark}`} className="kill-mark" viewBox="-30 -30 60 60"><path d="M-17 -17L-5 -5M17 -17L5 -5M-17 17L-5 5M17 17L5 5" /></svg>}
        </div>
      )}
      {stats.combo > 1 && (
        <div className={`combo-panel rank-${rank.toLowerCase()}`}>
          <div className="combo-rank" key={rank}>{rank}</div>
          <div className="combo-count"><b key={stats.combo}>{stats.combo}</b><span>HITS</span></div>
          <i className="combo-timer"><em style={{ width: `${stats.comboLeft * 100}%` }} /></i>
        </div>
      )}
      <div className="score-chip"><span>SCORE</span><b>{stats.score.toLocaleString()}</b><small>{stats.kills} DOWN</small></div>
      {pops.map((p) => (
        <div
          key={p.id}
          className={`pop pop-${p.kind} ${p.crit ? "is-crit" : ""}`}
          style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, "--tilt": `${p.tilt}deg`, "--tone": p.tone } as CSSProperties}
        >
          {p.text}{p.sub && <small>{p.sub}</small>}
        </div>
      ))}
      {overheat > 0 && <div key={overheat} className="overheat-banner"><span>OVERHEAT</span><small>VENTING</small></div>}
      {dash > 0 && <div key={dash} className="dash-burst"><svg viewBox="0 0 1000 700" preserveAspectRatio="none">{focusLines(28, dash)}</svg><b>シュッ</b></div>}
      {cutIn && effectsEnabled && (
        <div key={cutIn.id} className="cut-in">
          <div className="cut-in-panel">
            <span>{cutIn.count >= 5 ? "RAMPAGE" : MULTI[cutIn.count]}</span>
            <b>{cutIn.count >= 5 ? "暴走" : "KILL"}</b>
            <small>×{cutIn.count} TARGETS DOWN</small>
          </div>
        </div>
      )}
    </div>
  );
}

/** Tapered manga focus lines from the frame edge toward the centre. */
export function focusLines(count: number, seed: number, reach = 0.55) {
  const lines = [];
  for (let i = 0; i < count; i++) {
    const r = ((Math.sin((i + 1) * 91.7 + seed * 13.1) * 43758.5453) % 1 + 1) % 1;
    const a = (i / count) * Math.PI * 2 + r * 0.2;
    const inner = reach + r * 0.25;
    const w = 0.012 + r * 0.02;
    const x = (t: number, off = 0) => 500 + Math.cos(a + off) * 620 * t;
    const y = (t: number, off = 0) => 350 + Math.sin(a + off) * 480 * t;
    lines.push(<polygon key={i} points={`${x(1.2, -w)},${y(1.2, -w)} ${x(1.2, w)},${y(1.2, w)} ${x(inner)},${y(inner)}`} />);
  }
  return lines;
}
