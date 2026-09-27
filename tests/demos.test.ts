import { describe, expect, it } from 'vitest';
import { trace } from '../src/optics/tracer';
import { DEMO_SCENES } from '../src/scene/demos';
import { parseScene, serializeScene } from '../src/scene/serialize';
import { notesInWindow, planNotes } from '../src/timing/arrivals';
import { pulseSources } from '../src/timing/sources';
import { hasMotion, MovingPlan } from '../src/timing/motion';

describe('classical scores', () => {
  it('Ode to Joy plays the right melody, in order', () => {
    const scene = DEMO_SCENES.find((d) => d.id === 'ode')!.scene;
    const plan = planNotes(scene, trace(scene)).filter((t) => t.receptorId === 'melody-receptor');
    const notes = notesInWindow(plan, pulseSources(scene), 0, 200).filter((n) => n.launchBeat >= 0);
    // F#4 F#4 G4 A4 | A4 G4 F#4 E4 | D4 D4 E4 F#4 | F#4. E4 E4
    expect(notes.slice(0, 15).map((n) => n.midi)).toEqual([66, 66, 67, 69, 69, 67, 66, 64, 62, 62, 64, 66, 66, 64, 64]);
    // Quarter notes one beat apart (the card steps in eighths, two per quarter).
    expect(notes[1]!.beat - notes[0]!.beat).toBeCloseTo(1, 6);
  });

  it('Prelude in C walks the first bar arpeggio', () => {
    const scene = DEMO_SCENES.find((d) => d.id === 'prelude')!.scene;
    const plan = planNotes(scene, trace(scene)).filter((t) => t.receptorId === 'arp-receptor');
    const notes = notesInWindow(plan, pulseSources(scene), 0, 200).filter((n) => n.launchBeat >= 0);
    // C4 E4 G4 C5 E5 G4 C5 E5
    expect(notes.slice(0, 8).map((n) => n.midi)).toEqual([60, 64, 67, 72, 76, 67, 72, 76]);
  });
});

describe('lens', () => {
  it('focused light sounds brighter and louder than diffuse light', () => {
    const scene = DEMO_SCENES.find((d) => d.id === 'prelude')!.scene;
    const plan = planNotes(scene, trace(scene));
    const focused = plan.filter((t) => t.receptorId === 'arp-receptor');
    const diffuse = plan.filter((t) => t.receptorId === 'bass-receptor');
    const mean = (ts: { brightness: number }[]): number => ts.reduce((a, t) => a + t.brightness, 0) / ts.length;
    // Each note's own light: gathered to a point it is bright, a slice of a spread rainbow dull.
    expect(mean(focused)).toBeGreaterThan(0.25);
    expect(mean(diffuse)).toBeLessThan(0.2);
    expect(mean(focused)).toBeGreaterThan(mean(diffuse) * 2);
    // Removing the lens makes the arpeggio receptor dull (or lose light entirely).
    const noLens = { ...scene, elements: scene.elements.filter((e) => e.kind !== 'lens') };
    const plain = planNotes(noLens, trace(noLens)).filter((t) => t.receptorId === 'arp-receptor');
    expect(plain.length === 0 || mean(plain) < mean(focused)).toBe(true);
  });
});

describe('demo scenes', () => {
  for (const demo of DEMO_SCENES) {
    describe(demo.title, () => {
      const scene = demo.scene;
      const tree = trace(scene);
      // Moving optics: every note the scene plays over 8 bars, whatever the pose.
      const moving = hasMotion(scene) ? new MovingPlan(scene) : null;
      const plan = moving ? Array.from({ length: 128 }, (_, i) => moving.at(i * 0.25)).flat() : planNotes(scene, tree);

      it('round-trips through JSON', () => {
        expect(parseScene(serializeScene(scene))).toEqual(scene);
      });

      it('lights every receptor', () => {
        for (const r of scene.elements.filter((e) => e.kind === 'receptor')) {
          expect(plan.some((t) => t.receptorId === r.id), `${r.id} gets no audible light`).toBe(true);
        }
      });

      it('can play every note punched into its loom cards', () => {
        for (const loom of scene.elements) {
          if (loom.kind !== 'loom') continue;
          const degrees = new Set(plan.filter((t) => t.sourceId === loom.id).map((t) => t.degree));
          const missing = [...new Set(loom.notes.map((n) => n.deg))].filter((d) => !degrees.has(d));
          expect(missing, `${loom.id} has no ray for degrees`).toEqual([]);
        }
      });

      it('produces notes', () => {
        const notes = notesInWindow(moving ?? plan, pulseSources(scene), 16, 48);
        expect(notes.length).toBeGreaterThan(8);
      });
    });
  }
});
