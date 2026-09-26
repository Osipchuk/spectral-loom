import { degreeToMidi, lightToDegree, receptorPitch } from '../music/pitch';
import { loomSlots } from '../optics/slots';
import type { RayTree, ReceptorHit } from '../optics/types';
import type { Instrument, Loom, Receptor, SceneModel } from '../scene/types';
import { pulsesInRange, type Pulse, type PulseSource } from './sources';

/** Width that counts as "normal" beam width for velocity; narrower (focused) is louder. */
const REF_WIDTH = 0.26;
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
  /** 0 (diffuse light) … 1 (tightly focused): opens the receptor's filter. */
  brightness: number;
  /** Stereo position from the receptor's place on the table, −1 … 1. */
  pan: number;
  /** Engine 2: the card slot this note's light came through (see Pulse.slots). */
  slot: number | null;
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
  brightness: number;
  pan: number;
}

/**
 * Irradiance where light lands (power per width), relative to a plain beam, mapped to
 * 0…1 on a log scale: a spread rainbow ≈ 0, a plain beam ≈ 0.6, a lens focus → 1.
 */
export function irradianceBrightness(power: number, extent: number): number {
  const rel = (power * REF_WIDTH) / Math.max(extent, 0.03);
  return Math.min(1, Math.max(0, (Math.log2(Math.max(rel, 1e-6)) + 4) / 6.3));
}

/**
 * Engine 2: irradiance of one note's own light where it lands (its power over the width it
 * covers, relative to a plain beam), 0…1 on a log scale: a slice of a spread rainbow ≈ 0.15,
 * a plain beam ≈ 0.7, rainbow light a lens gathers to a point ≈ 0.55, a focused beam → 1.
 * Independent of how many rays happen to sample the note: more rays, more power, more width.
 */
export function noteBrightness(power: number, extent: number): number {
  const rel = (power * REF_WIDTH) / Math.max(extent, 0.03);
  return Math.min(1, Math.max(0, (Math.log2(Math.max(rel, 1e-6)) + 6) / 8.5));
}

/**
 * Engine 2: a continuous pull towards the grid. Onsets near a grid line land on it (the
 * pull is flat there), onsets halfway between stay put, and nothing in between ever jumps:
 * moving an element moves its notes smoothly. Strength 1 is the strongest pull that keeps
 * the order of onsets (x + shift(x) never decreases).
 */
export function softQuantizeShift(first: number, strength: number, grid = QUANT_GRID_BEATS): number {
  const k = Math.min(1, Math.max(0, strength));
  return (-k * grid * Math.sin((2 * Math.PI * first) / grid)) / (2 * Math.PI);
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
  return scene.settings.engine === 2 ? planNotesV2(scene, tree) : planNotesV1(scene, tree);
}

function receptorPan(scene: SceneModel, r: Receptor): number {
  return Math.max(-0.6, Math.min(0.6, ((r.pos.x / scene.table.w) * 2 - 1) * 0.8));
}

function planNotesV1(scene: SceneModel, tree: RayTree): NoteTemplate[] {
  const receptors = new Map<string, Receptor>();
  for (const el of scene.elements) if (el.kind === 'receptor' && el.enabled) receptors.set(el.id, el);
  const { c, quantize } = scene.settings;

  type Acc = { power: number; rays: number; first: number };
  type Group = {
    receptor: Receptor;
    sourceId: string;
    echo: number;
    degrees: Map<number, Acc>;
    /** Where the light lands along the aperture (grid units), for irradiance. */
    uMin: number;
    uMax: number;
    widthSum: number;
    powerSum: number;
    hits: number;
  };
  const groups = new Map<string, Group>();

  for (const hit of tree.receptorHits) {
    const r = receptors.get(hit.receptorId);
    if (!r || hit.intensity < AUDIO_THRESHOLD) continue;
    const key = `${r.id}|${hit.pulseSourceId}|${hit.bounces}`;
    let g = groups.get(key);
    if (!g) {
      g = { receptor: r, sourceId: hit.pulseSourceId, echo: hit.bounces, degrees: new Map(), uMin: Infinity, uMax: -Infinity, widthSum: 0, powerSum: 0, hits: 0 };
      groups.set(key, g);
    }
    const pc = receptorPitch(scene.settings, r);
    const deg = lightToDegree(hit.light, pc);
    const t = travelBeats(hit.s - hit.pulseOriginS, c);
    const a = g.degrees.get(deg) ?? { power: 0, rays: 0, first: Infinity };
    a.power += hit.intensity;
    a.rays += 1;
    a.first = Math.min(a.first, t);
    g.degrees.set(deg, a);
    const u = hit.u * r.aperture;
    g.uMin = Math.min(g.uMin, u);
    g.uMax = Math.max(g.uMax, u);
    g.widthSum += Math.max(hit.width, 0.05);
    g.powerSum += hit.intensity;
    g.hits += 1;
  }

  const out: NoteTemplate[] = [];
  for (const g of groups.values()) {
    const r = g.receptor;
    const entries = [...g.degrees.entries()];
    if (entries.length === 0) continue;
    const first = Math.min(...entries.map(([, a]) => a.first));
    const shift = quantizeShift(first, quantize);
    const brightness = irradianceBrightness(g.powerSum / g.hits, g.uMax - g.uMin + g.widthSum / g.hits);
    const pan = receptorPan(scene, r);
    for (const [deg, a] of entries) {
      // Average power per ray, so a degree sampled by two rays is not twice as loud.
      const p = a.power / a.rays;
      // Focused light is louder; faint light (Fresnel reflections, filtered edges) quieter.
      const velocity = Math.min(1, (0.28 + 0.5 * Math.min(1, p)) * (0.8 + 0.35 * brightness) * r.gain);
      out.push({
        receptorId: r.id,
        sourceId: g.sourceId,
        degree: deg,
        midi: degreeToMidi(deg, receptorPitch(scene.settings, r)),
        velocity,
        offsetBeats: a.first + shift,
        travelBeats: a.first,
        echo: g.echo,
        instrument: r.instrument,
        voices: r.voices,
        brightness,
        pan,
        slot: null,
      });
    }
  }
  return out;
}

/**
 * Engine-2 cards: how much of each ray goes through each slot. A dispersed fan is sampled
 * by a few dozen rays; each ray stands for the strip of the card up to halfway to its
 * neighbours in the fan, and a slot passes the part of that strip it overlaps. As glass
 * moves, a colour slides from one slot into the next gradually: its note fades out of one
 * row and into the other instead of jumping.
 */
export function slotCoverage(scene: SceneModel, hits: readonly ReceptorHit[]): Map<ReceptorHit, { slot: number; w: number }[]> {
  const out = new Map<ReceptorHit, { slot: number; w: number }[]>();
  const fans = new Map<string, ReceptorHit[]>();
  for (const h of hits) {
    if (h.slot === null || h.cardU === null) continue;
    const key = `${h.pulseSourceId}|${h.receptorId}|${h.bounces}|${h.fanId < 0 ? `s${h.segmentId}` : h.fanId}`;
    fans.set(key, [...(fans.get(key) ?? []), h]);
  }
  for (const fan of fans.values()) {
    const loom = scene.elements.find((e): e is Loom => e.id === fan[0]!.pulseSourceId && e.kind === 'loom');
    if (!loom) continue;
    const slots = loomSlots(loom);
    fan.sort((x, y) => x.cardU! - y.cardU!);
    const u = fan.map((h) => h.cardU!);
    const gaps = u.slice(1).map((x, i) => x - u[i]!);
    // A lone ray covers its own beam width; missing neighbours (light that fell outside
    // the receptor) do not stretch a strip beyond one and a half typical gaps.
    const typical = gaps.length > 0 ? [...gaps].sort((x, y) => x - y)[Math.floor(gaps.length / 2)]! : fan[0]!.width / loom.length;
    const half = (g: number | undefined): number => Math.min(g ?? typical, 1.5 * typical) / 2;
    fan.forEach((h, i) => {
      const lo = u[i]! - half(gaps[i - 1]);
      const hi = u[i]! + half(gaps[i]);
      const span = Math.max(1e-9, hi - lo);
      const cover: { slot: number; w: number }[] = [];
      slots.forEach((sl, k) => {
        const w = (Math.min(hi, sl.u1) - Math.max(lo, sl.u0)) / span;
        if (w > 1e-6) cover.push({ slot: k, w });
      });
      out.set(h, cover);
    });
  }
  return out;
}

/**
 * Engine 2. Same grouping as engine 1, but every (slot, pitch) pair is its own note with its
 * own loudness, tone and stereo position, all read from where its light lands: gathered
 * light is louder and brighter, and a receptor turned across the table spreads its notes
 * from left to right. Onsets are pulled to the grid softly (see softQuantizeShift), and a
 * note's timing and loudness follow the share of its colour a slot lets through, so moving
 * glass changes the music continuously.
 */
function planNotesV2(scene: SceneModel, tree: RayTree): NoteTemplate[] {
  const receptors = new Map<string, Receptor>();
  for (const el of scene.elements) if (el.kind === 'receptor' && el.enabled) receptors.set(el.id, el);
  const { c, quantize } = scene.settings;
  const heard = tree.receptorHits.filter((h) => receptors.has(h.receptorId) && h.intensity >= AUDIO_THRESHOLD);
  const coverage = slotCoverage(scene, heard);

  type Acc = { degree: number; slot: number | null; w: number; power: number; own: number; u: number; uu: number; width: number };
  type Group = {
    receptor: Receptor;
    sourceId: string;
    echo: number;
    first: number;
    notes: Map<string, Acc>;
    raysPerDegree: Map<number, number>;
    /** Earliest arrival of each colour, whichever slot it goes through. */
    degreeFirst: Map<number, number>;
  };
  const groups = new Map<string, Group>();

  for (const hit of heard) {
    const r = receptors.get(hit.receptorId)!;
    const key = `${r.id}|${hit.pulseSourceId}|${hit.bounces}`;
    let g = groups.get(key);
    if (!g) {
      g = { receptor: r, sourceId: hit.pulseSourceId, echo: hit.bounces, first: Infinity, notes: new Map(), raysPerDegree: new Map(), degreeFirst: new Map() };
      groups.set(key, g);
    }
    const degree = lightToDegree(hit.light, receptorPitch(scene.settings, r));
    const t = travelBeats(hit.s - hit.pulseOriginS, c);
    g.first = Math.min(g.first, t);
    g.raysPerDegree.set(degree, (g.raysPerDegree.get(degree) ?? 0) + 1);
    g.degreeFirst.set(degree, Math.min(g.degreeFirst.get(degree) ?? Infinity, t));
    const u = hit.u * r.aperture;
    for (const { slot, w } of coverage.get(hit) ?? [{ slot: hit.slot, w: 1 }]) {
      const nk = `${slot ?? ''}|${degree}`;
      let a = g.notes.get(nk);
      if (!a) {
        a = { degree, slot, w: 0, power: 0, own: 0, u: 0, uu: 0, width: 0 };
        g.notes.set(nk, a);
      }
      a.w += w;
      a.power += w * hit.intensity;
      a.own += (w * hit.intensity) / hit.fan;
      a.u += w * u;
      a.uu += w * u * u;
      a.width += w * Math.max(hit.width, 0.05);
    }
  }

  const out: NoteTemplate[] = [];
  for (const g of groups.values()) {
    const r = g.receptor;
    // The group's earliest light sets the grid pull, whichever slots are open.
    const shift = softQuantizeShift(g.first, quantize);
    const basePan = receptorPan(scene, r);
    const pc = receptorPitch(scene.settings, r);
    // A chord spreads across the stereo field, low to high over the range this receptor
    // hears (by pitch, so a rainbow's crowded red end is not squeezed into the middle). The
    // low side is where the slit's red end points on screen; an upright slit puts it left.
    const slit = { x: -Math.sin(r.rotation), y: Math.cos(r.rotation) };
    const lowEnd = lowerNotesEnd(g.notes.values());
    const lowSide = lowEnd === 0 ? 0 : Math.abs(slit.x) > 0.25 ? Math.sign(slit.x * lowEnd) : -1;
    const degs = [...g.notes.values()].map((a) => a.degree);
    const dLo = Math.min(...degs);
    const dSpan = Math.max(...degs) - dLo;
    for (const a of g.notes.values()) {
      // Share of this colour's light that comes through this slot, times its transmission.
      const p = Math.min(1, a.power / (g.raysPerDegree.get(a.degree) ?? 1));
      if (p < 0.03) continue;
      const mean = a.u / a.w;
      const spread = 2 * Math.sqrt(Math.max(0, a.uu / a.w - mean * mean));
      const brightness = noteBrightness(a.own, spread + a.width / a.w);
      // A colour only partly inside a slot fades out rather than cutting off.
      const fade = Math.min(1, p / 0.3);
      const velocity = Math.min(1, (0.18 + 0.38 * p + 0.5 * brightness) * r.gain * fade);
      const rank = dSpan > 0 ? (a.degree - dLo) / dSpan : 0.5;
      // A colour arrives when its earliest ray does, through whichever slot: the set of rays
      // of one colour never changes as glass moves, so neither does this jump.
      const travel = g.degreeFirst.get(a.degree)!;
      out.push({
        receptorId: r.id,
        sourceId: g.sourceId,
        degree: a.degree,
        midi: degreeToMidi(a.degree, pc),
        velocity,
        offsetBeats: travel + shift,
        travelBeats: travel,
        echo: g.echo,
        instrument: r.instrument,
        voices: r.voices,
        brightness,
        pan: Math.max(-0.85, Math.min(0.85, basePan * (lowSide === 0 ? 0.7 : 0.3) + STEREO_WIDTH * (1 - 2 * rank) * lowSide)),
        slot: a.slot,
      });
    }
  }
  return out;
}

/** Engine 2: how far a receptor's lowest and highest notes sit from the centre (−1…1 pan). */
const STEREO_WIDTH = 0.75;

/**
 * Which end of a receptor's slit (u sign) the lower notes land on: −1, +1, or 0 when that
 * cannot be told (one note).
 */
function lowerNotesEnd(notes: Iterable<{ degree: number; u: number; w: number }>): number {
  let num = 0;
  let n = 0;
  let du = 0;
  let dd = 0;
  const list = [...notes].filter((a) => a.w > 0);
  if (list.length < 2) return 0;
  const mu = list.reduce((s, a) => s + a.u / a.w, 0) / list.length;
  const md = list.reduce((s, a) => s + a.degree, 0) / list.length;
  for (const a of list) {
    num += (a.u / a.w - mu) * (a.degree - md);
    du += (a.u / a.w - mu) ** 2;
    dd += (a.degree - md) ** 2;
    n += 1;
  }
  if (n < 2 || du === 0 || dd === 0) return 0;
  // Pitch rises towards +u: the lower notes sit at the −u end.
  return num > 0 ? -1 : 1;
}

/** Whether a pulse sounds a note: engine-2 cards open slots, engine-1 cards and chord glass pick pitches. */
export function pulsePasses(p: Pick<Pulse, 'degrees' | 'slots'>, t: Pick<NoteTemplate, 'degree' | 'slot'>): boolean {
  if (p.slots) return t.slot !== null && p.slots.includes(t.slot);
  return !p.degrees || p.degrees.includes(t.degree);
}

/** Note templates that change with the launch time of a pulse (moving optics, see timing/motion). */
export interface PlanByLaunch {
  at(launchBeat: number): NoteTemplate[];
  /** No note lands later than this after its launch. */
  readonly maxOffset: number;
}

function groupTemplates(templates: NoteTemplate[], sourceId?: string): NoteTemplate[][] {
  const groups = new Map<string, NoteTemplate[]>();
  for (const t of templates) {
    if (sourceId !== undefined && t.sourceId !== sourceId) continue;
    const key = `${t.sourceId}|${t.receptorId}|${t.echo}`;
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }
  return [...groups.values()];
}

/** The notes one pulse sounds through one receptor (one source, one echo), onsets in the window. */
function pulseNotes(pulse: Pulse, list: NoteTemplate[], fromBeat: number, toBeat: number, out: NoteEvent[]): void {
  // An open slot plays the strongest colour falling through it: a slot straddling two
  // colours sounds one note (it flips where both are equally bright), not a clash of seconds.
  const bySlot = new Map<number, NoteTemplate>();
  const passing: NoteTemplate[] = [];
  for (const t of list) {
    if (!pulsePasses(pulse, t)) continue;
    if (t.slot === null) {
      passing.push(t);
      continue;
    }
    const prev = bySlot.get(t.slot);
    if (!prev || t.velocity > prev.velocity) bySlot.set(t.slot, t);
  }
  passing.push(...bySlot.values());
  // One pitch sounds once per pulse, even if its light came through two open slots.
  const byMidi = new Map<number, NoteTemplate>();
  for (const t of passing) {
    const prev = byMidi.get(t.midi);
    if (!prev || t.velocity > prev.velocity) byMidi.set(t.midi, t);
  }
  const chosen = [...byMidi.values()].sort((a, b) => b.velocity - a.velocity).slice(0, list[0]!.voices);
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
      brightness: t.brightness,
      pan: t.pan,
    });
  }
}

/**
 * All notes whose onset falls in [fromBeat, toBeat). A note belongs to the pulse launched
 * `offsetBeats` earlier, so we look up launches in the shifted window. Pulses carrying a
 * degree set (loom cards) only sound matching templates. Polyphony is capped per receptor
 * and pulse, strongest first. With moving optics the templates depend on each pulse's launch.
 */
export function notesInWindow(
  plan: NoteTemplate[] | PlanByLaunch,
  sources: Map<string, PulseSource>,
  fromBeat: number,
  toBeat: number,
): NoteEvent[] {
  const out: NoteEvent[] = [];
  if (!Array.isArray(plan)) {
    for (const src of sources.values()) {
      for (const pulse of pulsesInRange(src, fromBeat - plan.maxOffset, toBeat)) {
        for (const list of groupTemplates(plan.at(pulse.beat), src.id)) pulseNotes(pulse, list, fromBeat, toBeat, out);
      }
    }
    return out.sort((a, b) => a.beat - b.beat);
  }
  for (const list of groupTemplates(plan)) {
    const src = sources.get(list[0]!.sourceId);
    if (!src) continue;
    const minOff = Math.min(...list.map((t) => t.offsetBeats));
    const maxOff = Math.max(...list.map((t) => t.offsetBeats));
    for (const pulse of pulsesInRange(src, fromBeat - maxOff - 1e-9, toBeat - minOff)) pulseNotes(pulse, list, fromBeat, toBeat, out);
  }
  return out.sort((a, b) => a.beat - b.beat);
}
