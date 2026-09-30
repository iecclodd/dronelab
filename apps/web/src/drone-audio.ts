import type { MutableRefObject } from "react";
import type { PhysicalState } from "../../../packages/contracts";

/** Browser-only synthesized FPV quad audio. Call unlock/start from a user gesture. */
export interface DroneAudioDiagnostics {
  available: boolean;
  enabled: boolean;
  muted: boolean;
  playbackRunning: boolean;
  contextState: AudioContextState | "uninitialized" | "unavailable";
}

export interface DroneAudioRefs {
  stateRef: MutableRefObject<PhysicalState | undefined>;
  modeRef: MutableRefObject<string>;
}

const MIN_VOLUME = 0;
const MAX_VOLUME = 0.35;
const DEFAULT_VOLUME = 0.2;
const RAMP_SECONDS = 0.035;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function isTerminal(state: PhysicalState | undefined): boolean {
  return Boolean(state?.terminated || state?.truncated);
}

interface MotorVoice {
  oscillator: OscillatorNode;
  harmonic: OscillatorNode;
  gain: GainNode;
}

/**
 * Owns one small, original-synthesis audio graph. It has no timers: callers may
 * call sync() from an existing render/simulation loop and it always reads the
 * current refs at that moment.
 */
export class DroneAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private windGain?: GainNode;
  private windFilter?: BiquadFilterNode;
  private impactGain?: GainNode;
  private voices: MotorVoice[] = [];
  private enabled = true;
  private muted = false;
  private volume = DEFAULT_VOLUME;
  private started = false;
  private disposed = false;
  private lastCollisions = 0;
  private generation = 0;
  private suspendTimer?: number;
  private impactUntil = 0;
  private pendingImpact = 0;
  private suspending?: Promise<void>;
  private readonly onBlur = () => { this.pendingImpact = 0; this.stopPlayback(); };
  private readonly onVisibility = () => {
    if (document.visibilityState === "hidden") { this.pendingImpact = 0; this.stopPlayback(); }
  };

  constructor(private readonly refs?: DroneAudioRefs) {}

  /**
   * Create/resume audio only inside a click, key, or other user gesture.
   * Resolving this promise means the context is running, not that speakers are
   * audible (muting, device volume, and browser routing remain external).
   */
  async unlock(): Promise<DroneAudioDiagnostics> {
    if (this.disposed || !this.enabled || this.muted || typeof window === "undefined") return this.diagnostics();
    window.clearTimeout(this.suspendTimer);
    this.suspendTimer = undefined;
    const AudioContextConstructor = window.AudioContext;
    if (!AudioContextConstructor) return this.diagnostics();
    if (!this.context || this.context.state === "closed") this.createGraph(AudioContextConstructor);
    if (this.suspending) await this.suspending;
    if (this.context?.state === "suspended") await this.context.resume();
    return this.diagnostics();
  }

  /** Start from a user gesture, then apply the most recent state immediately. */
  async start(): Promise<DroneAudioDiagnostics> {
    const generation = this.generation;
    await this.unlock();
    if (this.disposed || generation !== this.generation || document.hidden || !document.hasFocus() || this.muted) {
      this.stopPlayback();
      return this.diagnostics();
    }
    this.started = this.context?.state === "running";
    if (this.started && this.pendingImpact && this.context) {
      this.impact(this.pendingImpact, this.context.currentTime);
      this.pendingImpact = 0;
    }
    this.sync();
    return this.diagnostics();
  }

  async resume(): Promise<DroneAudioDiagnostics> {
    return this.start();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) { this.pendingImpact = 0; this.stopPlayback(); }
    else this.applyMasterGain();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) { this.pendingImpact = 0; this.stopPlayback(); }
    this.applyMasterGain();
  }

  toggleMuted(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  setVolume(volume: number): number {
    this.volume = clamp(volume, MIN_VOLUME, MAX_VOLUME);
    this.applyMasterGain();
    return this.volume;
  }

  /** Read current refs without subscribing, rendering, or starting an interval. */
  sync(): void {
    if (!this.refs) return;
    this.updateFromPhysicalState(this.refs.stateRef.current, this.refs.modeRef.current);
  }

  updateFromPhysicalState(state: PhysicalState | undefined, mode: string): void {
    const collisions = state?.collisions ?? 0;
    const collisionDelta = collisions - this.lastCollisions;
    if (collisionDelta < 0) this.pendingImpact = 0;
    const hit = collisions > this.lastCollisions;
    this.lastCollisions = collisions;
    if (this.context && this.started && !this.muted && hit && (mode === "realtime" || isTerminal(state))) {
      this.impact(collisionDelta, this.context.currentTime);
    } else if (hit && isTerminal(state) && this.context && !this.started && this.enabled && !this.muted && !document.hidden && document.hasFocus()) {
      this.pendingImpact += collisionDelta;
    }
    if (!this.context || !this.enabled || mode !== "realtime" || isTerminal(state)) {
      const tail = Boolean(isTerminal(state) && this.context && this.context.currentTime < this.impactUntil && !this.muted);
      this.stopPlayback(tail);
      return;
    }
    // Realtime snapshots can arrive while resume() is awaiting the audio thread.
    // They must not invalidate that user-initiated start or re-suspend its graph.
    if (!this.started) return;
    const now = this.context.currentTime;
    const speed = Math.hypot(...(state?.velocity ?? [0, 0, 0]));
    const motors = state?.motors ?? [];
    for (let index = 0; index < this.voices.length; index++) {
      const motor = clamp(motors[index] ?? 0, 0, 1);
      const detune = [-7, 5, -3, 9][index] ?? 0;
      const fundamental = 65 + motor * 210 + speed * 2.6 + detune;
      const voice = this.voices[index]!;
      this.ramp(voice.oscillator.frequency, fundamental, now, 0.025);
      this.ramp(voice.harmonic.frequency, fundamental * 2.03, now, 0.025);
      this.ramp(voice.gain.gain, 0.006 + motor * 0.035, now, RAMP_SECONDS);
    }
    this.ramp(this.windGain!.gain, clamp(speed * 0.007, 0, 0.075), now, 0.08);
    this.ramp(this.windFilter!.frequency, 350 + clamp(speed * 135, 0, 4000), now, 0.08);
    this.applyMasterGain();
  }

  /** Fade output promptly on pause, terminal state, blur, or hidden document. */
  silence(): void {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    this.ramp(this.master.gain, 0, now, RAMP_SECONDS);
  }

  private stopPlayback(keepImpact = false): void {
    this.generation++;
    this.started = false;
    this.silence();
    if (this.context && this.impactGain && !keepImpact) this.ramp(this.impactGain.gain, 0, this.context.currentTime, RAMP_SECONDS);
    if (this.context?.state === "running" && this.suspendTimer === undefined) {
      this.suspendTimer = window.setTimeout(() => {
        this.suspendTimer = undefined;
        if (!this.started && this.context?.state === "running") {
          this.suspending = this.context.suspend().catch(() => undefined).finally(() => { this.suspending = undefined; });
        }
      }, keepImpact ? 200 : 70);
    }
  }

  diagnostics(): DroneAudioDiagnostics {
    return {
      available: typeof window !== "undefined" && Boolean(window.AudioContext),
      enabled: this.enabled,
      muted: this.muted,
      playbackRunning: this.started && this.context?.state === "running" && this.enabled && !this.muted,
      contextState: this.context?.state ?? (typeof window !== "undefined" && window.AudioContext ? "uninitialized" : "unavailable"),
    };
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.stopPlayback();
    window.clearTimeout(this.suspendTimer);
    this.suspendTimer = undefined;
    window.removeEventListener("blur", this.onBlur);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.voices.forEach((voice) => { voice.oscillator.stop(); voice.harmonic.stop(); });
    this.voices = [];
    const context = this.context;
    this.context = undefined;
    this.master = undefined;
    this.windGain = undefined;
    this.windFilter = undefined;
    this.impactGain = undefined;
    this.started = false;
    if (context && context.state !== "closed") await context.close();
  }

  private createGraph(AudioContextConstructor: typeof AudioContext): void {
    const context = new AudioContextConstructor();
    const master = context.createGain();
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -18;
    limiter.knee.value = 12;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.12;
    master.gain.value = 0;
    master.connect(limiter).connect(context.destination);
    this.context = context;
    this.master = master;
    this.voices = [-0.65, -0.22, 0.22, 0.65].map((pan, index) => {
      const oscillator = context.createOscillator();
      const harmonic = context.createOscillator();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      const panner = context.createStereoPanner();
      oscillator.type = "sawtooth";
      harmonic.type = "triangle";
      filter.type = "lowpass";
      filter.frequency.value = 720 + index * 70;
      gain.gain.value = 0;
      panner.pan.value = pan;
      oscillator.connect(filter).connect(gain);
      harmonic.connect(gain);
      gain.connect(panner).connect(master);
      oscillator.start();
      harmonic.start();
      return { oscillator, harmonic, gain };
    });
    const wind = context.createBufferSource();
    wind.buffer = this.noiseBuffer(context, 1.5);
    wind.loop = true;
    const windFilter = context.createBiquadFilter();
    const windGain = context.createGain();
    windFilter.type = "bandpass";
    windFilter.Q.value = 0.65;
    windGain.gain.value = 0;
    wind.connect(windFilter).connect(windGain).connect(master);
    wind.start();
    this.windFilter = windFilter;
    this.windGain = windGain;
    this.impactGain = context.createGain();
    this.impactGain.gain.value = this.volume;
    this.impactGain.connect(limiter);
    window.addEventListener("blur", this.onBlur);
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  private impact(increments: number, now: number): void {
    if (!this.context || !this.impactGain) return;
    this.impactUntil = now + .16;
    this.impactGain.gain.cancelScheduledValues(now);
    this.impactGain.gain.setValueAtTime(this.volume, now);
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(130, now);
    oscillator.frequency.exponentialRampToValueAtTime(46, now + 0.11);
    const level = clamp(increments * 0.045, 0, 0.09);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(level, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
    oscillator.connect(gain).connect(this.impactGain);
    oscillator.start(now);
    oscillator.stop(now + 0.14);
  }

  /**
   * One-shot combat sounds, synthesized like the motor voices. They share the
   * impact bus, so mute, pause, blur and gesture gating all still apply.
   */
  sfx(kind: "shot" | "hit" | "dash" | "boom" | "bounce", strength = 1): void {
    const context = this.context;
    if (!context || !this.impactGain || !this.started || this.muted || !this.enabled) return;
    const now = context.currentTime;
    const out = context.createGain();
    out.connect(this.impactGain);
    const noise = (seconds: number) => {
      const source = context.createBufferSource();
      source.buffer = this.noiseBuffer(context, seconds);
      return source;
    };
    const envelope = (param: AudioParam, peak: number, attack: number, decay: number) => {
      param.setValueAtTime(0.0001, now);
      param.exponentialRampToValueAtTime(Math.max(peak, 0.0002), now + attack);
      param.exponentialRampToValueAtTime(0.0001, now + attack + decay);
    };
    if (kind === "shot") {
      const crack = noise(0.06), band = context.createBiquadFilter(), thump = context.createOscillator(), thumpGain = context.createGain();
      band.type = "bandpass"; band.frequency.value = 2100 + Math.random() * 500; band.Q.value = 0.9;
      thump.type = "triangle"; thump.frequency.setValueAtTime(150, now); thump.frequency.exponentialRampToValueAtTime(60, now + 0.05);
      envelope(out.gain, 0.05, 0.002, 0.05);
      envelope(thumpGain.gain, 0.6, 0.002, 0.05);
      crack.connect(band).connect(out); thump.connect(thumpGain).connect(out);
      crack.start(now); thump.start(now); thump.stop(now + 0.07);
    } else if (kind === "hit") {
      const tick = context.createOscillator();
      tick.type = "square"; tick.frequency.setValueAtTime(2600, now); tick.frequency.exponentialRampToValueAtTime(1500, now + 0.03);
      envelope(out.gain, 0.018, 0.001, 0.035);
      tick.connect(out); tick.start(now); tick.stop(now + 0.05);
    } else if (kind === "dash") {
      const whoosh = noise(0.3), band = context.createBiquadFilter();
      band.type = "bandpass"; band.Q.value = 1.4;
      band.frequency.setValueAtTime(400, now); band.frequency.exponentialRampToValueAtTime(2600, now + 0.22);
      envelope(out.gain, 0.08, 0.02, 0.24);
      whoosh.connect(band).connect(out); whoosh.start(now);
    } else if (kind === "bounce") {
      const boing = context.createOscillator();
      boing.type = "sine"; boing.frequency.setValueAtTime(180, now); boing.frequency.exponentialRampToValueAtTime(420, now + 0.08); boing.frequency.exponentialRampToValueAtTime(140, now + 0.22);
      envelope(out.gain, clamp(0.04 + strength * 0.004, 0.04, 0.12), 0.004, 0.22);
      boing.connect(out); boing.start(now); boing.stop(now + 0.26);
    } else {
      const rumble = noise(0.9), low = context.createBiquadFilter(), sub = context.createOscillator(), subGain = context.createGain();
      low.type = "lowpass"; low.frequency.setValueAtTime(1600, now); low.frequency.exponentialRampToValueAtTime(90, now + 0.8);
      sub.type = "sine"; sub.frequency.setValueAtTime(70, now); sub.frequency.exponentialRampToValueAtTime(28, now + 0.6);
      envelope(out.gain, clamp(0.16 * strength, 0.05, 0.3), 0.004, 0.85);
      envelope(subGain.gain, 1.4, 0.004, 0.6);
      rumble.connect(low).connect(out); sub.connect(subGain).connect(out);
      rumble.start(now); sub.start(now); sub.stop(now + 0.7);
    }
    window.setTimeout(() => out.disconnect(), 1200);
  }

  private applyMasterGain(): void {
    if (!this.context || !this.master) return;
    const live = this.started && this.enabled && !this.muted;
    this.ramp(this.master.gain, live ? this.volume : 0, this.context.currentTime, RAMP_SECONDS);
    if (this.impactGain) this.ramp(this.impactGain.gain, live ? this.volume : 0, this.context.currentTime, RAMP_SECONDS);
  }

  private ramp(param: AudioParam, value: number, now: number, seconds: number): void {
    param.cancelScheduledValues(now);
    param.setTargetAtTime(value, now, seconds);
  }

  private noiseBuffer(context: AudioContext, seconds: number): AudioBuffer {
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * seconds), context.sampleRate);
    const values = buffer.getChannelData(0);
    for (let index = 0; index < values.length; index++) values[index] = Math.random() * 2 - 1;
    return buffer;
  }
}

export function createDroneAudio(refs?: DroneAudioRefs): DroneAudio {
  return new DroneAudio(refs);
}
