import type { Instrument, ScaleName } from '../scene/types';

/** How the sky should look, each 0…1. */
export interface Weather {
  aurora: number;
  rain: number;
  snow: number;
  mist: number;
  clouds: number;
}

export const CALM_NIGHT: Weather = { aurora: 0.08, rain: 0, snow: 0, mist: 0.35, clouds: 0.15 };

const VALENCE: Record<ScaleName, number> = { majorPent: 0.7, major: 0.6, dorian: -0.1, minorPent: -0.55, minor: -0.7 };

export interface MoodInput {
  scale: ScaleName;
  bpm: number;
  /** Notes heard in the last few seconds. */
  notes: { instrument: Instrument; midi: number; velocity: number }[];
  windowS: number;
}

export function weatherName(w: Weather): string {
  const ranked: [string, number][] = [
    ['aurora', w.aurora],
    ['rain', w.rain],
    ['snow', w.snow],
    ['mist', w.mist * 0.8],
  ];
  ranked.sort((a, b) => b[1] - a[1]);
  const [name, v] = ranked[0]!;
  return v < 0.25 ? 'clear night' : name;
}

/**
 * Mood → weather. Valence comes from the scale (major bright, minor dark) nudged by
 * register; arousal from how many notes sound per second and how fast the tempo is.
 * Lively and bright → aurora; dark → rain (harder when lively); slow and bell-like →
 * snow; slow and soft → mist. Silence is a calm, slightly misty night.
 */
export function moodWeather(m: MoodInput): Weather {
  if (m.notes.length === 0) return { ...CALM_NIGHT };
  const clamp = (v: number): number => Math.min(1, Math.max(0, v));
  const n = m.notes.length;
  const density = n / Math.max(1, m.windowS);
  const meanMidi = m.notes.reduce((a, x) => a + x.midi, 0) / n;
  const valence = Math.max(-1, Math.min(1, VALENCE[m.scale] + (meanMidi - 60) / 48));
  const arousal = clamp(0.55 * clamp(density / 5) + 0.45 * clamp((m.bpm - 60) / 80));
  const share = (inst: Instrument): number => m.notes.filter((x) => x.instrument === inst).length / n;

  const bright = clamp(valence);
  const dark = clamp(-valence);
  return {
    aurora: clamp(bright * (0.25 + arousal * 1.1)),
    rain: clamp(dark * (0.6 + arousal * 0.8)),
    snow: clamp((share('bell') * 1.2 + 0.2) * (1 - arousal) * (0.4 + 0.6 * clamp(valence + 0.5)) - 0.1),
    mist: clamp((0.2 + (1 - arousal) * 0.45 * (share('pad') + 0.4)) * (1 - 0.4 * dark)),
    clouds: clamp(0.1 + dark * 0.8 + (1 - bright) * 0.15),
  };
}
