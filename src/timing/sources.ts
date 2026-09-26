import type { SceneModel, Subdivision } from '../scene/types';
import { chordDegrees, progression } from '../music/chords';
import { bjorklund } from './bjorklund';

export const SUBDIVISION_BEATS: Record<Subdivision, number> = { '1/4': 1, '1/8': 0.5, '1/16': 0.25 };

/**
 * One swell launched by a pulse source. `degrees: null` means it carries every pitch;
 * `slots` (engine-2 cards) opens only those slots of the card, whatever colour crosses them.
 */
export interface Pulse {
  sourceId: string;
  beat: number;
  lenBeats: number;
  degrees: number[] | null;
  slots?: number[];
  depth: number;
}

/** A periodic generator of pulses: one loop of events, repeated forever. */
export interface PulseSource {
  id: string;
  loopBeats: number;
  events: Omit<Pulse, 'sourceId'>[];
}

/** All pulse sources in a scene, keyed by element id. Emitters, modulators and looms. */
export function pulseSources(scene: SceneModel): Map<string, PulseSource> {
  const out = new Map<string, PulseSource>();
  const bar = scene.settings.beatsPerBar;
  for (const el of scene.elements) {
    if (!el.enabled) continue;
    if (el.kind === 'emitter') {
      if (el.pulse === 'drone') {
        out.set(el.id, { id: el.id, loopBeats: bar, events: [{ beat: 0, lenBeats: bar, degrees: null, depth: 0.35 }] });
      } else {
        const step = SUBDIVISION_BEATS[el.pulse];
        out.set(el.id, { id: el.id, loopBeats: step, events: [{ beat: 0, lenBeats: step, degrees: null, depth: 0.5 }] });
      }
    } else if (el.kind === 'modulator') {
      const step = SUBDIVISION_BEATS[el.subdivision];
      const pattern = bjorklund(el.steps, el.hits, el.rotate);
      const events = pattern.flatMap((hit, i) => (hit ? [{ beat: i * step, lenBeats: step, degrees: null, depth: el.depth }] : []));
      out.set(el.id, { id: el.id, loopBeats: Math.max(step, el.steps * step), events });
    } else if (el.kind === 'chord') {
      const roots = progression(el.progression);
      const bpc = Math.max(0.25, Number(el.beatsPerChord));
      const events: PulseSource['events'] = [];
      roots.forEach((root, i) => {
        const degrees = chordDegrees(root, scene.settings.scale);
        if (el.rhythm === 'hold') {
          events.push({ beat: i * bpc, lenBeats: bpc, degrees, depth: 0.85 });
        } else {
          const step = SUBDIVISION_BEATS[el.rhythm];
          for (let b = 0; b < bpc - 1e-9; b += step) events.push({ beat: i * bpc + b, lenBeats: step, degrees, depth: 0.8 });
        }
      });
      out.set(el.id, { id: el.id, loopBeats: roots.length * bpc, events });
    } else if (el.kind === 'loom') {
      const step = SUBDIVISION_BEATS[el.subdivision];
      // Notes starting together become one pulse carrying a chord.
      const byStart = new Map<number, { len: number; degs: number[] }>();
      for (const n of el.notes) {
        const g = byStart.get(n.at) ?? { len: 0, degs: [] };
        g.len = Math.max(g.len, n.len);
        g.degs.push(n.deg);
        byStart.set(n.at, g);
      }
      // Engine 2: card rows are slots, not pitches.
      const slotted = scene.settings.engine === 2;
      const events = [...byStart.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([at, g]) =>
          slotted
            ? { beat: at * step, lenBeats: g.len * step, degrees: null, slots: g.degs, depth: el.depth }
            : { beat: at * step, lenBeats: g.len * step, degrees: g.degs, depth: el.depth },
        );
      out.set(el.id, { id: el.id, loopBeats: Math.max(step, el.steps * step), events });
    }
  }
  return out;
}

/** Pulses of one source whose launch beat lies in [from, to). */
export function pulsesInRange(src: PulseSource, from: number, to: number): Pulse[] {
  const out: Pulse[] = [];
  if (to <= from || src.events.length === 0) return out;
  const firstLoop = Math.floor(from / src.loopBeats);
  const lastLoop = Math.floor(to / src.loopBeats);
  for (let loop = firstLoop; loop <= lastLoop; loop++) {
    const base = loop * src.loopBeats;
    for (const e of src.events) {
      const beat = base + e.beat;
      if (beat >= from && beat < to) out.push({ ...e, beat, sourceId: src.id });
    }
  }
  return out;
}
