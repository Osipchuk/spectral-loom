import type { ScaleName } from '../scene/types';
import { NOTE_NAMES, SCALES } from './scales';

/** Progressions as scale-degree roots (0 = I, 3 = IV, 4 = V, 5 = vi …). */
export const PROGRESSIONS: { id: string; label: string; roots: number[] }[] = [
  { id: 'pop', label: 'I – V – vi – IV', roots: [0, 4, 5, 3] },
  { id: 'canon', label: 'Canon: I – V – vi – iii – IV – I – IV – V', roots: [0, 4, 5, 2, 3, 0, 3, 4] },
  { id: 'doowop', label: 'I – vi – IV – V', roots: [0, 5, 3, 4] },
  { id: 'minor', label: 'vi – IV – I – V', roots: [5, 3, 0, 4] },
  { id: 'blues', label: 'I – IV – I – V', roots: [0, 3, 0, 4] },
  { id: 'drift', label: 'I – IV (drift)', roots: [0, 3] },
  { id: 'I', label: 'Hold I', roots: [0] },
  { id: 'IV', label: 'Hold IV', roots: [3] },
  { id: 'V', label: 'Hold V', roots: [4] },
  { id: 'vi', label: 'Hold vi', roots: [5] },
];

export function progression(id: string): number[] {
  return (PROGRESSIONS.find((p) => p.id === id) ?? PROGRESSIONS[0]!).roots;
}

/**
 * Chord tones (root, third, fifth — stacked scale thirds) as scale-degree indices from 0 to
 * `maxDeg`, in every octave. Works for any scale: in a pentatonic it stacks every other note.
 */
export function chordDegrees(root: number, scale: ScaleName, maxDeg = 21): number[] {
  const n = SCALES[scale].length;
  const r = ((root % n) + n) % n;
  const tones = new Set([r, (r + 2) % n, (r + 4) % n]);
  const out: number[] = [];
  for (let d = 0; d <= maxDeg; d++) if (tones.has(d % n)) out.push(d);
  return out;
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/** "Am", "F", "G" … plus the roman numeral, for the label over the glass. */
export function chordName(root: number, scale: ScaleName, key: number): { name: string; roman: string } {
  const steps = SCALES[scale];
  const n = steps.length;
  const r = ((root % n) + n) % n;
  const semis = (i: number): number => steps[i % n]! + 12 * Math.floor(i / n);
  const third = semis(r + 2) - semis(r);
  const fifth = semis(r + 4) - semis(r);
  const quality = third === 3 ? (fifth === 6 ? 'dim' : 'm') : '';
  const pc = (key + steps[r]!) % 12;
  const roman = (ROMAN[r] ?? String(r + 1)).toString();
  return { name: `${NOTE_NAMES[pc]}${quality}`, roman: quality === '' ? roman : roman.toLowerCase() + (quality === 'dim' ? '°' : '') };
}
