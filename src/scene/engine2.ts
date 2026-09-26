import { lightToDegree, receptorPitch } from '../music/pitch';
import { cardU, isCut, loomSlots } from '../optics/slots';
import { trace } from '../optics/tracer';
import type { RayTree } from '../optics/types';
import { fromAngle, madd } from '../optics/vec2';
import { AUDIO_THRESHOLD, planNotes, type NoteTemplate } from '../timing/arrivals';
import { poseAt } from '../timing/motion';
import { cloneScene } from './defaults';
import type { Loom, LoomNote, LoomSlot, Receptor, SceneModel } from './types';

/*
 * Moving between the two engines without changing the music.
 *
 * Engine 1 cards hold pitches; engine 2 cards hold slots. Converting a card cuts one slot
 * per pitch exactly where that colour crosses the card now, and moves every note from its
 * pitch row to that slot's row. At this geometry the card plays what it played before;
 * move a prism afterwards and different colours fall through the same slots.
 */

/** Where a card's light crosses it and which pitch it plays, for light that reaches a receptor. */
interface Crossing {
  u: number;
  degree: number;
  slot: number | null;
  receptorId: string;
}

function crossings(scene: SceneModel, tree: RayTree, loom: Loom): Crossing[] {
  const out: Crossing[] = [];
  for (const hit of tree.receptorHits) {
    if (hit.pulseSourceId !== loom.id || hit.intensity < AUDIO_THRESHOLD) continue;
    const r = scene.elements.find((e): e is Receptor => e.id === hit.receptorId && e.kind === 'receptor');
    if (!r || !r.enabled) continue;
    let seg: RayTree['segments'][number] | undefined = tree.segments[hit.segmentId];
    while (seg && !(seg.endEvent.kind === 'interact' && seg.endEvent.elementId === loom.id)) {
      seg = seg.parent === null ? undefined : tree.segments[seg.parent];
    }
    if (!seg) continue;
    out.push({ u: cardU(loom, seg.end), degree: lightToDegree(hit.light, receptorPitch(scene.settings, r)), slot: hit.slot, receptorId: r.id });
  }
  // A card feeding several receptors is cut for the one that hears most of it.
  const count = new Map<string, number>();
  for (const c of out) count.set(c.receptorId, (count.get(c.receptorId) ?? 0) + 1);
  const main = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return out.filter((c) => c.receptorId === main);
}

/**
 * Cut slots for the pitches a card's light reaches now, one per pitch, in order along the
 * card. Neighbouring slots meet halfway between their outermost rays, so every ray falls
 * through the slot of its own pitch.
 */
export function cutSlots(scene: SceneModel, tree: RayTree, loom: Loom): { slots: LoomSlot[]; degrees: number[] } {
  const all = crossings(scene, tree, loom);
  const byDeg = new Map<number, number[]>();
  for (const c of all) {
    const list = byDeg.get(c.degree) ?? [];
    list.push(c.u);
    byDeg.set(c.degree, list);
  }
  const spans = [...byDeg.entries()]
    .map(([degree, us]) => ({ degree, lo: Math.min(...us), hi: Math.max(...us), mid: us.reduce((a, b) => a + b, 0) / us.length }))
    .sort((a, b) => a.mid - b.mid);
  if (spans.length === 0) return { slots: [], degrees: [] };
  const edges: number[] = [];
  for (let i = 0; i + 1 < spans.length; i++) {
    const a = spans[i]!;
    const b = spans[i + 1]!;
    // Rays of neighbouring pitches normally do not interleave; if they do, split at the means.
    edges.push(a.hi <= b.lo ? (a.hi + b.lo) / 2 : (a.mid + b.mid) / 2);
  }
  // The outer slots reach as far as the outermost rays' own strips (half a typical gap),
  // so at this geometry every ray passes whole through the slot of its pitch.
  const us = all.map((c) => c.u).sort((a, b) => a - b);
  const gaps = us.slice(1).map((x, i) => x - us[i]!).sort((a, b) => a - b);
  const margin = gaps.length > 0 ? Math.max(0.005, gaps[Math.floor(gaps.length / 2)]! / 2) : 0.04;
  const slots = spans.map((s, i) => ({
    u0: Math.max(-0.5, i === 0 ? s.lo - margin : edges[i - 1]!),
    u1: Math.min(0.5, i === spans.length - 1 ? s.hi + margin : edges[i]!),
  }));
  return { slots, degrees: spans.map((s) => s.degree) };
}

/**
 * Engine 2: cut every card that is not cut yet and that light reaches, keeping the notes it
 * plays (its rows are still pitches until then), with the glass posed as at `beat`.
 * Mutates the scene; returns the ids of the cards it cut.
 */
export function cutNewCards(scene: SceneModel, beat = 0): string[] {
  if (scene.settings.engine !== 2) return [];
  const fresh = scene.elements.filter((e): e is Loom => e.kind === 'loom' && e.enabled && !isCut(e));
  if (fresh.length === 0) return [];
  const posed = poseAt(scene, beat);
  const tree = trace(posed);
  const cut: string[] = [];
  for (const loom of fresh) {
    const asPosed = posed.elements.find((e): e is Loom => e.id === loom.id && e.kind === 'loom')!;
    const probe: Loom = { ...asPosed, notes: loom.notes };
    bakeLoom(posed, tree, probe);
    if (!isCut(probe)) continue;
    loom.slots = probe.slots;
    loom.notes = probe.notes;
    cut.push(loom.id);
  }
  return cut;
}

/** Rewrite notes through a row map, dropping the ones with no row and exact duplicates. */
function remap(notes: LoomNote[], row: (deg: number) => number | undefined): LoomNote[] {
  const seen = new Set<string>();
  const out: LoomNote[] = [];
  for (const n of notes) {
    const deg = row(n.deg);
    if (deg === undefined) continue;
    const key = `${n.at}|${deg}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...n, deg });
  }
  return out;
}

/** Engine-1 card → engine-2 card at the current geometry: same notes, now as slots. */
export function bakeLoom(scene: SceneModel, tree: RayTree, loom: Loom): void {
  const { slots, degrees } = cutSlots(scene, tree, loom);
  if (slots.length === 0) return;
  const slotOf = new Map(degrees.map((d, i) => [d, i]));
  loom.slots = slots;
  loom.notes = remap(loom.notes, (d) => slotOf.get(d));
}

/** The pitch each slot of an engine-2 card plays now (the most common one), by slot. */
export function slotPitches(scene: SceneModel, tree: RayTree, loom: Loom): Map<number, number> {
  const votes = new Map<number, Map<number, number>>();
  for (const c of crossings(scene, tree, loom)) {
    if (c.slot === null || c.slot < 0) continue;
    const v = votes.get(c.slot) ?? new Map<number, number>();
    v.set(c.degree, (v.get(c.degree) ?? 0) + 1);
    votes.set(c.slot, v);
  }
  const out = new Map<number, number>();
  for (const [slot, v] of votes) out.set(slot, [...v.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0]);
  return out;
}

/** Engine-2 card → engine-1 card: each slot's row becomes the pitch that falls through it now. */
export function unbakeLoom(scene: SceneModel, tree: RayTree, loom: Loom): void {
  const pitch = slotPitches(scene, tree, loom);
  loom.notes = remap(loom.notes, (s) => pitch.get(s));
}

/**
 * Engine-2 card: cut the slots again around the colours that cross it now, one colour per
 * slot, keeping the notes it plays now (a slot that catches two colours keeps its main one).
 */
export function recutLoom(scene: SceneModel, loomId: string): SceneModel {
  const out = cloneScene(scene);
  const loom = out.elements.find((e): e is Loom => e.id === loomId && e.kind === 'loom');
  if (!loom) return out;
  unbakeLoom(out, trace(out), loom);
  const v1 = { ...out, settings: { ...out.settings, engine: 1 as const } };
  bakeLoom(v1, trace(v1), loom);
  return out;
}

/** First onset of every note group (receptor, source, echo), with its size. */
function groupOnsets(plan: NoteTemplate[]): Map<string, { receptorId: string; echo: number; n: number; onset: number }> {
  const groups = new Map<string, { receptorId: string; echo: number; n: number; onset: number }>();
  for (const t of plan) {
    const key = `${t.receptorId}|${t.sourceId}|${t.echo}`;
    const g = groups.get(key) ?? { receptorId: t.receptorId, echo: t.echo, n: 0, onset: Infinity };
    g.n += 1;
    g.onset = Math.min(g.onset, t.offsetBeats);
    groups.set(key, g);
  }
  return groups;
}

/**
 * Slide each receptor along its axis (a fraction of a cell) so its notes start when they
 * did in `target`. Engine 2 pulls onsets to the grid only softly, so a voice whose light
 * arrived halfway between two sixteenths (which engine 1 rounded) needs its path trimmed
 * to land where it used to. One receptor moves all its groups at once, so it minimises
 * their weighted error; direct light counts most, each echo less.
 */
export function alignReceptors(scene: SceneModel, target: ReturnType<typeof groupOnsets>): void {
  const c = scene.settings.c;
  // Only receptors that are audibly off move at all: every nudge also shifts where the
  // light lands on the slit, which can change what a narrow receptor catches.
  let active: Set<string> | null = null;
  for (let iter = 0; iter < 10; iter++) {
    const now = groupOnsets(planNotes(scene, trace(scene)));
    const err = new Map<string, { sum: number; w: number }>();
    for (const [key, want] of target) {
      const have = now.get(key);
      if (!have) continue;
      const w = want.n / (1 + want.echo);
      const e = err.get(want.receptorId) ?? { sum: 0, w: 0 };
      e.sum += (have.onset - want.onset) * w;
      e.w += w;
      err.set(want.receptorId, e);
    }
    active ??= new Set([...err].filter(([, e]) => e.w > 0 && Math.abs(e.sum / e.w) >= 0.01).map(([id]) => id));
    let worst = 0;
    for (const [id, e] of err) {
      const r = scene.elements.find((x): x is Receptor => x.id === id && x.kind === 'receptor');
      if (!r || e.w === 0 || !active.has(id)) continue;
      const mean = e.sum / e.w;
      worst = Math.max(worst, Math.abs(mean));
      // Facing the light: moving forward shortens the path. Damped, since the soft grid
      // pull makes onsets move slower than the path near grid lines.
      r.pos = madd(r.pos, fromAngle(r.rotation), mean * c * 0.9);
    }
    if (worst < 1e-3) return;
  }
}

/** A scene for engine 2 that plays what the engine-1 scene plays. */
export function toEngine2(scene: SceneModel): SceneModel {
  if (scene.settings.engine === 2) return cloneScene(scene);
  const v1 = cloneScene(scene);
  const tree = trace(v1);
  const onsets = groupOnsets(planNotes(v1, tree));
  const out = cloneScene(scene);
  out.settings.engine = 2;
  for (const el of out.elements) if (el.kind === 'loom') bakeLoom(v1, tree, el);
  alignReceptors(out, onsets);
  return out;
}

/** A scene for engine 1: every card row becomes the pitch that falls through its slot now. */
export function toEngine1(scene: SceneModel): SceneModel {
  if (scene.settings.engine !== 2) return cloneScene(scene);
  const out = cloneScene(scene);
  const tree = trace(out);
  for (const el of out.elements) {
    if (el.kind !== 'loom') continue;
    unbakeLoom(out, tree, el);
    el.slots = loomSlots(el);
  }
  out.settings.engine = 1;
  return out;
}
