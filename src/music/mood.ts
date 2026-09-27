import type { Instrument, ScaleName } from '../scene/types';

/** How the sky should look, each 0…1. */
export interface Weather {
  aurora: number;
  rain: number;
  snow: number;
  mist: number;
  clouds: number;
  /** Trees and grass sway, rain slants; above ~0.7 it is a gale that bends everything flat. */
  wind: number;
  /** Warm glowing specks over the meadow on calm, bright music. */
  fireflies: number;
  /** Light colour: 0 cold blue moonlight … 1 warm golden. At dusk it picks dawn (cool) or sunset (warm). */
  warmth: number;
  /** Time of day: 0 night under the moon … 1 low sun on the horizon (golden hour or dawn). */
  dusk: number;
  /** The lake: 0 mirror-flat … 1 storm sea with whitecaps. */
  waves: number;
  /** How charged the storm is: the chance that a heavy low hit brings a lightning flash. */
  lightning: number;
}

export const CALM_NIGHT: Weather = {
  aurora: 0.08,
  rain: 0,
  snow: 0,
  mist: 0.35,
  clouds: 0.15,
  wind: 0.12,
  fireflies: 0.35,
  warmth: 0.5,
  dusk: 0,
  waves: 0,
  lightning: 0,
};

/** Every weather field, for loops that must not allocate. */
export const WEATHER_KEYS: readonly (keyof Weather)[] = Object.keys(CALM_NIGHT) as (keyof Weather)[];

const VALENCE: Record<ScaleName, number> = { majorPent: 0.7, major: 0.6, dorian: -0.1, minorPent: -0.55, minor: -0.7 };

/** Drum kit MIDI numbers start at the kick (see audio/drums): kick, tom, snare, clap, hat, open hat. */
const KICK_MIDI = 36;
/** How much each kit piece stirs the sea: low skins most, hats barely. */
const DRUM_WEIGHT = [1, 0.9, 0.6, 0.5, 0.2, 0.25];

export interface MoodNote {
  instrument: Instrument;
  midi: number;
  velocity: number;
  /** When the note sounds (audio seconds); only lightning timing needs it. */
  time?: number;
}

export interface MoodInput {
  scale: ScaleName;
  bpm: number;
  /** Notes heard in the last few seconds. */
  notes: readonly MoodNote[];
  windowS: number;
  /** Slow sun cycle 0…1 (0 and 1 are midnight, 0.5 golden hour) that the music drives; see `SkyDirector`. */
  day?: number;
}

const clamp = (v: number): number => Math.min(1, Math.max(0, v));

export function weatherName(w: Weather): string {
  let name: string | null = null;
  if (w.lightning > 0.3 || (w.waves > 0.6 && w.wind > 0.6 && w.rain > 0.4)) name = 'storm';
  else if (w.snow > 0.4 && w.wind > 0.6) name = 'blizzard';
  else if (w.wind > 0.72) name = 'gale';
  else {
    const ranked: [string, number][] = [
      ['aurora', w.aurora],
      ['rain', w.rain],
      ['snow', w.snow],
      ['mist', w.mist * 0.8],
    ];
    ranked.sort((a, b) => b[1] - a[1]);
    const [top, v] = ranked[0]!;
    if (v >= 0.25) name = top;
  }
  const light = w.dusk > 0.45 ? (w.warmth >= 0.5 ? 'sunset' : 'dawn') : null;
  if (!name) return light ?? 'clear night';
  return light ? `${name} at ${light}` : name;
}

/**
 * Mood → weather.
 *
 * - valence (scale major/minor, nudged by register) → warmth: golden vs cold moonlight;
 *   bright calm music also pulls the sun down to the horizon (golden hour, fireflies).
 * - arousal (notes per second, tempo, velocity) → wind and waves.
 * - drum energy (kick and toms weigh most) and low bass → swell on the lake, charge for lightning.
 * - dark + aroused → storm: high waves, gale, driving rain, clouds, lightning.
 * - precipitation turns to snow when the music is cold (bells, high register); slow bells snow
 *   gently, fast cold music makes a blizzard. Slow pads → mist; bright lively → aurora.
 * - `day` (the slow drift kept by `SkyDirector`) carries the sky through dawn, sunset and night
 *   over a long piece. Silence is a calm, slightly misty night.
 */
export function moodWeather(m: MoodInput): Weather {
  if (m.notes.length === 0) return { ...CALM_NIGHT };
  const n = m.notes.length;
  let midiSum = 0;
  let velSum = 0;
  let drumSum = 0;
  let bells = 0;
  let pads = 0;
  for (const x of m.notes) {
    velSum += x.velocity;
    if (x.instrument === 'drums') {
      drumSum += (DRUM_WEIGHT[x.midi - KICK_MIDI] ?? 0.4) * x.velocity;
      midiSum += 60;
      continue;
    }
    midiSum += x.midi;
    if (x.midi < 48) drumSum += 0.5 * x.velocity;
    if (x.instrument === 'bell') bells++;
    else if (x.instrument === 'pad') pads++;
  }
  const density = n / Math.max(1, m.windowS);
  const meanMidi = midiSum / n;
  const loud = clamp((velSum / n - 0.6) / 0.4);
  const tempo = clamp((m.bpm - 60) / 80);
  const drums = clamp(drumSum / Math.max(1, m.windowS) / 3);
  const valence = Math.max(-1, Math.min(1, VALENCE[m.scale] + (meanMidi - 60) / 48));
  const arousal = clamp(0.45 * clamp(density / 5) + 0.3 * tempo + 0.25 * loud);
  const bellShare = bells / n;
  const padShare = pads / n;

  const bright = clamp(valence);
  const dark = clamp(-valence);
  const storm = clamp(dark * (arousal + 0.5 * drums) * 2 - 0.3);
  const cold = clamp(bellShare * 0.8 + clamp((meanMidi - 66) / 18) * 0.4);
  const precip = clamp(dark * (0.45 + 0.7 * arousal) + 0.3 * storm);
  const gentleSnow = clamp((bellShare * 1.2 + 0.2) * (1 - arousal) * (0.4 + 0.6 * clamp(valence + 0.5)) - 0.1);
  const day = m.day ?? 0;
  const cycle = 0.5 - 0.5 * Math.cos(day * Math.PI * 2);
  const dusk = clamp(0.85 * bright * (1 - arousal) + cycle * (0.35 + 0.4 * clamp(valence + 0.5)) - 0.6 * storm);
  const wind = clamp(0.08 + 0.35 * arousal + 0.6 * storm + 0.25 * cold * arousal);
  return {
    aurora: clamp(bright * (0.25 + arousal * 1.1) * (1 - 0.7 * dusk)),
    rain: clamp(precip * (1 - cold)),
    snow: clamp(gentleSnow + precip * cold),
    mist: clamp((0.2 + (1 - arousal) * 0.45 * (padShare + 0.4)) * (1 - 0.4 * dark) - 0.3 * storm),
    clouds: clamp(0.1 + dark * 0.6 + storm * 0.4 + precip * 0.2 + (1 - bright) * 0.1),
    wind,
    fireflies: clamp(bright * (1 - arousal) * 1.3 * (1 - precip) - gentleSnow * 0.8),
    warmth: clamp(0.5 + valence * 0.5),
    dusk,
    waves: clamp(storm * 0.9 + drums * 0.35 + arousal * 0.2 + wind * 0.15 - 0.12),
    lightning: clamp((storm - 0.4) * 1.7) * (0.5 + 0.5 * clamp(drums * 1.5 + loud * 0.5)),
  };
}

/** Deterministic PRNG, so the same performance gives the same flashes. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * The part of the weather with memory. The sun drifts through a slow day cycle that only
 * moves while music plays (livelier music turns it faster), so a long piece passes through
 * dawn, golden hour and night; lightning answers heavy low hits when the storm is charged.
 */
export class SkyDirector {
  /** 0 and 1 midnight, 0.5 golden hour. */
  day = 0;
  private lastHeard = -Infinity;
  private lastStrike = -Infinity;
  private nextAmbient = 12;
  private rand = rng(1234);

  /** Target weather for the notes heard in the last `windowS`; `dt` is the time since the last call. */
  weather(m: MoodInput, dt: number): Weather {
    if (m.notes.length > 0) {
      const density = clamp(m.notes.length / Math.max(1, m.windowS) / 5);
      // A full day in roughly four minutes of calm music, under two when it is busy.
      this.day = (this.day + Math.min(dt, 2) * (0.004 + 0.006 * density)) % 1;
    }
    return moodWeather({ ...m, day: this.day });
  }

  /**
   * Lightning strength (0 none) for notes that sounded since the last call. Loud kicks, toms
   * and low bass may strike when `charge` (the eased `lightning` weather) is up; a charged
   * storm also flashes now and then on its own. Flashes are kept seconds apart.
   * @param notes recent notes with times, or null when nothing plays
   * @param heard current audio time (seconds), the clock of `notes`
   * @param wall wall-clock seconds, for spacing flashes
   */
  strike(notes: readonly MoodNote[] | null, heard: number, wall: number, charge: number): number {
    const from = this.lastHeard > heard ? -Infinity : this.lastHeard;
    this.lastHeard = heard;
    if (charge < 0.3) return 0;
    const gap = wall - this.lastStrike;
    if (gap < 4 + 8 * (1 - charge)) return 0;
    let hit = 0;
    if (notes) {
      for (const n of notes) {
        if (n.time === undefined || n.time <= from || n.time > heard) continue;
        const low = n.instrument === 'drums' ? n.midi <= KICK_MIDI + 1 && n.velocity >= 0.6 : n.midi < 48 && n.velocity >= 0.7;
        if (low) hit = Math.max(hit, n.velocity);
      }
    }
    if (hit > 0 && this.rand() < 0.25 + 0.35 * charge) return this.fire(wall, 0.5 + 0.5 * hit * charge);
    if (charge > 0.55 && gap > this.nextAmbient) return this.fire(wall, 0.35 + 0.4 * this.rand() * charge);
    return 0;
  }

  private fire(wall: number, strength: number): number {
    this.lastStrike = wall;
    this.nextAmbient = 10 + this.rand() * 14;
    return Math.min(1, strength);
  }
}
