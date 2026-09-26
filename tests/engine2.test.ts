import { describe, expect, it } from 'vitest';
import { trace } from '../src/optics/tracer';
import { DEMO_SCENES } from '../src/scene/demos';
import { recutLoom, toEngine1, toEngine2 } from '../src/scene/engine2';
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

/** Echoes follow the light in engine 2 instead of being rounded; everything else must match. */
const TIMING_TOLERANCE: Record<string, number> = { echo: 0.12 };

describe('engine 2 plays the demos as engine 1 does', () => {
  for (const demo of DEMO_SCENES) {
    it(demo.id, () => {
      const v1 = events(demo.scene);
      const v2scene = toEngine2(demo.scene);
      expect(v2scene.settings.engine).toBe(2);
      const r = compare(v1, events(v2scene));
      expect(r.unmatched, 'notes lost').toBe(0);
      expect(r.extra, 'notes added').toBe(0);
      expect(r.maxDt, 'timing').toBeLessThan(TIMING_TOLERANCE[demo.id] ?? 0.03);
    });
  }

  it('turns every card into slots and back into the same pitches', () => {
    for (const demo of DEMO_SCENES) {
      const v2 = toEngine2(demo.scene);
      for (const el of v2.elements) if (el.kind === 'loom') expect(el.slots?.length, el.id).toBeGreaterThan(0);
      const back = toEngine1(v2);
      const r = compare(events(demo.scene), events(back));
      expect(r.unmatched + r.extra, demo.id).toBe(0);
    }
  });

  it('re-cutting a card at the same geometry keeps its melody', () => {
    const v2 = toEngine2(DEMO_SCENES.find((d) => d.id === 'ode')!.scene);
    const again = recutLoom(v2, 'melody-loom');
    expect(compare(events(v2), events(again)).unmatched).toBe(0);
  });
});

describe('engine 2 lets the optics play', () => {
  const ode = (): SceneModel => toEngine2(DEMO_SCENES.find((d) => d.id === 'ode')!.scene);
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
    // Engine 1 ignores the same turn: the card is the score there.
    const v1 = DEMO_SCENES.find((d) => d.id === 'ode')!.scene;
    const v1turned = structuredClone(v1);
    v1turned.elements.find((e) => e.id === 'melody-prism')!.rotation += (4 * Math.PI) / 180;
    expect(melody(v1turned)).toEqual(melody(v1));
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

  it('engine 1 snaps: turning the bass prism of Canon by a hair throws the voice a sixteenth', () => {
    expect(worstJump(DEMO_SCENES.find((d) => d.id === 'canon')!.scene, 'ground-prism')).toBeGreaterThan(0.2);
  });

  // Colours fade between slots and each note keeps its colour's timing, so what is left is
  // a colour's earliest ray slipping off the edge of a receptor: under 4 ms.
  it('engine 2 glides: turning any element never makes a note jump in time', () => {
    for (const demo of DEMO_SCENES) {
      const base = toEngine2(demo.scene);
      for (const el of base.elements) {
        if (el.kind !== 'prism' && el.kind !== 'mirror' && el.kind !== 'lens') continue;
        // Pitches may change as colours slide across slots; notes that stay must not jump.
        expect(worstJump(base, el.id), `${demo.id} ${el.id}`).toBeLessThan(0.004);
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
    const prelude = toEngine2(DEMO_SCENES.find((d) => d.id === 'prelude')!.scene);
    const arp = (s: SceneModel) => planNotes(s, trace(s)).filter((t) => t.receptorId === 'arp-receptor');
    const noLens = structuredClone(prelude);
    noLens.elements = noLens.elements.filter((e) => e.id !== 'arp-lens');
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(arp(prelude).map((t) => t.brightness))).toBeGreaterThan(mean(arp(noLens).map((t) => t.brightness)) + 0.1);
    expect(mean(arp(prelude).map((t) => t.velocity))).toBeGreaterThan(mean(arp(noLens).map((t) => t.velocity)));
  });
});
