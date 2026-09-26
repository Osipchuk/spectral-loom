import { describe, expect, it } from 'vitest';
import { trace } from '../src/optics/tracer';
import { DEMO_SCENES } from '../src/scene/demos';
import { toEngine2 } from '../src/scene/engine2';
import type { SceneModel } from '../src/scene/types';
import { notesInWindow, planNotes } from '../src/timing/arrivals';
import { hasMotion, MOTION_STEP, motionAngle, MovingPlan, poseAt } from '../src/timing/motion';
import { pulseSources } from '../src/timing/sources';

const ode = (): SceneModel => toEngine2(DEMO_SCENES.find((d) => d.id === 'ode')!.scene);
const melody = (s: SceneModel, plan = hasMotion(s) ? new MovingPlan(s) : planNotes(s, trace(s))) =>
  notesInWindow(plan, pulseSources(s), 0, 72)
    .filter((e) => e.receptorId === 'melody-receptor' && e.launchBeat >= 0 && e.launchBeat < 64)
    .map((e) => ({ launch: e.launchBeat, midi: e.midi, beat: e.beat }));

describe('moving optics', () => {
  it('turn and swing add the right angle', () => {
    expect(motionAngle({ kind: 'turn', degPerBar: 10 }, 8, 4)).toBeCloseTo((20 * Math.PI) / 180);
    expect(motionAngle({ kind: 'swing', degrees: 5, bars: 4 }, 4, 4)).toBeCloseTo((5 * Math.PI) / 180);
    expect(motionAngle({ kind: 'swing', degrees: 5, bars: 4 }, 8, 4)).toBeCloseTo(0);
  });

  it('a still table is its own pose, and a still plan is the plain plan', () => {
    const s = ode();
    expect(poseAt(s, 13)).toBe(s);
    expect(hasMotion(s)).toBe(false);
  });

  it('a moving table without motion amplitude plays exactly what a still one does', () => {
    const s = ode();
    s.elements.find((e) => e.id === 'melody-prism')!.motion = { kind: 'swing', degrees: 0, bars: 4 };
    expect(hasMotion(s)).toBe(false);
  });

  it('a swinging prism bends the melody over time; the card keeps its rhythm', () => {
    const still = melody(ode());
    const s = ode();
    s.elements.find((e) => e.id === 'melody-prism')!.motion = { kind: 'swing', degrees: 5, bars: 4 };
    const moving = melody(s);
    // Rhythm: the same pulses still sound (a colour can fall outside the receptor now and then).
    const launches = new Set(moving.map((n) => n.launch));
    expect(still.filter((n) => launches.has(n.launch)).length).toBeGreaterThan(still.length * 0.85);
    // Pitch: a good share of notes changed, and differently at different times.
    const byLaunch = new Map(moving.map((n) => [n.launch, n.midi]));
    const changed = still.filter((n) => byLaunch.has(n.launch) && byLaunch.get(n.launch) !== n.midi);
    expect(changed.length).toBeGreaterThan(still.length * 0.2);
    expect(new Set(changed.map((n) => byLaunch.get(n.launch)! - n.midi)).size).toBeGreaterThan(2);
  });

  it('each pulse plays the glass as it stood when the pulse set off', () => {
    const s = ode();
    s.elements.find((e) => e.id === 'melody-prism')!.motion = { kind: 'turn', degPerBar: 3 };
    const plan = new MovingPlan(s);
    for (const launch of [0, 5.5, 17, 33.25]) {
      const posed = poseAt(s, Math.floor(launch / MOTION_STEP) * MOTION_STEP);
      const want = planNotes(posed, trace(posed)).map((t) => `${t.receptorId}|${t.midi}|${t.offsetBeats.toFixed(6)}`).sort();
      expect(plan.at(launch).map((t) => `${t.receptorId}|${t.midi}|${t.offsetBeats.toFixed(6)}`).sort()).toEqual(want);
    }
  });
});

describe('saving a moving engine-2 table', () => {
  it('keeps the engine, the slots and the clockwork', async () => {
    const { parseScene, serializeScene } = await import('../src/scene/serialize');
    const s = ode();
    s.elements.find((e) => e.id === 'melody-prism')!.motion = { kind: 'swing', degrees: 5, bars: 4 };
    const back = parseScene(serializeScene(s));
    expect(back.settings.engine).toBe(2);
    const loom = back.elements.find((e) => e.id === 'melody-loom');
    expect(loom?.kind === 'loom' && loom.slots).toEqual((s.elements.find((e) => e.id === 'melody-loom') as { slots: unknown }).slots);
    expect(back.elements.find((e) => e.id === 'melody-prism')!.motion).toEqual({ kind: 'swing', degrees: 5, bars: 4 });
    expect(melody(back)).toEqual(melody(s));
  });
});
