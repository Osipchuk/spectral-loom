import { describe, expect, it } from 'vitest';
import { trace } from '../src/optics/tracer';
import { emptyScene } from '../src/scene/defaults';
import type { SceneModel } from '../src/scene/types';
import { notesInWindow, planNotes } from '../src/timing/arrivals';
import { pulseSources } from '../src/timing/sources';
import { TARGETS } from '../src/ui/tutorial';

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
      (sc.elements[2] as { aperture: number }).aperture = 7;
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
