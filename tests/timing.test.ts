import { describe, expect, it } from 'vitest';
import { degreeToMidi, spectralPosition, wavelengthToDegree } from '../src/music/pitch';
import { midiToDegree, noteNameToMidi, parseVoice } from '../src/music/notation';
import { trace } from '../src/optics/tracer';
import { sampleBand } from '../src/optics/spectrum';
import { emptyScene, makeElement } from '../src/scene/defaults';
import { notesInWindow, planNotes, travelBeats } from '../src/timing/arrivals';
import { bjorklund } from '../src/timing/bjorklund';
import { pulseSources, pulsesInRange } from '../src/timing/sources';

const str = (p: boolean[]): string => p.map((b) => (b ? 'x' : '.')).join('');

describe('bjorklund', () => {
  it('produces the canonical Euclidean rhythms', () => {
    expect(str(bjorklund(8, 3))).toBe('x..x..x.');
    expect(str(bjorklund(8, 5))).toBe('x.xx.xx.');
    expect(str(bjorklund(16, 5))).toBe('x..x..x..x..x...');
    expect(str(bjorklund(4, 4))).toBe('xxxx');
    expect(str(bjorklund(4, 0))).toBe('....');
  });
  it('keeps the hit count and rotates', () => {
    for (let n = 1; n <= 16; n++) for (let k = 0; k <= n; k++) expect(bjorklund(n, k).filter(Boolean)).toHaveLength(k);
    expect(str(bjorklund(8, 3, 1))).toBe('..x..x.x');
  });
});

describe('pitch mapping', () => {
  it('maps red to low and violet to high', () => {
    expect(spectralPosition(700)).toBeCloseTo(0, 6);
    expect(spectralPosition(400)).toBeCloseTo(1, 6);
    expect(wavelengthToDegree(690, { scale: 'majorPent', span: 1 })).toBe(0);
    expect(wavelengthToDegree(405, { scale: 'majorPent', span: 1 })).toBe(4);
  });
  it('gives every scale degree at least one ray when rays ≥ degrees', () => {
    for (const [scale, span] of [['majorPent', 1], ['major', 2], ['major', 3]] as const) {
      const degs = new Set(sampleBand(400, 700, 24).map((nm) => wavelengthToDegree(nm, { scale, span })));
      expect(degs.size).toBe(scale === 'majorPent' ? 5 : 7 * span);
    }
  });
  it('quantizes degrees to the scale and never leaves it', () => {
    const ctx = { scale: 'majorPent' as const, root: 0, octave: 4, span: 1 };
    expect([0, 1, 2, 3, 4, 5].map((d) => degreeToMidi(d, ctx))).toEqual([60, 62, 64, 67, 69, 72]);
    expect(degreeToMidi(-1, ctx)).toBe(57);
  });
  it('parses the score notation into scale degrees', () => {
    expect(noteNameToMidi('C4')).toBe(60);
    expect(noteNameToMidi('F#4')).toBe(66);
    expect(midiToDegree(noteNameToMidi('G3'), 'major', 0, 4)).toBe(-3);
    const v = parseVoice('E4 E4:2 | [C4 G4]:4 -:2', 'major', 0, 4);
    expect(v.length).toBe(9);
    expect(v.notes).toEqual([
      { at: 0, len: 1, deg: 2 },
      { at: 1, len: 2, deg: 2 },
      { at: 3, len: 4, deg: 0 },
      { at: 3, len: 4, deg: 4 },
    ]);
  });
});

describe('timing', () => {
  it('computes arrival as distance over c', () => {
    expect(travelBeats(8, 4)).toBe(2);
  });
  it('expands Euclidean modulators into looping pulses', () => {
    const s = emptyScene();
    const m = makeElement('modulator', { x: 5, y: 5 }, 0, { steps: 8, hits: 3, subdivision: '1/8' });
    s.elements.push(m);
    const src = pulseSources(s).get(m.id)!;
    expect(src.loopBeats).toBe(4);
    expect(pulsesInRange(src, 0, 8).map((p) => p.beat)).toEqual([0, 1.5, 3, 4, 5.5, 7]);
  });

  it('delays notes by light travel time and strums a prism fan', () => {
    const s = emptyScene();
    s.settings.quantize = 0;
    s.settings.dispersion = 10;
    s.elements.push(makeElement('emitter', { x: 3, y: 14 }, 0, { pulse: '1/4' }));
    s.elements.push(makeElement('prism', { x: 12, y: 14 }, (70 * Math.PI) / 180, { size: 4 }));
    // Receptor angled across the fan so that red and violet travel different distances.
    s.elements.push(makeElement('receptor', { x: 26, y: 3 }, (110 * Math.PI) / 180, { aperture: 12, instrument: 'pluck', span: 1, voices: 8 }));
    const tree = trace(s);
    const plan = planNotes(s, tree);
    expect(plan.length).toBeGreaterThanOrEqual(4);
    const offsets = plan.map((t) => t.offsetBeats);
    // Roughly 20 grid units at c = 4 units/beat ≈ 5 beats of travel.
    expect(Math.min(...offsets)).toBeGreaterThan(3);
    // The strum: different pitches arrive at different times.
    expect(Math.max(...offsets) - Math.min(...offsets)).toBeGreaterThan(0.02);
    const notes = notesInWindow(plan, pulseSources(s), 10, 11);
    expect(new Set(notes.map((n) => n.launchBeat)).size).toBe(1);
  });

  it('doubles strum spread when c halves', () => {
    const build = (c: number) => {
      const s = emptyScene();
      s.settings.quantize = 0;
      s.settings.c = c;
      s.elements.push(makeElement('emitter', { x: 3, y: 14 }, 0));
      s.elements.push(makeElement('prism', { x: 12, y: 14 }, (70 * Math.PI) / 180, { size: 4 }));
      s.elements.push(makeElement('receptor', { x: 26, y: 3 }, (110 * Math.PI) / 180, { aperture: 12, span: 1, voices: 8 }));
      const plan = planNotes(s, trace(s));
      const o = plan.map((t) => t.offsetBeats);
      return Math.max(...o) - Math.min(...o);
    };
    expect(build(2) / build(4)).toBeCloseTo(2, 6);
  });

  it('turns a rainbow into a drum kit on a drum receptor: red is the kick', () => {
    const s = emptyScene();
    s.settings.quantize = 0;
    s.elements.push(makeElement('emitter', { x: 3, y: 14 }, 0, { pulse: '1/4' }));
    s.elements.push(makeElement('prism', { x: 12, y: 14 }, (70 * Math.PI) / 180, { size: 4 }));
    s.elements.push(makeElement('receptor', { x: 24, y: 4 }, (140 * Math.PI) / 180, { aperture: 12, instrument: 'drums', voices: 6 }));
    const tree = trace(s);
    const plan = planNotes(s, tree);
    expect(plan.map((t) => t.midi).sort()).toEqual([36, 37, 38, 39, 40, 41]);
    const reddest = [...tree.receptorHits].sort((a, b) => (b.light as { nm: number }).nm - (a.light as { nm: number }).nm)[0]!;
    expect(wavelengthToDegree((reddest.light as { nm: number }).nm, { scale: 'major', span: 1, kit: true })).toBe(0);
  });

  it('plays only the loom card degrees at each step', () => {
    const s = emptyScene();
    s.settings.quantize = 0;
    s.settings.scale = 'major';
    s.elements.push(makeElement('emitter', { x: 3, y: 14 }, 0, { pulse: 'drone' }));
    s.elements.push(makeElement('prism', { x: 12, y: 14 }, (70 * Math.PI) / 180, { size: 4 }));
    const loom = makeElement('loom', { x: 18, y: 8.5 }, (-41 * Math.PI) / 180, {
      length: 8,
      steps: 4,
      notes: [
        { at: 0, len: 1, deg: 1 },
        { at: 2, len: 1, deg: 5 },
      ],
    });
    s.elements.push(loom);
    s.elements.push(makeElement('receptor', { x: 24, y: 2 }, (130 * Math.PI) / 180, { aperture: 14, span: 1, voices: 4 }));
    const tree = trace(s);
    const plan = planNotes(s, tree).filter((t) => t.sourceId === loom.id);
    expect(new Set(plan.map((t) => t.degree)).size).toBe(7);
    const notes = notesInWindow(plan, pulseSources(s), 0, 40);
    expect(notes.length).toBeGreaterThan(0);
    expect(new Set(notes.map((n) => plan.find((t) => t.midi === n.midi)!.degree))).toEqual(new Set([1, 5]));
  });
});

describe('card phase', () => {
  it('shifting a card by n steps plays the same notes n steps later, looping round', () => {
    const s = emptyScene();
    const loom = makeElement('loom', { x: 5, y: 5 }, 0, { steps: 8, subdivision: '1/8', notes: [{ at: 0, len: 1, deg: 0 }, { at: 6, len: 2, deg: 3 }] });
    s.elements.push(loom);
    const beats = (): [number, number[] | null][] =>
      pulsesInRange(pulseSources(s).get(loom.id)!, 0, 4).map((p) => [p.beat, p.degrees] as [number, number[] | null]);
    expect(beats()).toEqual([[0, [0]], [3, [3]]]);
    loom.offset = 3;
    // Step 0 → 3 (beat 1.5); step 6 → 9 ≡ 1 (beat 0.5).
    expect(beats()).toEqual([[0.5, [3]], [1.5, [0]]]);
    loom.offset = -5; // the same phase as +3
    expect(beats()).toEqual([[0.5, [3]], [1.5, [0]]]);
  });
});
