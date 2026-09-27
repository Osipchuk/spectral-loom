import { describe, expect, it } from 'vitest';
import { trace } from '../src/optics/tracer';
import { DEMO_SCENES } from '../src/scene/demos';
import { planNotes } from '../src/timing/arrivals';
import { BeatClock } from '../src/timing/clock';
import { pulseSources } from '../src/timing/sources';
import { channelPulses, layoutVisuals, MIN_VISUAL_GAP_S } from '../src/timing/visual';

describe('visual pulses', () => {
  it('merges 1/16 pulses at 160 BPM into plateaus: nothing on a beam modulates faster than 3 Hz', () => {
    const clock = new BeatClock(160);
    clock.anchor(0, 0);
    const src = { id: 's', loopBeats: 0.25, events: [{ beat: 0, lenBeats: 0.25, degrees: null, depth: 0.5 }] };
    const pulses = channelPulses({ sourceId: 's', degree: null }, src, clock, 0, 10);
    // One continuous plateau instead of ~106 flashes.
    expect(pulses).toHaveLength(1);
    expect(pulses[0]!.plateau).toBe(true);
    expect(pulses[0]!.hold).toBeGreaterThan(9.5);
  });

  it('keeps separate swells when pulses are slower than 3 Hz', () => {
    const clock = new BeatClock(90);
    clock.anchor(0, 0);
    const src = { id: 's', loopBeats: 1, events: [{ beat: 0, lenBeats: 1, degrees: null, depth: 0.5 }] };
    const pulses = channelPulses({ sourceId: 's', degree: null }, src, clock, 0, 8);
    expect(pulses.length).toBe(12);
    for (let i = 1; i < pulses.length; i++) expect(pulses[i]!.time - pulses[i - 1]!.time).toBeGreaterThanOrEqual(MIN_VISUAL_GAP_S);
  });

  it('gives light behind a card not cut yet one channel per pitch and filters its pulses by pitch', () => {
    // A card not cut into slots yet still holds pitches, as the scores are written.
    const scene = DEMO_SCENES.find((d) => d.id === 'ode')!.authored;
    const tree = trace(scene);
    const plan = planNotes(scene, tree);
    const layout = layoutVisuals(scene, tree, plan, scene.settings.bpm);
    const loomChannels = layout.channels.filter((c) => c.sourceId === 'melody-loom');
    expect(loomChannels.length).toBeGreaterThanOrEqual(6);
    const clock = new BeatClock(scene.settings.bpm);
    clock.anchor(0, 0);
    const src = pulseSources(scene).get('melody-loom')!;
    const a4 = loomChannels.find((c) => c.degree === 11)!; // A4 in D major from D3
    const pulses = channelPulses(a4, src, clock, 0, clock.timeAt(8));
    // "F#4 F#4 G4 A4 | A4 …": A4 sounds at beats 3 and 4 of the first bars.
    // Repeated A4s are 0.58 s apart at 104 BPM: slower than 3 Hz, so two distinct swells.
    expect(pulses.map((p) => Math.round(clock.beatAt(p.time) * 100) / 100)).toEqual([3, 4]);
    expect(pulses.every((p) => !p.plateau)).toBe(true);
  });

  it('shapes receptor-bound light with that receptor’s envelope', () => {
    const scene = DEMO_SCENES.find((d) => d.id === 'canon')!.scene;
    const tree = trace(scene);
    const layout = layoutVisuals(scene, tree, planNotes(scene, tree), scene.settings.bpm);
    const hit = tree.receptorHits.find((h) => h.receptorId === 'violin-receptor')!;
    expect(layout.segments.get(hit.segmentId)!.env).toBe(3); // bell
    const padHit = tree.receptorHits.find((h) => h.receptorId === 'ground-receptor')!;
    expect(layout.segments.get(padHit.segmentId)!.env).toBe(1); // pad
  });
});
