import * as Tone from 'tone';
import { midiToFrequency } from '../music/pitch';
import type { Instrument } from '../scene/types';
import { notesInWindow, type NoteEvent, type NoteTemplate, type PlanByLaunch } from '../timing/arrivals';
import { BeatClock } from '../timing/clock';
import type { PulseSource } from '../timing/sources';
import { DRUM_BASE_MIDI, DrumKit } from './drums';
import { ENVELOPES, holdSeconds } from './instruments';

/**
 * How far ahead notes are handed to the audio thread. Generous on purpose: a heavy frame can
 * block the main thread for a few hundred ms, and anything not yet scheduled by then would
 * be lost. Scene edits still reach the ear within this window.
 */
const LOOKAHEAD_S = 0.8;
/** Notes up to this late (main thread was stalled) still play, a hair late, instead of vanishing. */
const LATE_TOLERANCE_S = 0.12;
const TICK_S = 0.04;
/**
 * How long a synth voice may sit silent before it is disposed. Light that comes round again
 * (a lens spinning once every few bars) finds its voices still there: building them anew
 * each time wires dozens of nodes into the running graph, which is what makes audio crackle.
 * The shared voice budget still caps how many are kept.
 */
const IDLE_VOICE_S = 20;

/** A note as scheduled on the audio clock; kept briefly so visuals can react to it. */
export interface ScheduledNote extends NoteEvent {
  time: number;
  holdS: number;
}

/** Shared per-instrument bus: level plus reverb and delay sends. */
interface Bus {
  input: Tone.Gain;
}

/** Where one note sits: its own tone (low-pass cutoff, Hz) and stereo position. */
interface NotePlace {
  cutoff: number;
  pan: number;
}

/**
 * Synth voices alive across every receptor. A table of many receptors (a carousel of nine)
 * would otherwise build dozens of synths, each a handful of audio nodes, and the audio
 * thread falls behind: crackle, then silence. At the limit a receptor re-uses its own
 * voices instead of building new ones.
 */
export interface VoiceBudget {
  live: number;
  max: number;
}

/** Anything a receptor can play through: a polyphonic synth or the drum kit. */
interface Player {
  play(midi: number, holdS: number, time: number, velocity: number, place: NotePlace): void;
  release(time: number): void;
  output: Tone.ToneAudioNode;
  dispose(): void;
  /** True when every note gets its own tone and stereo position (pooled synths). */
  readonly perNote: boolean;
}

/**
 * Each receptor has its own player. Synth voices carry their own filter and panner, so the
 * notes of a chord sit where their colours land; the drum kit is one instrument, so it has
 * one filter and panner for the receptor.
 */
interface ReceptorVoice {
  instrument: Instrument;
  player: Player;
  filter: Tone.BiquadFilter | null;
  panner: Tone.Panner | null;
}

/** Filter cutoff for a receptor: diffuse light sounds warm, focused light bright. */
export function cutoffFor(instrument: Instrument, brightness: number): number {
  const base = instrument === 'pad' ? 1300 : instrument === 'pluck' ? 2400 : instrument === 'drums' ? 5000 : 3600;
  return Math.min(16000, base * 2 ** (brightness * 2.4));
}

export type AudioStatus = 'running' | 'suspended';

let playbackContextInstalled = false;

/**
 * Owns the Tone.js graph and the look-ahead scheduler. Notes are computed from the note
 * plan for a window slightly ahead of the audio clock and handed to Tone with explicit
 * times; nothing is ever triggered from UI or render callbacks.
 *
 * The engine remembers the context it was built in and never reads Tone's global context
 * afterwards: an offline recording swaps the global context, and a live engine that
 * followed it would build voices in the wrong context and fall silent.
 */
export class AudioEngine {
  readonly clock: BeatClock;
  private ctx: Tone.BaseContext | null = null;
  private buses: Record<Instrument, Bus> | null = null;
  private receptorVoices = new Map<string, ReceptorVoice>();
  /** Synth voices per pitched instrument, shared by its receptors (see VoicePool). */
  private pools = new Map<Instrument, VoicePool>();
  private budget: VoiceBudget = { live: 0, max: 22 };
  private nodes: Tone.ToneAudioNode[] = [];
  private master: Tone.Volume | null = null;
  private interval: number | null = null;
  private scheduledUntil = 0;
  private templates: NoteTemplate[] = [];
  /** Moving optics: templates by pulse launch (null when nothing moves). */
  private moving: PlanByLaunch | null = null;
  private sources = new Map<string, PulseSource>();
  private recent: ScheduledNote[] = [];
  playing = false;
  /** Called when the browser suspends or resumes audio. */
  onStatus: ((s: AudioStatus) => void) | null = null;
  private lastStatus: AudioStatus = 'running';

  constructor(bpm: number) {
    this.clock = new BeatClock(bpm);
  }

  get ready(): boolean {
    return this.buses !== null;
  }

  /** Must be called from a user gesture. Builds the graph once. */
  async start(masterDb: number): Promise<void> {
    if (!playbackContextInstalled) {
      // A "playback" context uses larger audio buffers: a little more output latency (which
      // the visuals already compensate for) in exchange for far fewer dropouts when the
      // page is busy drawing.
      Tone.setContext(new Tone.Context({ latencyHint: 'playback', lookAhead: 0 }));
      playbackContextInstalled = true;
    }
    await Tone.start();
    await this.buildGraph(masterDb);
  }

  /** Try to resume a context the browser suspended (call from a user gesture). */
  async resume(): Promise<void> {
    const raw = this.ctx?.rawContext as AudioContext | undefined;
    if (raw && raw.state !== 'running' && 'resume' in raw) await raw.resume();
    this.checkStatus();
  }

  /** Build the synth graph in the current Tone context (live or offline). */
  async buildGraph(masterDb: number): Promise<void> {
    if (this.buses) return;
    const context = Tone.getContext();
    this.ctx = context;
    const master = new Tone.Volume({ volume: masterDb, context }).connect(context.destination);
    const limiter = new Tone.Limiter({ threshold: -1, context }).connect(master);
    const comp = new Tone.Compressor({ threshold: -18, ratio: 2.5, attack: 0.01, release: 0.25, context }).connect(limiter);
    // A long tail is a long convolution on the audio thread: five seconds is plenty.
    const reverb = new Tone.Reverb({ decay: 5, preDelay: 0.03, wet: 1, context }).connect(comp);
    await reverb.ready;
    const delay = new Tone.PingPongDelay({ delayTime: '8n.', feedback: 0.28, wet: 1, context }).connect(reverb);
    const dry = new Tone.Gain({ gain: 1, context }).connect(comp);

    const bus = (level: number, reverbSend: number, delaySend: number): Bus => {
      const input = new Tone.Gain({ gain: level, context });
      input.connect(dry);
      const r = new Tone.Gain({ gain: reverbSend, context }).connect(reverb);
      const d = new Tone.Gain({ gain: delaySend, context }).connect(delay);
      input.connect(r);
      input.connect(d);
      this.nodes.push(input, r, d);
      return { input };
    };
    this.buses = {
      pad: bus(0.85, 0.55, 0.05),
      pluck: bus(1.3, 0.3, 0.22),
      bell: bus(1.15, 0.5, 0.18),
      drums: bus(0.8, 0.12, 0.04),
    };
    this.master = master;
    this.nodes.push(limiter, comp, reverb, delay, dry, master);
  }

  setPlan(templates: NoteTemplate[], sources: Map<string, PulseSource>, moving: PlanByLaunch | null = null): void {
    this.templates = templates;
    this.moving = moving;
    this.sources = sources;
    // Retire voices of receptors that no longer receive light (let their tails ring out).
    const live = new Set(templates.map((t) => `${t.receptorId}|${t.instrument}`));
    for (const [id, v] of this.receptorVoices) {
      if (live.has(`${id}|${v.instrument}`)) continue;
      this.receptorVoices.delete(id);
      const dispose = (): void => this.disposeVoice(v);
      if (this.ctx?.rawContext instanceof OfflineAudioContext) dispose();
      else window.setTimeout(dispose, 6000);
    }
  }

  private disposeVoice(v: ReceptorVoice): void {
    v.player.dispose();
    v.filter?.dispose();
    v.panner?.dispose();
  }

  private voiceFor(receptorId: string, instrument: Instrument, voices: number): ReceptorVoice | null {
    if (!this.buses || !this.ctx) return null;
    const existing = this.receptorVoices.get(receptorId);
    if (existing && existing.instrument === instrument) return existing;
    const context = this.ctx;
    let v: ReceptorVoice;
    if (instrument !== 'drums') {
      let pool = this.pools.get(instrument);
      if (!pool) {
        pool = new VoicePool(context, () => makeSynth(instrument, context), ENVELOPES[instrument].release, this.budget);
        pool.output.connect(this.buses[instrument].input);
        this.pools.set(instrument, pool);
      }
      const shared = pool;
      const max = poolSize(voices);
      const player: Player = {
        play: (midi, holdS, time, velocity, place) => shared.play(receptorId, max, midi, holdS, time, velocity, place),
        release: (time) => shared.release(receptorId, time),
        output: shared.output,
        // The voices belong to the pool: tails ring out, and other receptors reuse them.
        dispose: () => {},
        perNote: true,
      };
      v = { instrument, player, filter: null, panner: null };
    } else {
      const player = createKit(context);
      const filter = toneFilter(context, cutoffFor(instrument, 0.3));
      const panner = new Tone.Panner({ pan: 0, context });
      player.output.chain(filter, panner, this.buses[instrument].input);
      v = { instrument, player, filter, panner };
    }
    this.receptorVoices.set(receptorId, v);
    return v;
  }

  /** Most synth voices alive at once, over all receptors (see VoiceBudget). */
  setVoiceBudget(max: number): void {
    this.budget.max = Math.max(4, Math.round(max));
  }

  setMasterDb(db: number): void {
    this.master?.volume.rampTo(db, 0.1);
  }

  setBpm(bpm: number): void {
    if (!this.ctx) {
      this.clock.bpm = bpm;
      return;
    }
    const now = this.contextTime();
    this.clock.setBpm(bpm, now);
    // Already-scheduled notes stay; continue from the same beat position.
    this.scheduledUntil = Math.max(this.scheduledUntil, this.clock.beatAt(now));
  }

  /** Where the song stands while stopped: play resumes here (see pause, seek). */
  private heldBeat = 0;

  play(): void {
    if (!this.buses || !this.ctx || this.playing) return;
    const now = this.contextTime() + 0.08;
    this.clock.anchor(now, this.heldBeat);
    this.scheduledUntil = this.heldBeat;
    this.playing = true;
    this.interval = this.ctx.setInterval(() => this.tick(), TICK_S);
    this.tick();
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    if (this.interval !== null) this.ctx?.clearInterval(this.interval);
    this.interval = null;
    const now = this.contextTime();
    // Resume on the next sixteenth after the one being heard.
    this.heldBeat = Math.ceil(this.clock.beatAt(now) * 4) / 4;
    for (const v of this.receptorVoices.values()) v.player.release(now);
    this.recent = [];
  }

  /** The song position, in beats: where it plays now, or where it will resume. */
  position(): number {
    return this.playing ? this.clock.beatAt(this.heardTime()) : this.heldBeat;
  }

  /**
   * Jump the song to `beat` (all cards and rings together). Light already in flight at that
   * point of the song plays out as it would have, so the jump lands mid-phrase, not on silence.
   */
  seek(beat: number): void {
    const b = Math.max(0, beat);
    this.heldBeat = b;
    if (!this.playing || !this.ctx) return;
    const now = this.contextTime();
    for (const v of this.receptorVoices.values()) v.player.release(now);
    this.recent = [];
    this.clock.anchor(now + 0.05, b);
    this.scheduledUntil = b;
  }

  private checkStatus(): void {
    const raw = this.ctx?.rawContext as AudioContext | undefined;
    if (!raw || raw instanceof OfflineAudioContext) return;
    const status: AudioStatus = raw.state === 'running' ? 'running' : 'suspended';
    if (status !== this.lastStatus) {
      this.lastStatus = status;
      this.onStatus?.(status);
    }
  }

  private tick(): void {
    if (!this.buses || !this.playing) return;
    this.checkStatus();
    const now = this.contextTime();
    const toBeat = this.clock.beatAt(now + LOOKAHEAD_S);
    // If the main thread stalled, skip what is already late rather than bunching it up.
    const fromBeat = Math.max(this.scheduledUntil, this.clock.beatAt(now - LATE_TOLERANCE_S));
    if (toBeat <= fromBeat) return;
    this.scheduleBeats(fromBeat, toBeat, now);
  }

  /**
   * Hand every note with onset in [fromBeat, toBeat) to the players. `firstLaunch` drops
   * notes from pulses launched before it (a recording starts with no light in flight).
   */
  scheduleBeats(fromBeat: number, toBeat: number, now: number, firstLaunch = -Infinity): void {
    if (!this.buses) return;
    const events = notesInWindow(this.moving ?? this.templates, this.sources, fromBeat, toBeat).filter((e) => e.launchBeat >= firstLaunch);
    this.scheduledUntil = toBeat;
    // The drum kit has one tone filter and one panner per receptor: hits struck together
    // share them, set to their loudness-weighted average. Synth notes each have their own.
    const shared = new Map<string, { w: number; brightness: number; pan: number }>();
    for (const e of events) {
      const key = `${e.receptorId}|${e.beat}`;
      const a = shared.get(key) ?? { w: 0, brightness: 0, pan: 0 };
      a.w += e.velocity;
      a.brightness += e.brightness * e.velocity;
      a.pan += e.pan * e.velocity;
      shared.set(key, a);
    }
    for (const e of events) {
      let time = this.clock.timeAt(e.beat);
      if (time < now - LATE_TOLERANCE_S) continue;
      time = Math.max(time, now + 0.005);
      const holdS = holdSeconds(e.instrument, e.lenBeats * this.clock.secondsPerBeat);
      const v = this.voiceFor(e.receptorId, e.instrument, e.voices);
      if (!v) continue;
      try {
        if (v.filter && v.panner) {
          const mix = shared.get(`${e.receptorId}|${e.beat}`)!;
          const w = Math.max(1e-6, mix.w);
          v.filter.frequency.setTargetAtTime(cutoffFor(e.instrument, mix.brightness / w), Math.max(now, time - 0.05), 0.08);
          v.panner.pan.setTargetAtTime(mix.pan / w, Math.max(now, time - 0.05), 0.1);
        }
        v.player.play(e.midi, holdS, time, e.velocity, { cutoff: cutoffFor(e.instrument, e.brightness), pan: e.pan });
      } catch (err) {
        // A broken voice must not silence the instrument: drop it, the next note rebuilds it.
        console.warn('Spectral Loom: voice failed, rebuilding', err);
        this.receptorVoices.delete(e.receptorId);
        this.disposeVoice(v);
        continue;
      }
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
    return this.ctx ? this.ctx.rawContext.currentTime : 0;
  }

  /**
   * The audio-clock time of the sound currently leaving the speakers. Visuals are drawn
   * for this moment, so light and sound line up despite output latency.
   */
  heardTime(): number {
    const raw = this.ctx?.rawContext as AudioContext | undefined;
    if (!raw) return 0;
    const ts = typeof raw.getOutputTimestamp === 'function' ? raw.getOutputTimestamp() : null;
    if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.contextTime > 0) {
      return ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
    }
    return raw.currentTime - (raw.outputLatency || raw.baseLatency || 0);
  }

  dispose(): void {
    this.pause();
    for (const v of this.receptorVoices.values()) this.disposeVoice(v);
    this.receptorVoices.clear();
    for (const pool of this.pools.values()) pool.dispose();
    this.pools.clear();
    for (const n of this.nodes) n.dispose();
    this.nodes = [];
    this.buses = null;
  }
}

/**
 * Our own voice allocation. Tone's PolySynth frees a voice when its envelope reports
 * silence, which misfires when notes are scheduled ahead of time: voices leak until every
 * note is "Max polyphony exceeded. Note dropped." — the instrument goes quiet until reload.
 * Here each voice is busy until a time we compute ourselves; when all are busy, the one
 * that frees up soonest is stolen. A note is never dropped.
 */
/** The monophonic synths a pool is built from. */
type MonoVoice = Tone.Synth | Tone.MonoSynth | Tone.FMSynth;

/** One pooled voice: a synth with its own tone filter and stereo position. */
interface PoolVoice {
  synth: MonoVoice;
  filter: Tone.BiquadFilter;
  panner: Tone.Panner;
  busyUntil: number;
  lastStart: number;
  /** The receptor whose note it plays (or last played). */
  owner: string;
}

/**
 * The synth voices of one instrument, shared by every receptor that plays it. Each voice has
 * its own tone filter and panner, set for every note, so a voice one receptor has finished
 * with can play the next note of any other. Light sweeping from receptor to receptor (a
 * spinning lens) then reuses voices, instead of each receptor building synths when lit and
 * dropping them a few seconds later: every build wires a few dozen nodes into the running
 * audio graph, and dozens of those a minute made the audio crackle and drop out.
 * A receptor still sounds at most its own polyphony at once; beyond that it steals its own
 * voice that frees up soonest, never another receptor's.
 */
class VoicePool {
  readonly output: Tone.Gain;
  private voices: PoolVoice[] = [];
  private gc: number;

  /**
   * Voices are created only when a note needs one and disposed after sitting idle: every
   * Tone synth keeps several audio nodes running even when silent, so pre-built voices would
   * overload the audio thread (crackle, slow-down).
   */
  constructor(
    private context: Tone.BaseContext,
    private make: () => MonoVoice,
    private releaseS: number,
    private budget: VoiceBudget,
  ) {
    this.output = new Tone.Gain({ gain: 1, context });
    this.gc = context.setInterval(() => this.collect(), 2);
  }

  /** Play a note for receptor `owner`, which may sound up to `max` voices at once. */
  play(owner: string, max: number, midi: number, holdS: number, time: number, velocity: number, place: NotePlace): void {
    // Only voices whose last attack is strictly earlier can take this note (Tone requires
    // monotonic start times per source).
    const usable = this.voices.filter((v) => v.lastStart < time - 0.001);
    const sounding = this.voices.filter((v) => v.owner === owner && v.busyUntil > time).length;
    let v: PoolVoice | undefined;
    if (sounding < max) {
      v = usable.find((x) => x.busyUntil <= time);
      // A new voice only within the shared budget; a receptor with none sounding always gets one.
      if (!v && (this.budget.live < this.budget.max || sounding === 0)) v = this.add(place);
    }
    // All of its voices busy: the receptor steals its own that frees up soonest.
    if (!v) {
      const own = usable.filter((x) => x.owner === owner);
      v = own.length ? own.reduce((a, b) => (a.busyUntil <= b.busyUntil ? a : b)) : undefined;
    }
    if (!v) return;
    // Glide tone and position into place just before the attack (a reused or stolen voice
    // may sit elsewhere; a short glide avoids a click).
    const at = Math.max(this.context.rawContext.currentTime, time - 0.012);
    v.filter.frequency.setTargetAtTime(place.cutoff, at, 0.004);
    v.panner.pan.setTargetAtTime(place.pan, at, 0.004);
    v.synth.triggerAttackRelease(midiToFrequency(midi), holdS, time, velocity);
    v.busyUntil = time + holdS + this.releaseS + 0.05;
    v.lastStart = time;
    v.owner = owner;
  }

  private add(place: NotePlace): PoolVoice {
    this.budget.live += 1;
    const synth = this.make();
    const filter = toneFilter(this.context, place.cutoff);
    const panner = new Tone.Panner({ pan: place.pan, context: this.context });
    synth.chain(filter, panner, this.output);
    const v: PoolVoice = { synth, filter, panner, busyUntil: 0, lastStart: -Infinity, owner: '' };
    this.voices.push(v);
    return v;
  }

  /** Dispose voices that have been silent for a while (keep one warm). */
  private collect(): void {
    const now = this.context.rawContext.currentTime;
    const idle = this.voices.filter((v) => v.busyUntil < now - IDLE_VOICE_S);
    for (const v of idle.slice(0, Math.max(0, idle.length - 1))) {
      disposePoolVoice(v);
      this.budget.live -= 1;
      this.voices.splice(this.voices.indexOf(v), 1);
    }
  }

  /** Release the notes of one receptor (pause, seek). */
  release(owner: string, time: number): void {
    for (const v of this.voices) {
      if (v.owner !== owner) continue;
      if (v.busyUntil > time) v.synth.triggerRelease(time);
      v.busyUntil = Math.min(v.busyUntil, time + this.releaseS);
    }
  }

  dispose(): void {
    this.context.clearInterval(this.gc);
    for (const v of this.voices) disposePoolVoice(v);
    this.budget.live -= this.voices.length;
    this.voices = [];
    this.output.dispose();
  }
}

/**
 * A voice's tone filter: one low-pass biquad. Tone.BiquadFilter is the plain native node;
 * Tone.Filter (the same single biquad at −12 dB) drives its frequency, Q, gain and detune from
 * always-running signal nodes, which makes the browser recompute the filter for every sample
 * of every voice, silent or not. With dozens of voices that alone overloads the audio thread.
 */
function toneFilter(context: Tone.BaseContext, frequency: number): Tone.BiquadFilter {
  return new Tone.BiquadFilter({ type: 'lowpass', frequency, Q: 0.6, context });
}

function disposePoolVoice(v: PoolVoice): void {
  v.synth.dispose();
  v.filter.dispose();
  v.panner.dispose();
}

/**
 * Synth voices a receptor may keep: enough for its chords to ring into each other, no more.
 * Every voice is a synth plus its own filter and panner running on the audio thread, and a
 * table of many receptors (a carousel of nine) would otherwise build dozens of them.
 */
function poolSize(voices: number): number {
  return Math.max(2, Math.min(8, Math.round(voices) * 2));
}

/** The drum kit a drum receptor plays through (one per receptor: it has its own tone and position). */
function createKit(context: Tone.BaseContext): Player {
  const kit = new DrumKit(context);
  return {
    play: (midi, _hold, time, velocity) => kit.hit(midi - DRUM_BASE_MIDI, time, velocity),
    release: () => {},
    output: kit.output,
    dispose: () => kit.dispose(),
    perNote: false,
  };
}

/** A new synth voice of a pitched instrument. */
function makeSynth(instrument: Exclude<Instrument, 'drums'>, context: Tone.BaseContext): MonoVoice {
  const env = ENVELOPES[instrument];
  if (instrument === 'pad') {
    return new Tone.Synth({ context, oscillator: { type: 'fatsawtooth', count: 2, spread: 24 }, envelope: { ...env } });
  }
  if (instrument === 'pluck') {
    return new Tone.MonoSynth({
      context,
      oscillator: { type: 'fatsawtooth', count: 2, spread: 8 },
      envelope: { ...env },
      filter: { type: 'lowpass', Q: 1.5, rolloff: -24 },
      filterEnvelope: { attack: 0.002, decay: 0.28, sustain: 0.0, release: 0.3, baseFrequency: 280, octaves: 4.2 },
    });
  }
  return new Tone.FMSynth({
    context,
    harmonicity: 3.01,
    modulationIndex: 11,
    oscillator: { type: 'sine' },
    modulation: { type: 'sine' },
    envelope: { ...env },
    modulationEnvelope: { attack: 0.002, decay: 0.9, sustain: 0, release: 0.8 },
  });
}
