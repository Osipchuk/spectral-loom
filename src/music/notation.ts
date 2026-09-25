import type { LoomNote, ScaleName } from '../scene/types';
import { SCALES } from './scales';

const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "F#4" → MIDI. */
export function noteNameToMidi(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name.trim());
  if (!m) throw new Error(`Bad note name: ${name}`);
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + LETTER[m[1]!]! + acc;
}

/** MIDI → scale-degree index relative to (root, octave). Throws for out-of-scale notes. */
export function midiToDegree(midi: number, scale: ScaleName, root: number, octave: number): number {
  const steps = SCALES[scale];
  const rel = midi - (12 * (octave + 1) + root);
  const oct = Math.floor(rel / 12);
  const pc = ((rel % 12) + 12) % 12;
  const i = steps.indexOf(pc);
  if (i < 0) throw new Error(`MIDI ${midi} is not in the scale`);
  return oct * steps.length + i;
}

/**
 * Tiny score notation, one voice per string. Tokens are separated by spaces:
 *   `E4`      a note one step long
 *   `E4:3`    a note three steps long
 *   `[C3 E3 G3]:8` a chord
 *   `-:2`     a rest
 *   `|`       bar line (ignored, for readability)
 */
export function parseVoice(src: string, scale: ScaleName, root: number, octave: number, startAt = 0): { notes: LoomNote[]; length: number } {
  const notes: LoomNote[] = [];
  let t = startAt;
  const tokens = src.replace(/\|/g, ' ').match(/\[[^\]]*\](?::\d+)?|\S+/g) ?? [];
  for (const tok of tokens) {
    if (tok === '|') continue;
    const [body, lenStr] = tok.startsWith('[') ? [tok.slice(1, tok.indexOf(']')), tok.split(']:')[1]] : tok.split(':');
    const len = lenStr ? Number(lenStr) : 1;
    if (body !== '-') {
      for (const name of body!.split(/\s+/).filter(Boolean)) {
        notes.push({ at: t, len, deg: midiToDegree(noteNameToMidi(name), scale, root, octave) });
      }
    }
    t += len;
  }
  return { notes, length: t - startAt };
}
