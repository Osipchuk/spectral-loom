import * as Tone from 'tone';
import { midiToFrequency } from '../music/pitch';
import type { Instrument } from '../scene/types';
import { notesInWindow, type NoteEvent, type NoteTemplate } from '../timing/arrivals';
import { BeatClock } from '../timing/clock';
import type { PulseSource } from '../timing/sources';
import { ENVELOPES, holdSeconds } from './instruments';

const LOOKAHEAD_S = 0.3;
const TICK_S = 0.04;

/** A note as scheduled on the audio clock; kept briefly so visuals can react to it. */
export interface ScheduledNote extends NoteEvent {
  time: number;
  holdS: number;
}

/** Shared per-instrument bus: level plus reverb and delay sends. */
interface Bus {
  input: Tone.Gain;
}

/** Each receptor has its own synth, tone filter and stereo position. */
interface ReceptorVoice {
  instrument: Instrument;
  synth: Tone.PolySynth;
  filter: Tone.Filter;
  panner: Tone.Panner;
}

/** Filter cutoff for a receptor: diffuse light sounds warm, focused light bright. */
export function cutoffFor(instrument: Instrument, brightness: number): number {
  const base = instrument === 'pad' ? 700 : instrument === 'pluck' ? 1400 : 2200;
  return base * 2 ** (brightness * 3);
}

/**
 * Owns the Tone.js graph and the look-ahead scheduler. Notes are computed from the note
 * plan for a window slightly ahead of the audio clock and handed to Tone with explicit
 * times; nothing is ever triggered from UI or render callbacks.
 */
export class AudioEngine {
  readonly clock: BeatClock;
  private voices: Record<Instrument, Bus> | null = null;
  private receptorVoices = new Map<string, ReceptorVoice>();
  private nodes: Tone.ToneAudioNode[] = [];
  private master: Tone.Volume | null = null;
  private interval: number | null = null;
  private scheduledUntil = 0;
  private templates: NoteTemplate[] = [];
  private sources = new Map<string, PulseSource>();
  private recent: ScheduledNote[] = [];
  playing = false;

  constructor(bpm: number) {
    this.clock = new BeatClock(bpm);
  }

  get ready(): boolean {
    return this.voices !== null;
  }

  /** Must be called from a user gesture. Builds the graph once. */
  async start(masterDb: number): Promise<void> {
    await Tone.start();
    await this.buildGraph(masterDb);
  }

  /** Build the synth graph in the current Tone context (live or offline). */
  async buildGraph(masterDb: number): Promise<void> {
    if (this.voices) return;
    const master = new Tone.Volume(masterDb).toDestination();
    const limiter = new Tone.Limiter(-1).connect(master);
    const comp = new Tone.Compressor({ threshold: -18, ratio: 2.5, attack: 0.01, release: 0.25 }).connect(limiter);
    const reverb = new Tone.Reverb({ decay: 6.5, preDelay: 0.03, wet: 1 }).connect(comp);
    await reverb.ready;
    const delay = new Tone.PingPongDelay({ delayTime: '8n.', feedback: 0.28, wet: 1 }).connect(reverb);
    const dry = new Tone.Gain(1).connect(comp);

    const bus = (level: number, reverbSend: number, delaySend: number): Bus => {
      const input = new Tone.Gain(level);
      input.connect(dry);
      const r = new Tone.Gain(reverbSend).connect(reverb);
      const d = new Tone.Gain(delaySend).connect(delay);
      input.connect(r);
      input.connect(d);
      this.nodes.push(input, r, d);
      return { input };
    };
    this.voices = {
      pad: bus(0.5, 0.55, 0.05),
      pluck: bus(0.8, 0.3, 0.22),
      bell: bus(0.7, 0.5, 0.18),
    };
    this.master = master;
    this.nodes.push(limiter, comp, reverb, delay, dry, master);
  }

  setPlan(templates: NoteTemplate[], sources: Map<string, PulseSource>): void {
    this.templates = templates;
    this.sources = sources;
    // Retire voices of receptors that no longer receive light (let their tails ring out).
    const live = new Set(templates.map((t) => `${t.receptorId}|${t.instrument}`));
    for (const [id, v] of this.receptorVoices) {
      if (live.has(`${id}|${v.instrument}`)) continue;
      this.receptorVoices.delete(id);
      const dispose = (): void => {
        v.synth.dispose();
        v.filter.dispose();
        v.panner.dispose();
      };
      if (Tone.getContext().rawContext instanceof OfflineAudioContext) dispose();
      else window.setTimeout(dispose, 6000);
    }
  }

  private voiceFor(receptorId: string, instrument: Instrument): ReceptorVoice | null {
    if (!this.voices) return null;
    const existing = this.receptorVoices.get(receptorId);
    if (existing && existing.instrument === instrument) return existing;
    const synth = createSynth(instrument);
    const filter = new Tone.Filter({ type: 'lowpass', frequency: cutoffFor(instrument, 0.3), Q: 0.6, rolloff: -12 });
    const panner = new Tone.Panner(0);
    synth.chain(filter, panner, this.voices[instrument].input);
    const v = { instrument, synth, filter, panner };
    this.receptorVoices.set(receptorId, v);
    return v;
  }

  setMasterDb(db: number): void {
    this.master?.volume.rampTo(db, 0.1);
  }

  setBpm(bpm: number): void {
    const now = this.contextTime();
    this.clock.setBpm(bpm, now);
    // Already-scheduled notes stay; continue from the same beat position.
    this.scheduledUntil = Math.max(this.scheduledUntil, this.clock.beatAt(now));
  }

  play(): void {
    if (!this.voices || this.playing) return;
    const now = this.contextTime() + 0.08;
    this.clock.anchor(now, Math.ceil(this.clock.beatAt(now)));
    this.scheduledUntil = this.clock.beatAt(now);
    this.playing = true;
    this.interval = Tone.getContext().setInterval(() => this.tick(), TICK_S);
    this.tick();
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    if (this.interval !== null) Tone.getContext().clearInterval(this.interval);
    this.interval = null;
    const now = this.contextTime();
    for (const v of this.receptorVoices.values()) v.synth.releaseAll(now);
    this.recent = [];
  }

  private tick(): void {
    if (!this.voices || !this.playing) return;
    const now = this.contextTime();
    const toBeat = this.clock.beatAt(now + LOOKAHEAD_S);
    const fromBeat = Math.max(this.scheduledUntil, this.clock.beatAt(now));
    if (toBeat <= fromBeat) return;
    this.scheduleBeats(fromBeat, toBeat, now);
  }

  /**
   * Hand every note with onset in [fromBeat, toBeat) to the synths. `firstLaunch` drops
   * notes from pulses launched before it (a recording starts with no light in flight).
   */
  scheduleBeats(fromBeat: number, toBeat: number, now: number, firstLaunch = -Infinity): void {
    if (!this.voices) return;
    const events = notesInWindow(this.templates, this.sources, fromBeat, toBeat).filter((e) => e.launchBeat >= firstLaunch);
    this.scheduledUntil = toBeat;
    for (const e of events) {
      const time = this.clock.timeAt(e.beat);
      if (time < now) continue;
      const holdS = holdSeconds(e.instrument, e.lenBeats * this.clock.secondsPerBeat);
      const v = this.voiceFor(e.receptorId, e.instrument);
      if (!v) continue;
      v.filter.frequency.setTargetAtTime(cutoffFor(e.instrument, e.brightness), Math.max(now, time - 0.05), 0.08);
      v.panner.pan.setTargetAtTime(e.pan, Math.max(now, time - 0.05), 0.1);
      v.synth.triggerAttackRelease(midiToFrequency(e.midi), holdS, time, e.velocity);
      this.recent.push({ ...e, time, holdS });
    }
    const horizon = now - 8;
    if (this.recent.length > 400 || (this.recent[0] && this.recent[0].time < horizon)) {
      this.recent = this.recent.filter((n) => n.time >= horizon);
    }
  }

  /** Notes scheduled recently or about to play, for visual feedback. */
  recentNotes(): readonly ScheduledNote[] {
    return this.recent;
  }

  contextTime(): number {
    return Tone.getContext().rawContext.currentTime;
  }

  /**
   * The audio-clock time of the sound currently leaving the speakers. Visuals are drawn
   * for this moment, so light and sound line up despite output latency.
   */
  heardTime(): number {
    const raw = Tone.getContext().rawContext as AudioContext;
    const ts = typeof raw.getOutputTimestamp === 'function' ? raw.getOutputTimestamp() : null;
    if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.contextTime > 0) {
      return ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
    }
    return raw.currentTime - (raw.outputLatency || raw.baseLatency || 0);
  }

  dispose(): void {
    this.pause();
    for (const v of this.receptorVoices.values()) {
      v.synth.dispose();
      v.filter.dispose();
      v.panner.dispose();
    }
    this.receptorVoices.clear();
    for (const n of this.nodes) n.dispose();
    this.nodes = [];
    this.voices = null;
  }
}

function createSynth(instrument: Instrument): Tone.PolySynth {
  if (instrument === 'pad') {
    const pad = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'fatsawtooth', count: 3, spread: 22 },
      envelope: { ...ENVELOPES.pad },
    });
    pad.maxPolyphony = 12;
    return pad;
  }
  if (instrument === 'pluck') {
    const pluck = new Tone.PolySynth(Tone.MonoSynth, {
      oscillator: { type: 'fatsawtooth', count: 2, spread: 8 },
      envelope: { ...ENVELOPES.pluck },
      filter: { type: 'lowpass', Q: 1.5, rolloff: -24 },
      filterEnvelope: { attack: 0.002, decay: 0.28, sustain: 0.0, release: 0.3, baseFrequency: 280, octaves: 4.2 },
    });
    pluck.maxPolyphony = 12;
    return pluck;
  }
  const bell = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 3.01,
    modulationIndex: 11,
    oscillator: { type: 'sine' },
    modulation: { type: 'sine' },
    envelope: { ...ENVELOPES.bell },
    modulationEnvelope: { attack: 0.002, decay: 0.9, sustain: 0, release: 0.8 },
  });
  bell.maxPolyphony = 12;
  return bell;
}
