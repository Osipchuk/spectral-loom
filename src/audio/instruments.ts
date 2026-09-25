import type { Instrument } from '../scene/types';

/**
 * ADSR per instrument: the single source of truth for both the audio envelope and the
 * visual swell of the light carrying the note. Times in seconds.
 */
export interface EnvelopeSpec {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

export const ENVELOPES: Record<Instrument, EnvelopeSpec> = {
  pad: { attack: 0.35, decay: 0.6, sustain: 0.7, release: 1.8 },
  pluck: { attack: 0.004, decay: 0.45, sustain: 0.0, release: 0.5 },
  bell: { attack: 0.003, decay: 1.6, sustain: 0.0, release: 1.4 },
};

/** How long (seconds) a note is held before release, given its pulse length. */
export function holdSeconds(instrument: Instrument, pulseSeconds: number): number {
  if (instrument === 'pad') return Math.max(0.25, pulseSeconds * 0.95);
  return 0.08;
}

/** Visual attack is never shorter than 40 ms, even for plucks. */
export const MIN_VISUAL_ATTACK = 0.04;

/**
 * Envelope level at `dt` seconds after note-on for a note held `hold` seconds. Exponential
 * decay and release, attack stretched to at least 40 ms. Used for light, so it mirrors the
 * audio envelope shape without being sample-accurate.
 */
export function envelopeAt(e: EnvelopeSpec, hold: number, dt: number): number {
  if (dt < 0) return 0;
  const a = Math.max(e.attack, MIN_VISUAL_ATTACK);
  const sustained = (t: number): number => {
    if (t < a) return t / a;
    return e.sustain + (1 - e.sustain) * Math.exp(-(t - a) / Math.max(0.02, e.decay / 3));
  };
  const releaseAt = Math.max(hold, a);
  if (dt < releaseAt) return sustained(dt);
  return sustained(releaseAt) * Math.exp(-(dt - releaseAt) / Math.max(0.02, e.release / 4));
}
