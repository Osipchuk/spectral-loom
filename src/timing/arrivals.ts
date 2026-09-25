import { lightToDegree, degreeToMidi } from '../music/pitch';
import type { RayTree } from '../optics/types';
import type { Instrument, Receptor, SceneModel } from '../scene/types';
import { pulsesInRange, type PulseSource } from './sources';

/** Width that counts as "normal" beam width for velocity; narrower (focused) is louder. */
const REF_WIDTH = 0.16;
/** Grid used for onset quantization: one 1/16 note. */
export const QUANT_GRID_BEATS = 0.25;
export const AUDIO_THRESHOLD = 0.08;

/**
 * A note that will sound every time its source launches a pulse: `offsetBeats` after
 * the launch (light travel time, after quantization) at a fixed pitch and velocity.
 */
export interface NoteTemplate {
  receptorId: string;
  sourceId: string;
  degree: number;
  midi: number;
  velocity: number;
  offsetBeats: number;
  /** Raw travel time before quantization (what the light itself does). */
  travelBeats: number;
  echo: number;
  instrument: Instrument;
  voices: number;
}

export interface NoteEvent {
  beat: number;
  midi: number;
  velocity: number;
  lenBeats: number;
  instrument: Instrument;
  receptorId: string;
  sourceId: string;
  /** Launch beat of the pulse that produced this note. */
  launchBeat: number;
}

/** Quantize the first onset of a group to the grid, moving the whole group rigidly. */
export function quantizeShift(firstBeat: number, strength: number, grid = QUANT_GRID_BEATS): number {
  const target = Math.round(firstBeat / grid) * grid;
  return (target - firstBeat) * Math.min(1, Math.max(0, strength));
}

/** Arrival delay, in beats, for light travelling `distance` grid units at speed c (units/beat). */
export function travelBeats(distance: number, c: number): number {
  return distance / Math.max(1e-6, c);
}

/**
 * Turn the ray tree into note templates. Rays reaching a receptor are grouped by the pulse
 * source that drives them and by echo order (mirror bounces); within a group each ray maps
 * to a scale degree, power is summed per degree, and the group's first onset is quantized.
 */
export function planNotes(scene: SceneModel, tree: RayTree): NoteTemplate[] {
  const receptors = new Map<string, Receptor>();
  for (const el of scene.elements) if (el.kind === 'receptor' && el.enabled) receptors.set(el.id, el);
  const { c, quantize, scale, root } = scene.settings;

  type Acc = { power: number; rays: number; first: number; focus: number };
  const groups = new Map<string, { receptor: Receptor; sourceId: string; echo: number; degrees: Map<number, Acc> }>();

  for (const hit of tree.receptorHits) {
    const r = receptors.get(hit.receptorId);
    if (!r || hit.intensity < AUDIO_THRESHOLD) continue;
    const key = `${r.id}|${hit.pulseSourceId}|${hit.bounces}`;
    let g = groups.get(key);
    if (!g) {
      g = { receptor: r, sourceId: hit.pulseSourceId, echo: hit.bounces, degrees: new Map() };
      groups.set(key, g);
    }
    const deg = lightToDegree(hit.light, { scale, span: r.span });
    const t = travelBeats(hit.s - hit.pulseOriginS, c);
    const focus = Math.min(1.6, Math.max(0.6, Math.sqrt(REF_WIDTH / Math.max(hit.width, 0.03))));
    const a = g.degrees.get(deg) ?? { power: 0, rays: 0, first: Infinity, focus: 0 };
    a.power += hit.intensity;
    a.rays += 1;
    a.first = Math.min(a.first, t);
    a.focus = Math.max(a.focus, focus);
    g.degrees.set(deg, a);
  }

  const out: NoteTemplate[] = [];
  for (const g of groups.values()) {
    const r = g.receptor;
    const entries = [...g.degrees.entries()];
    if (entries.length === 0) continue;
    const first = Math.min(...entries.map(([, a]) => a.first));
    const shift = quantizeShift(first, quantize);
    for (const [deg, a] of entries) {
      // Average power per ray, so a degree sampled by two rays is not twice as loud.
      const p = (a.power / a.rays) * a.focus;
      const velocity = Math.min(1, (0.25 + 0.7 * Math.min(1, p)) * r.gain);
      out.push({
        receptorId: r.id,
        sourceId: g.sourceId,
        degree: deg,
        midi: degreeToMidi(deg, { scale, root, octave: r.octave, span: r.span }),
        velocity,
        offsetBeats: a.first + shift,
        travelBeats: a.first,
        echo: g.echo,
        instrument: r.instrument,
        voices: r.voices,
      });
    }
  }
  return out;
}

/**
 * All notes whose onset falls in [fromBeat, toBeat). A note belongs to the pulse launched
 * `offsetBeats` earlier, so we look up launches in the shifted window. Pulses carrying a
 * degree set (loom cards) only sound matching templates. Polyphony is capped per receptor
 * and pulse, strongest first.
 */
export function notesInWindow(
  templates: NoteTemplate[],
  sources: Map<string, PulseSource>,
  fromBeat: number,
  toBeat: number,
): NoteEvent[] {
  const bySourceReceptor = new Map<string, NoteTemplate[]>();
  for (const t of templates) {
    const key = `${t.sourceId}|${t.receptorId}|${t.echo}`;
    const list = bySourceReceptor.get(key) ?? [];
    list.push(t);
    bySourceReceptor.set(key, list);
  }

  const out: NoteEvent[] = [];
  for (const list of bySourceReceptor.values()) {
    const src = sources.get(list[0]!.sourceId);
    if (!src) continue;
    const minOff = Math.min(...list.map((t) => t.offsetBeats));
    const maxOff = Math.max(...list.map((t) => t.offsetBeats));
    for (const pulse of pulsesInRange(src, fromBeat - maxOff - 1e-9, toBeat - minOff)) {
      const chosen = list
        .filter((t) => !pulse.degrees || pulse.degrees.includes(t.degree))
        .sort((a, b) => b.velocity - a.velocity)
        .slice(0, list[0]!.voices);
      for (const t of chosen) {
        const beat = pulse.beat + t.offsetBeats;
        if (beat < fromBeat || beat >= toBeat) continue;
        out.push({
          beat,
          midi: t.midi,
          velocity: t.velocity,
          lenBeats: pulse.lenBeats,
          instrument: t.instrument,
          receptorId: t.receptorId,
          sourceId: t.sourceId,
          launchBeat: pulse.beat,
        });
      }
    }
  }
  return out.sort((a, b) => a.beat - b.beat);
}
