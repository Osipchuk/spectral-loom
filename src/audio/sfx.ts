/**
 * Interface sounds: small glassy clicks, clinks and chimes for handling the instrument, so
 * the table answers even while the music is stopped. Plain WebAudio on its own low-latency
 * context (the music engine uses a large-buffer one), created on the first user gesture.
 * Every sound is a few oscillators or a noise burst that stops itself: nothing keeps running.
 */

const STORAGE_KEY = 'spectral-loom-sfx';

export interface BellOptions {
  /** Partials as frequency ratios with their levels; a glass bell by default. */
  partials?: [number, number][];
  decay?: number;
  gain?: number;
  pan?: number;
  /** Seconds from now. */
  delay?: number;
  /** Oscillator shape of the partials. */
  type?: OscillatorType;
}

export interface NoiseOptions {
  dur: number;
  freq: number;
  q?: number;
  /** Band-pass centre at the end (a sweep); defaults to `freq`. */
  freqTo?: number;
  gain?: number;
  pan?: number;
  delay?: number;
}

export const GLASS: [number, number][] = [
  [1, 1],
  [2.76, 0.28],
  [5.4, 0.1],
];
export const METAL: [number, number][] = [
  [1, 1],
  [2.02, 0.35],
  [3.99, 0.18],
  [6.3, 0.08],
];
export const WOOD: [number, number][] = [
  [1, 1],
  [1.58, 0.3],
];

export class Sfx {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private level = 1;
  private sleepTimer: number | null = null;
  enabled: boolean;

  constructor() {
    this.enabled = readEnabled();
  }

  /** Create or resume the audio context. Call from a user gesture. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor({ latencyHint: 'interactive' });
      this.out = this.ctx.createGain();
      this.out.gain.value = this.level;
      this.out.connect(this.ctx.destination);
      const n = Math.floor(this.ctx.sampleRate * 0.5);
      this.noiseBuf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      let seed = 7;
      for (let i = 0; i < n; i++) {
        seed = (seed * 16807) % 2147483647;
        d[i] = (seed / 2147483647) * 2 - 1;
      }
    }
    this.wake();
  }

  /** Run the context now, and let it sleep a few seconds after the last call. */
  private wake(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'closed') return;
    if (ctx.state === 'suspended') void ctx.resume();
    if (this.sleepTimer !== null) window.clearTimeout(this.sleepTimer);
    this.sleepTimer = window.setTimeout(() => {
      this.sleepTimer = null;
      if (ctx.state === 'running') void ctx.suspend();
    }, 3000);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    try {
      localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
    } catch {
      /* private mode: remember for this page only */
    }
  }

  /** Follow the master volume (dB), a little below the music. */
  setMasterDb(db: number): void {
    this.level = db <= -40 ? 0 : 0.55 * 10 ** (db / 20);
    if (this.out && this.ctx) this.out.gain.setTargetAtTime(this.level, this.ctx.currentTime, 0.03);
  }

  /**
   * The context runs only while sounds play: an idle running context is a second audio
   * thread working alongside the music's. It sleeps a few seconds after the last sound and
   * wakes (within a few milliseconds) for the next one.
   */
  private ready(): AudioContext | null {
    if (!this.enabled || !this.ctx || !this.out || this.level === 0 || this.ctx.state === 'closed') return null;
    this.wake();
    return this.ctx;
  }

  private panner(ctx: AudioContext, pan: number): AudioNode {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(this.out!);
    return p;
  }

  /** A struck bell: inharmonic partials, instant attack, exponential decay. */
  bell(freq: number, o: BellOptions = {}): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + (o.delay ?? 0);
    const decay = o.decay ?? 0.6;
    const dest = this.panner(ctx, o.pan ?? 0);
    const env = ctx.createGain();
    env.connect(dest);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(o.gain ?? 0.2, t + 0.004);
    env.gain.exponentialRampToValueAtTime(1e-4, t + decay);
    for (const [ratio, level] of o.partials ?? GLASS) {
      const f = freq * ratio;
      if (f > 16000) continue;
      const osc = ctx.createOscillator();
      osc.type = o.type ?? 'sine';
      osc.frequency.value = f;
      const g = ctx.createGain();
      // Upper partials die away faster, as on real glass.
      g.gain.setValueAtTime(level, t);
      g.gain.exponentialRampToValueAtTime(Math.max(1e-4, level * 0.02), t + decay / Math.sqrt(ratio));
      osc.connect(g).connect(env);
      osc.start(t);
      osc.stop(t + decay + 0.05);
    }
  }

  /** A pitch glide (power on / off). */
  glide(from: number, to: number, dur: number, gain = 0.12, pan = 0, delay = 0): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(1e-4, t + dur + 0.08);
    osc.connect(g).connect(this.panner(ctx, pan));
    osc.start(t);
    osc.stop(t + dur + 0.12);
  }

  /** A filtered noise burst: clicks, paper, whooshes. */
  noise(o: NoiseOptions): void {
    const ctx = this.ready();
    if (!ctx || !this.noiseBuf) return;
    const t = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = o.q ?? 1.2;
    bp.frequency.setValueAtTime(o.freq, t);
    if (o.freqTo) bp.frequency.exponentialRampToValueAtTime(o.freqTo, t + o.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(o.gain ?? 0.1, t + Math.min(0.01, o.dur / 4));
    g.gain.exponentialRampToValueAtTime(1e-4, t + o.dur);
    src.connect(bp).connect(g).connect(this.panner(ctx, o.pan ?? 0));
    src.start(t, Math.random() * 0.3);
    src.stop(t + o.dur + 0.02);
  }

  dispose(): void {
    if (this.sleepTimer !== null) window.clearTimeout(this.sleepTimer);
    void this.ctx?.close();
    this.ctx = null;
    this.out = null;
  }
}

function readEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}
