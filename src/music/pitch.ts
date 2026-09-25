import { frequencyTHz, VISIBLE_MAX_NM, VISIBLE_MIN_NM, type RayLight } from '../optics/spectrum';
import type { ScaleName } from '../scene/types';
import { SCALES } from './scales';

const F_LO = frequencyTHz(VISIBLE_MAX_NM);
const F_HI = frequencyTHz(VISIBLE_MIN_NM);

/**
 * Position of a wavelength within the visible range in pitch space, 0 (deep red) … 1
 * (violet). Light frequency is transposed down by octaves into hearing; only its position
 * within the visible span matters, which is then stretched over the receptor's span.
 */
export function spectralPosition(nm: number): number {
  const p = Math.log2(frequencyTHz(nm) / F_LO) / Math.log2(F_HI / F_LO);
  return Math.min(1 - 1e-9, Math.max(0, p));
}

export interface PitchContext {
  scale: ScaleName;
  /** Root pitch class, 0 = C. */
  root: number;
  octave: number;
  span: number;
}

export function degreeCount(ctx: Pick<PitchContext, 'scale' | 'span'>): number {
  return SCALES[ctx.scale].length * Math.max(1, Math.round(ctx.span));
}

/** Scale-degree index (0 … degreeCount − 1) for a wavelength. */
export function wavelengthToDegree(nm: number, ctx: Pick<PitchContext, 'scale' | 'span'>): number {
  return Math.floor(spectralPosition(nm) * degreeCount(ctx));
}

export function lightToDegree(light: RayLight, ctx: Pick<PitchContext, 'scale' | 'span'>): number {
  // Undispersed light plays the centre of its band.
  const nm = light.kind === 'mono' ? light.nm : (light.minNm + light.maxNm) / 2;
  return wavelengthToDegree(nm, ctx);
}

/** MIDI note for a scale-degree index; negative or large indices wrap into octaves. */
export function degreeToMidi(deg: number, ctx: PitchContext): number {
  const scale = SCALES[ctx.scale];
  const n = scale.length;
  const oct = Math.floor(deg / n);
  const step = ((deg % n) + n) % n;
  return 12 * (ctx.octave + 1) + ctx.root + 12 * oct + scale[step]!;
}

export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}
