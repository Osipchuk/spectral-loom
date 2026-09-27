import { describe, expect, it } from 'vitest';
import { trace } from '../src/optics/tracer';
import { emptyScene } from '../src/scene/defaults';
import type { Receptor, SceneModel } from '../src/scene/types';
import { notesInWindow, planNotes } from '../src/timing/arrivals';
import { pulseSources } from '../src/timing/sources';
import { cutNewCards } from '../src/scene/cards';
import { MovingPlan } from '../src/timing/motion';
import { DRUM_SLIDE_BY, TARGETS, TUTORIAL_SWING, TUTORIAL_TURN_DEG, widenReceptor } from '../src/ui/tutorial';

const chordOf = (s: SceneModel): string => planNotes(s, trace(s)).map((t) => t.midi).sort().join(',');

function tutorialScene(mutate?: (s: SceneModel) => void): SceneModel {
  const s = emptyScene();
  s.settings = { ...s.settings, bpm: 100, scale: 'majorPent', root: 0 };
  s.elements.push(structuredClone(TARGETS.emitter), structuredClone(TARGETS.prism), structuredClone(TARGETS.receptor));
  mutate?.(s);
  return s;
}

describe('tutorial promises', () => {
  it('the narrow receptor hears a few notes, not the whole rainbow', () => {
    const notes = chordOf(tutorialScene()).split(',');
    expect(notes.length).toBeGreaterThanOrEqual(2);
    expect(notes.length).toBeLessThan(5);
  });

  it('sliding the receptor across the rainbow changes the chord, either way', () => {
    const base = chordOf(tutorialScene());
    for (const k of [1.8, -1.8]) {
      const moved = chordOf(
        tutorialScene((s) => {
          const r = s.elements[2]!;
          r.pos = { x: r.pos.x - Math.sin(r.rotation) * k, y: r.pos.y + Math.cos(r.rotation) * k };
        }),
      );
      expect(moved, `slid ${k}`).not.toBe(base);
    }
  });

  it('the chord glass plays C, G, Am, F — each bar only that chord’s notes', () => {
    const s = tutorialScene((sc) => {
      sc.settings.scale = 'major';
      widenReceptor(sc.elements[2] as Receptor);
      sc.elements.push(structuredClone(TARGETS.chord));
    });
    const plan = planNotes(s, trace(s));
    const pcs = (bar: number): string =>
      [...new Set(notesInWindow(plan, pulseSources(s), bar * 4 + 9.4, bar * 4 + 11.4).map((n) => n.midi % 12))].sort((a, b) => a - b).join(',');
    // Bars are offset by the light's travel time; compare the pitch-class sets of 4 bars.
    const sets = [0, 1, 2, 3].map(pcs);
    expect(new Set(sets).size).toBe(4);
    const chords = new Set(['0,4,7', '2,7,11', '0,4,9', '0,5,9']); // C, G, Am, F
    for (const set of sets) {
      const tones = set.split(',').map(Number);
      expect([...chords].some((c) => tones.every((t) => c.split(',').map(Number).includes(t))), set).toBe(true);
    }
  });
});

describe('tutorial promises: the card', () => {
  /** The table after "Write a melody": wide receptor, major key, Twinkle card cut to its light. */
  function melodyTable(cut = true): SceneModel {
    const s = tutorialScene((sc) => {
      sc.settings = { ...sc.settings, scale: 'major', root: 0, bpm: 100, quantize: 1 };
      widenReceptor(sc.elements[2] as Receptor);
      sc.elements.push(structuredClone(TARGETS.loom));
    });
    if (cut) cutNewCards(s);
    return s;
  }
  const tune = (s: SceneModel) => {
    const plan = s.elements.some((e) => e.motion) ? new MovingPlan(s) : planNotes(s, trace(s));
    return notesInWindow(plan, pulseSources(s), 0, 60)
      .filter((n) => n.launchBeat >= 0 && n.launchBeat < 48)
      .map((n) => ({ launch: n.launchBeat, midi: n.midi }));
  };

  it('the card is cut where it lands and plays Twinkle, exactly as a pitch card would', () => {
    const s = melodyTable();
    const loom = s.elements.find((e) => e.id === TARGETS.loom.id);
    expect(loom?.kind === 'loom' && loom.slots?.length).toBeGreaterThan(0);
    expect(tune(s)).toEqual(tune(melodyTable(false)));
    expect(tune(s).length).toBeGreaterThan(30);
  });

  it(`turning the prism ${TUTORIAL_TURN_DEG}° keeps the rhythm and changes the notes`, () => {
    const base = tune(melodyTable());
    const s = melodyTable();
    s.elements.find((e) => e.id === TARGETS.prism.id)!.rotation += (TUTORIAL_TURN_DEG * Math.PI) / 180;
    const turned = tune(s);
    expect(turned.length).toBeGreaterThan(base.length * 0.85);
    const at = new Map(turned.map((n) => [n.launch, n.midi]));
    expect(base.filter((n) => at.has(n.launch) && at.get(n.launch) !== n.midi).length).toBeGreaterThan(base.length * 0.25);
  });

  it('the clockwork swing makes the tune bend over time', () => {
    const base = tune(melodyTable());
    const s = melodyTable();
    s.elements.find((e) => e.id === TARGETS.prism.id)!.motion = { ...TUTORIAL_SWING };
    const swung = tune(s);
    expect(swung.length).toBeGreaterThan(base.length * 0.85);
    const at = new Map(swung.map((n) => [n.launch, n.midi]));
    expect(base.filter((n) => at.has(n.launch) && at.get(n.launch) !== n.midi).length).toBeGreaterThan(base.length * 0.2);
  });

  it('a hole straddling two colours plays one note, not a clash', () => {
    for (const deg of [1, 2, 3, 4, 5, 6]) {
      const s = melodyTable();
      s.elements.find((e) => e.id === TARGETS.prism.id)!.rotation += (deg * Math.PI) / 180;
      const perLaunch = new Map<number, number>();
      for (const n of tune(s)) perLaunch.set(n.launch, (perLaunch.get(n.launch) ?? 0) + 1);
      expect(Math.max(...perLaunch.values()), `${deg}°`).toBe(1);
    }
  });
});

describe('tutorial promises: drums', () => {
  /** The table after "Write a melody" plus the drum corner. */
  function drumTable(mutate?: (s: SceneModel) => void): SceneModel {
    const s = tutorialScene((sc) => {
      sc.settings = { ...sc.settings, scale: 'major', root: 0, bpm: 100, quantize: 1 };
      widenReceptor(sc.elements[2] as Receptor);
      sc.elements.push(structuredClone(TARGETS.loom), structuredClone(TARGETS.drumLamp), structuredClone(TARGETS.drumPrism), structuredClone(TARGETS.drums));
      mutate?.(sc);
    });
    cutNewCards(s);
    return s;
  }
  const hits = (s: SceneModel) =>
    notesInWindow(planNotes(s, trace(s)), pulseSources(s), 8, 16)
      .filter((n) => n.receptorId === TARGETS.drums.id)
      .map((n) => ({ beat: n.beat, piece: n.midi - 36 }));

  it('the narrow drum receptor on the red edge plays a kick on every beat, and nothing else', () => {
    const h = hits(drumTable());
    expect(h.length).toBe(8);
    expect(new Set(h.map((x) => x.piece))).toEqual(new Set([0]));
  });

  it('the Euclidean ring turns the metronome into 3 hits in 8 eighths', () => {
    const h = hits(drumTable((s) => s.elements.push(structuredClone(TARGETS.drumRing))));
    expect(h.length).toBe(6);
    expect(new Set(h.map((x) => x.piece))).toEqual(new Set([0]));
  });

  it('sliding the drum receptor towards violet turns the kick into hats', () => {
    const h = hits(
      drumTable((s) => {
        const r = s.elements.find((e) => e.id === TARGETS.drums.id)!;
        r.pos = { x: r.pos.x - Math.sin(r.rotation) * DRUM_SLIDE_BY, y: r.pos.y + Math.cos(r.rotation) * DRUM_SLIDE_BY };
      }),
    );
    expect(h.length).toBeGreaterThan(0);
    expect(h.every((x) => x.piece >= 4)).toBe(true);
  });

  it('the drums play in time with the melody: every note and hit on the grid', () => {
    for (const ring of [false, true]) {
      const s = drumTable((sc) => {
        if (ring) sc.elements.push(structuredClone(TARGETS.drumRing));
      });
      const events = notesInWindow(planNotes(s, trace(s)), pulseSources(s), 16, 32);
      const off = (b: number): number => Math.abs(b * 2 - Math.round(b * 2)) / 2; // distance to the nearest eighth
      for (const e of events.filter((x) => x.receptorId === TARGETS.receptor.id || x.receptorId === TARGETS.drums.id)) {
        expect(off(e.beat), `${e.receptorId} at ${e.beat.toFixed(3)}${ring ? ' (ring)' : ''}`).toBeLessThan(0.02);
      }
    }
  });

  it('the drum corner stays out of the melody: the bell receptor hears only the card', () => {
    const s = drumTable();
    const heard = trace(s).receptorHits.filter((x) => x.receptorId === TARGETS.receptor.id);
    expect(heard.every((x) => x.pulseSourceId === TARGETS.loom.id || x.pulseSourceId === TARGETS.emitter.id)).toBe(true);
  });
});
