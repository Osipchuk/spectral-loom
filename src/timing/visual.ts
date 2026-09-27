import { lightToDegree, receptorPitch } from '../music/pitch';
import type { RayTree } from '../optics/types';
import type { Instrument, SceneModel } from '../scene/types';
import type { NoteTemplate } from './arrivals';
import type { BeatClock } from './clock';
import { pulsesInRange, type PulseSource } from './sources';

/** Envelope slot used by segments; 0 = neutral (light that reaches no receptor). */
export const ENV_SLOTS: (Instrument | 'neutral')[] = ['neutral', 'pad', 'pluck', 'bell', 'drums'];

/** Pulses on segments closer together than this merge into one held plateau (≤ 3 Hz). */
export const MIN_VISUAL_GAP_S = 1 / 3;
export const PULSES_PER_CHANNEL = 64;

/**
 * A row of the pulse texture: one pulse source, optionally narrowed to one pitch (cards not
 * cut yet, chord glass) or to one slot (cut cards).
 */
export interface VisualChannel {
  sourceId: string;
  degree: number | null;
  slot?: number;
}

export interface SegmentVisual {
  channel: number;
  /** Extra delay in seconds, applied progressively along a receptor's final segment. */
  warp: number;
  env: number;
  /**
   * 1 behind a loom card or chord glass: that light exists only while a hole or chord lets
   * it through, so it has no steady glow of its own, only swells. 0 elsewhere.
   */
  gate: number;
}

export interface VisualLayout {
  channels: VisualChannel[];
  segments: Map<number, SegmentVisual>;
}

const RELEASE_RANK: Record<Instrument | 'neutral', number> = { neutral: 0, drums: 0.5, pluck: 1, bell: 2, pad: 3 };

/**
 * Decide, for every segment, which pulses it carries and which envelope shapes its swell,
 * so that a swell reaching a receptor is the note that receptor plays:
 * - the channel is the segment's pulse source; for loom cards it is (card, pitch), because a
 *   card swells each colour on its own schedule;
 * - the envelope is that of the instrument downstream (the longest one if the light splits);
 * - the final segment into a receptor absorbs the onset quantization, so the swell lands
 *   exactly when the quantized note sounds.
 */
export function layoutVisuals(scene: SceneModel, tree: RayTree, plan: NoteTemplate[], bpm: number): VisualLayout {
  const byId = new Map(scene.elements.map((e) => [e.id, e]));
  const channels: VisualChannel[] = [];
  const channelIndex = new Map<string, number>();
  const channel = (sourceId: string, degree: number | null, slot?: number): number => {
    const key = `${sourceId}|${degree ?? ''}|${slot ?? ''}`;
    let i = channelIndex.get(key);
    if (i === undefined) {
      i = channels.length;
      channels.push(slot === undefined ? { sourceId, degree } : { sourceId, degree, slot });
      channelIndex.set(key, i);
    }
    return i;
  };

  const instrumentOf = new Map<number, Instrument>();
  const degreeOf = new Map<number, number>();
  const warpOf = new Map<number, number>();
  const spb = 60 / bpm;

  for (const hit of tree.receptorHits) {
    const r = byId.get(hit.receptorId);
    if (r?.kind !== 'receptor') continue;
    const deg = lightToDegree(hit.light, receptorPitch(scene.settings, r));
    const t = plan.find(
      (p) => p.receptorId === r.id && p.sourceId === hit.pulseSourceId && p.echo === hit.bounces && p.degree === deg && p.slot === hit.slot,
    );
    if (t) warpOf.set(hit.segmentId, (t.offsetBeats - t.travelBeats) * spb);
    const src = byId.get(hit.pulseSourceId);
    let id: number | null = hit.segmentId;
    while (id !== null) {
      const seg: RayTree['segments'][number] = tree.segments[id]!;
      const prev = instrumentOf.get(id);
      if (!prev || RELEASE_RANK[r.instrument] > RELEASE_RANK[prev]) instrumentOf.set(id, r.instrument);
      if ((src?.kind === 'loom' || src?.kind === 'chord') && seg.pulseSourceId === src.id) degreeOf.set(id, deg);
      id = seg.parent;
    }
  }

  const segments = new Map<number, SegmentVisual>();
  for (const seg of tree.segments) {
    const src = byId.get(seg.pulseSourceId);
    let ch: number;
    if (src?.kind === 'loom' && seg.slot !== null) {
      // Cut card: light behind a slot swells when that slot is open, whatever its colour
      // and whether or not it reaches a receptor; light behind solid card only glows.
      ch = seg.slot < 0 ? -1 : channel(src.id, null, seg.slot);
    } else if (src?.kind === 'loom' || src?.kind === 'chord') {
      const deg = degreeOf.get(seg.id);
      // Loom light that never reaches a receptor has no pitch: it only carries the base glow.
      ch = deg === undefined ? -1 : channel(src.id, deg);
    } else {
      ch = channel(seg.pulseSourceId, null);
    }
    const inst = instrumentOf.get(seg.id);
    const gate = src?.kind === 'loom' || src?.kind === 'chord' ? 1 : 0;
    segments.set(seg.id, { channel: ch, warp: warpOf.get(seg.id) ?? 0, env: inst ? ENV_SLOTS.indexOf(inst) : 0, gate });
  }
  return { channels, segments };
}

export interface VisualPulse {
  /** Audio-clock launch time, seconds. */
  time: number;
  hold: number;
  depth: number;
  /** Merged run of fast pulses: hold at full level instead of following the ADSR. */
  plateau: boolean;
}

/**
 * Pulses of one channel launched in [fromS, toS] on the audio clock, with runs closer than
 * MIN_VISUAL_GAP_S merged into plateaus. Audio still plays every note; only light merges.
 */
export function channelPulses(
  ch: VisualChannel,
  src: PulseSource,
  clock: Pick<BeatClock, 'beatAt' | 'timeAt' | 'secondsPerBeat'>,
  fromS: number,
  toS: number,
): VisualPulse[] {
  const raw = pulsesInRange(src, clock.beatAt(fromS), clock.beatAt(toS)).filter((p) =>
    ch.slot !== undefined ? !!p.slots?.includes(ch.slot) : ch.degree === null || !p.degrees || p.degrees.includes(ch.degree),
  );
  const out: VisualPulse[] = [];
  let lastLaunch = -Infinity;
  for (const p of raw) {
    const time = clock.timeAt(p.beat);
    const hold = Math.max(0.06, p.lenBeats * clock.secondsPerBeat * 0.95);
    const last = out[out.length - 1];
    if (last && time - lastLaunch < MIN_VISUAL_GAP_S - 1e-9) {
      last.hold = Math.max(last.hold, time + hold - last.time);
      last.depth = Math.max(last.depth, p.depth);
      last.plateau = true;
    } else {
      out.push({ time, hold, depth: p.depth, plateau: false });
    }
    lastLaunch = time;
  }
  return out.slice(-PULSES_PER_CHANNEL);
}
