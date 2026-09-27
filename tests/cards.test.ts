import { describe, expect, it } from 'vitest';
import { trace } from '../src/optics/tracer';
import { DEMO_SCENES } from '../src/scene/demos';
import { recutLoom } from '../src/scene/cards';
import type { SceneModel } from '../src/scene/types';
import { notesInWindow, planNotes, softQuantizeShift, type NoteEvent } from '../src/timing/arrivals';
import { pulseSources } from '../src/timing/sources';

const BEATS = 64;
/** Notes of the pulses launched in the first BEATS (their onsets may land a little later). */
const events = (s: SceneModel): NoteEvent[] =>
  notesInWindow(planNotes(s, trace(s)), pulseSources(s), 0, BEATS + 32).filter((e) => e.launchBeat >= 0 && e.launchBeat < BEATS);

/** Pair every note of `a` with a note of `b` of the same receptor, pitch and launch; worst timing error. */
function compare(a: NoteEvent[], b: NoteEvent[]): { unmatched: number; extra: number; maxDt: number } {
  const pool = new Map<string, NoteEvent[]>();
  for (const e of b) {
    const k = `${e.receptorId}|${e.midi}|${e.launchBeat}`;
    pool.set(k, [...(pool.get(k) ?? []), e]);
  }
  let unmatched = 0;
  let maxDt = 0;
  for (const e of a) {
    const list = pool.get(`${e.receptorId}|${e.midi}|${e.launchBeat}`) ?? [];
    if (list.length === 0) {
      unmatched++;
      continue;
    }
    let best = 0;
    list.forEach((o, i) => {
      if (Math.abs(o.beat - e.beat) < Math.abs(list[best]!.beat - e.beat)) best = i;
    });
    maxDt = Math.max(maxDt, Math.abs(list[best]!.beat - e.beat));
    list.splice(best, 1);
  }
  const extra = [...pool.values()].reduce((n, l) => n + l.length, 0);
  return { unmatched, extra, maxDt };
}

/** Laying out a score slides a voice by at most half a sixteenth, onto the nearest grid line. */
const HALF_GRID = 0.126;
/**
 * Echoes follow the light, not the grid; Canon's bass chord is a half-beat strum across a
 * tilted slit, and its upper notes are each pulled to the nearest line on their own.
 */
const TIMING_TOLERANCE: Record<string, number> = { echo: 0.2, canon: 0.2 };

describe('cutting the scores into slots keeps what they play', () => {
  for (const demo of DEMO_SCENES) {
    it(demo.id, () => {
      // The score as written (cards not cut yet, rows are pitches) against the cut cards.
      const r = compare(events(demo.authored), events(demo.scene));
      expect(r.unmatched, 'notes lost').toBe(0);
      expect(r.extra, 'notes added').toBe(0);
      expect(r.maxDt, 'timing').toBeLessThan(TIMING_TOLERANCE[demo.id] ?? HALF_GRID);
    });
  }

  it('starts every direct voice on the grid', () => {
    for (const demo of DEMO_SCENES) {
      if (demo.scene.elements.some((e) => e.motion)) continue;
      const plan = planNotes(demo.scene, trace(demo.scene));
      const first = new Map<string, number>();
      for (const t of plan) {
        if (t.echo > 0) continue;
        const k = `${t.receptorId}|${t.sourceId}`;
        first.set(k, Math.min(first.get(k) ?? Infinity, t.offsetBeats));
      }
      for (const [k, onset] of first) {
        const off = Math.abs(onset / 0.25 - Math.round(onset / 0.25)) * 0.25;
        expect(off, `${demo.id} ${k} starts at ${onset.toFixed(3)}`).toBeLessThan(0.03);
      }
    }
  });

  it('keeps every voice where it was laid out (a shift of a sixteenth fails here)', () => {
    const onsets: Record<string, string> = {};
    for (const demo of DEMO_SCENES) {
      if (demo.scene.elements.some((e) => e.motion)) continue;
      for (const t of planNotes(demo.scene, trace(demo.scene))) {
        const k = `${demo.id} ${t.receptorId} ${t.sourceId} echo ${t.echo}`;
        const v = Math.round(t.offsetBeats * 4) / 4;
        if (!(k in onsets) || Number(onsets[k]) > v) onsets[k] = v.toFixed(2);
      }
    }
    expect(onsets).toMatchSnapshot();
  });

  it('turns every card into slots', () => {
    for (const demo of DEMO_SCENES) {
      for (const el of demo.scene.elements) if (el.kind === 'loom') expect(el.slots?.length, el.id).toBeGreaterThan(0);
    }
  });

  it('re-cutting a card at the same geometry keeps its melody', () => {
    const v2 = DEMO_SCENES.find((d) => d.id === 'ode')!.scene;
    const again = recutLoom(v2, 'melody-loom');
    expect(compare(events(v2), events(again)).unmatched).toBe(0);
  });
});

describe('the optics play the card', () => {
  const ode = (): SceneModel => DEMO_SCENES.find((d) => d.id === 'ode')!.scene;
  const melody = (s: SceneModel): number[] => events(s).filter((e) => e.receptorId === 'melody-receptor').map((e) => e.midi);

  it('turning the prism changes the notes a card plays, not whether it plays', () => {
    const base = ode();
    const turned = structuredClone(base);
    turned.elements.find((e) => e.id === 'melody-prism')!.rotation += (4 * Math.PI) / 180;
    const a = melody(base);
    const b = melody(turned);
    expect(b.length).toBeGreaterThan(a.length * 0.8);
    const changed = b.filter((m, i) => m !== a[i]).length;
    expect(changed).toBeGreaterThan(0);
    // A card not cut yet ignores the same turn: its rows are pitches.
    const written = DEMO_SCENES.find((d) => d.id === 'ode')!.authored;
    const writtenTurned = structuredClone(written);
    writtenTurned.elements.find((e) => e.id === 'melody-prism')!.rotation += (4 * Math.PI) / 180;
    expect(melody(writtenTurned)).toEqual(melody(written));
  });

  const turned = (scene: SceneModel, id: string, deg: number): NoteEvent[] => {
    const s = structuredClone(scene);
    s.elements.find((e) => e.id === id)!.rotation += (deg * Math.PI) / 180;
    return events(s);
  };

  /**
   * Largest discontinuity in any note's onset while an element turns through 2°. Steps whose
   * notes move by more than a hair are bisected: a slope shrinks with the step, a jump (a
   * note snapping to the other side of a grid line) stays whatever the step.
   */
  const worstJump = (scene: SceneModel, id: string, hair = 0.004): number => {
    const jump = (a: number, b: number, ea: NoteEvent[], eb: NoteEvent[]): number => {
      const dt = compare(ea, eb).maxDt;
      if (dt < hair || b - a < 0.001) return dt;
      const m = (a + b) / 2;
      const em = turned(scene, id, m);
      return Math.max(jump(a, m, ea, em), jump(m, b, em, eb));
    };
    let worst = 0;
    let prev = turned(scene, id, 0);
    for (let k = 1; k <= 20; k++) {
      const cur = turned(scene, id, k * 0.1);
      worst = Math.max(worst, jump((k - 1) * 0.1, k * 0.1, prev, cur));
      prev = cur;
    }
    return worst;
  };

  // Colours fade between slots, so what is left is the earliest ray slipping off the edge of
  // a receptor. A card's chord strikes together on its group's first light, so such a slip
  // moves the whole chord: under 0.008 beat (about 5 ms at the slowest demo), far below what
  // the ear can place.
  it('glides: turning any element never makes a note jump in time', () => {
    for (const demo of DEMO_SCENES) {
      const base = demo.scene;
      for (const el of base.elements) {
        if (el.kind !== 'prism' && el.kind !== 'mirror' && el.kind !== 'lens') continue;
        // Pitches may change as colours slide across slots; notes that stay must not jump.
        expect(worstJump(base, el.id), `${demo.id} ${el.id}`).toBeLessThan(0.008);
      }
    }
  });

  it('soft quantization is continuous and keeps onsets in order', () => {
    let prev = -Infinity;
    for (let x = 0; x <= 2; x += 0.001) {
      const y = x + softQuantizeShift(x, 1);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-12);
      if (prev > -Infinity) expect(y - prev).toBeLessThan(0.01);
      prev = y;
    }
    expect(1.01 + softQuantizeShift(1.01, 1)).toBeCloseTo(1, 3);
  });

  it('a lens that gathers the light makes its notes louder and brighter', () => {
    const prelude = DEMO_SCENES.find((d) => d.id === 'prelude')!.scene;
    const arp = (s: SceneModel) => planNotes(s, trace(s)).filter((t) => t.receptorId === 'arp-receptor');
    const noLens = structuredClone(prelude);
    noLens.elements = noLens.elements.filter((e) => e.id !== 'arp-lens');
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(arp(prelude).map((t) => t.brightness))).toBeGreaterThan(mean(arp(noLens).map((t) => t.brightness)) + 0.1);
    expect(mean(arp(prelude).map((t) => t.velocity))).toBeGreaterThan(mean(arp(noLens).map((t) => t.velocity)));
  });
});

describe('chords spread out', () => {
  const spread = (s: SceneModel, receptorId: string) => {
    const t = planNotes(s, trace(s)).filter((x) => x.receptorId === receptorId && x.echo === 0);
    const pans = t.map((x) => x.pan);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const mp = mean(pans);
    const md = mean(t.map((x) => x.midi));
    const cov = mean(t.map((x) => (x.pan - mp) * (x.midi - md)));
    return { width: Math.max(...pans) - Math.min(...pans), cov };
  };

  it('each note of a wide receptor sits where its colour lands on the slit', () => {
    for (const [demo, receptor] of [
      ['afterglow', 'ag-chords-receptor'],
      ['gymnopedie', 'gym-accomp-receptor'],
      ['canon', 'ground-receptor'],
    ] as const) {
      expect(spread(DEMO_SCENES.find((d) => d.id === demo)!.scene, receptor).width, demo).toBeGreaterThan(0.4);
    }
  });

  it('stereo follows the table: mirror it left to right and every note swaps sides', () => {
    const s = DEMO_SCENES.find((d) => d.id === 'canon')!.scene;
    const mirrored = structuredClone(s);
    for (const e of mirrored.elements) {
      e.pos = { x: s.table.w - e.pos.x, y: e.pos.y };
      e.rotation = Math.PI - e.rotation;
    }
    const pans = (sc: SceneModel) =>
      new Map(planNotes(sc, trace(sc)).filter((t) => t.receptorId === 'ground-receptor' && t.echo === 0).map((t) => [t.midi, t.pan]));
    const direction = (p: Map<number, number>): number => {
      const midis = [...p.keys()].sort((x, y) => x - y);
      return Math.sign(p.get(midis[midis.length - 1]!)! - p.get(midis[0]!)!);
    };
    const a = pans(s);
    const b = pans(mirrored);
    expect(a.size).toBeGreaterThan(5);
    expect(direction(a)).not.toBe(0);
    // Low-to-high runs the other way across the stereo field once the table is mirrored.
    expect(direction(b)).toBe(-direction(a));
  });
});
