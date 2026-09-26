import { describe, expect, it } from 'vitest';
import { LIGHT_CHANGES_MUSIC as T } from '../src/capture/timeline';
import { trace } from '../src/optics/tracer';
import { planNotes } from '../src/timing/arrivals';

const plan = (t: number) => {
  const s = T.at(t);
  return planNotes(s, trace(s));
};

describe('film timeline', () => {
  it('starts with a strummed chord and nothing else', () => {
    const p = plan(1);
    expect(new Set(p.map((x) => x.receptorId))).toEqual(new Set(['v-receptor']));
    expect(p.length).toBeGreaterThanOrEqual(3);
  });
  it('the filter at its peak removes notes, and they come back after', () => {
    const before = plan(9.9).length;
    const during = plan(12.3).length;
    const after = plan(15).filter((x) => x.sourceId === 'v-emitter').length + plan(15).filter((x) => x.sourceId === 'v-loom').length;
    expect(during).toBeLessThan(before);
    expect(after).toBeGreaterThan(during);
  });
  it('the loom card takes over at 14 s and the beat comes in at 19 s', () => {
    expect(plan(13).some((x) => x.sourceId === 'v-loom')).toBe(false);
    expect(plan(15).some((x) => x.sourceId === 'v-loom')).toBe(true);
    expect(plan(18).some((x) => x.receptorId === 'v-drums')).toBe(false);
    const drums = plan(20).filter((x) => x.receptorId === 'v-drums').map((x) => x.midi).sort();
    expect(drums).toEqual([36, 40]); // kick + hat
  });
});
