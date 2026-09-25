import { describe, expect, it } from 'vitest';
import { reflect, refract, refractiveIndex, schlick } from '../src/optics/dispersion';
import { trace } from '../src/optics/tracer';
import { filterLight, sampleBand } from '../src/optics/spectrum';
import { dot, fromAngle, norm } from '../src/optics/vec2';
import { emptyScene, makeElement } from '../src/scene/defaults';
import type { SceneModel } from '../src/scene/types';

const deg = (d: number): number => (d * Math.PI) / 180;

describe('Cauchy dispersion', () => {
  it('is normal: blue bends more than red', () => {
    expect(refractiveIndex(400)).toBeGreaterThan(refractiveIndex(700));
  });
  it('matches BK7 near 550 nm and pins it under exaggeration', () => {
    expect(refractiveIndex(550)).toBeCloseTo(1.5185, 3);
    expect(refractiveIndex(550, 5)).toBeCloseTo(refractiveIndex(550, 1), 10);
    const spread1 = refractiveIndex(400, 1) - refractiveIndex(700, 1);
    const spread5 = refractiveIndex(400, 5) - refractiveIndex(700, 5);
    expect(spread5 / spread1).toBeCloseTo(5, 6);
  });
});

describe('Snell refraction', () => {
  it('obeys n1 sin θ1 = n2 sin θ2', () => {
    const n = { x: 0, y: 1 };
    const d = norm({ x: Math.sin(deg(40)), y: -Math.cos(deg(40)) });
    const t = refract(d, n, 1 / 1.5)!;
    expect(Math.hypot(t.x, t.y)).toBeCloseTo(1, 10);
    expect(1 * Math.sin(deg(40))).toBeCloseTo(1.5 * t.x, 10);
    expect(t.y).toBeLessThan(0);
  });
  it('passes a normal-incidence ray straight through', () => {
    const t = refract({ x: 0, y: -1 }, { x: 0, y: 1 }, 1 / 1.5)!;
    expect(t.x).toBeCloseTo(0, 12);
    expect(t.y).toBeCloseTo(-1, 12);
  });
  it('returns null beyond the critical angle (TIR)', () => {
    const critical = Math.asin(1 / 1.5);
    const n = { x: 0, y: 1 };
    const below = norm({ x: Math.sin(critical - 0.01), y: -Math.cos(critical - 0.01) });
    const above = norm({ x: Math.sin(critical + 0.01), y: -Math.cos(critical + 0.01) });
    expect(refract(below, n, 1.5)).not.toBeNull();
    expect(refract(above, n, 1.5)).toBeNull();
    expect(schlick(Math.cos(critical + 0.01), 1.5, 1)).toBe(1);
  });
  it('reflects specularly', () => {
    const r = reflect(norm({ x: 1, y: -1 }), { x: 0, y: 1 });
    expect(r.x).toBeCloseTo(Math.SQRT1_2, 12);
    expect(r.y).toBeCloseTo(Math.SQRT1_2, 12);
  });
});

describe('Schlick Fresnel', () => {
  it('gives ~4% at normal incidence for glass and rises to 1 at grazing', () => {
    expect(schlick(1, 1, 1.5)).toBeCloseTo(0.04, 4);
    expect(schlick(0, 1, 1.5)).toBeCloseTo(1, 6);
    expect(schlick(Math.cos(deg(60)), 1, 1.5)).toBeGreaterThan(schlick(Math.cos(deg(30)), 1, 1.5));
  });
});

describe('spectrum', () => {
  it('samples the full band with N rays and narrower bands proportionally', () => {
    expect(sampleBand(400, 700, 24)).toHaveLength(24);
    expect(sampleBand(400, 550, 24)).toHaveLength(12);
    expect(sampleBand(500, 510, 24)).toHaveLength(3);
  });
  it('filters bands and blocks disjoint light', () => {
    const r = filterLight({ kind: 'band', minNm: 400, maxNm: 700 }, 500, 600)!;
    expect(r.light).toEqual({ kind: 'band', minNm: 500, maxNm: 600 });
    expect(r.gain).toBeCloseTo(1 / 3, 6);
    expect(filterLight({ kind: 'mono', nm: 420 }, 550, 650)).toBeNull();
  });
});

function scene(): SceneModel {
  const s = emptyScene('test');
  s.settings.dispersion = 3;
  return s;
}

describe('tracer', () => {
  it('stops a free beam at the table bounds', () => {
    const s = scene();
    s.elements.push(makeElement('emitter', { x: 2, y: 10 }, 0));
    const tree = trace(s);
    expect(tree.segments).toHaveLength(1);
    expect(tree.segments[0]!.end.x).toBeCloseTo(s.table.w, 6);
    expect(tree.segments[0]!.endEvent.kind).toBe('bounds');
  });

  it('disperses white light into N rays with violet deviated most', () => {
    const s = scene();
    s.elements.push(makeElement('emitter', { x: 2, y: 14 }, 0));
    // Apex tilted so incidence is near minimum deviation (~50°).
    s.elements.push(makeElement('prism', { x: 12, y: 14 }, deg(70), { size: 4 }));
    const tree = trace(s);
    const fan = tree.segments.filter((g) => g.group && g.depth === 2 && g.pathKey.endsWith('t'));
    expect(fan.length).toBe(24);
    const byNm = [...fan].sort((a, b) => (a.light as { nm: number }).nm - (b.light as { nm: number }).nm);
    const angle = (g: (typeof fan)[number]): number => Math.atan2(g.dir.y, g.dir.x);
    // A prism with the apex up bends light downwards; violet more than red.
    expect(angle(byNm[0]!)).toBeLessThan(angle(byNm[23]!));
    expect(fan.every((g) => g.endEvent.kind === 'bounds')).toBe(true);
  });

  it('shows total internal reflection at steep incidence inside glass', () => {
    const s = scene();
    s.settings.dispersion = 1;
    s.elements.push(makeElement('emitter', { x: 2, y: 14 }, 0, { spectrum: { kind: 'band', minNm: 540, maxNm: 560 } }));
    // Entry face perpendicular to the beam; the next face is met at 60° > critical angle.
    s.elements.push(makeElement('prism', { x: 12, y: 14 }, (2 * Math.PI) / 3, { size: 5 }));
    const tree = trace(s);
    expect(tree.segments.some((g) => g.pathKey.endsWith('R'))).toBe(true);
  });

  it('reflects off a mirror with its reflectance and counts bounces', () => {
    const s = scene();
    s.elements.push(makeElement('emitter', { x: 2, y: 10 }, 0));
    s.elements.push(makeElement('mirror', { x: 20, y: 10 }, Math.PI * 0.75, { reflectance: 0.8 }));
    const tree = trace(s);
    const refl = tree.segments.find((g) => g.bounces === 1)!;
    expect(refl.intensity).toBeCloseTo(0.8, 6);
    expect(refl.dir.x).toBeCloseTo(0, 6);
    expect(Math.abs(refl.dir.y)).toBeCloseTo(1, 6);
  });

  it('produces decaying echoes in a cavity with a splitter', () => {
    const s = scene();
    s.elements.push(makeElement('emitter', { x: 2, y: 4 }, deg(55)));
    s.elements.push(makeElement('mirror', { x: 24, y: 3 }, Math.PI / 2, { length: 40, reflectance: 0.95 }));
    s.elements.push(makeElement('mirror', { x: 24, y: 9 }, -Math.PI / 2, { length: 40, reflectance: 0.7, splitter: true }));
    s.elements.push(makeElement('receptor', { x: 24, y: 14 }, -Math.PI / 2, { aperture: 44 }));
    const tree = trace(s);
    const hits = tree.receptorHits.sort((a, b) => a.s - b.s);
    expect(hits.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i]!.intensity).toBeLessThan(hits[i - 1]!.intensity);
      expect(hits[i]!.s).toBeGreaterThan(hits[i - 1]!.s);
    }
  });

  it('focuses a parallel beam through a converging lens at f', () => {
    const s = scene();
    for (const y of [12, 13, 15, 16]) s.elements.push(makeElement('emitter', { x: 2, y }, 0));
    s.elements.push(makeElement('lens', { x: 10, y: 14 }, 0, { aperture: 6, focal: 8 }));
    const tree = trace(s);
    const after = tree.segments.filter((g) => g.depth === 1);
    expect(after).toHaveLength(4);
    for (const g of after) {
      // Each ray crosses the axis (y = 14) at x = 18.
      const t = (14 - g.start.y) / g.dir.y;
      expect(g.start.x + g.dir.x * t).toBeCloseTo(18, 1);
    }
    // A single beam narrows towards the focus.
    expect(tree.foci.length).toBeGreaterThan(0);
  });

  it('re-labels pulse source at a modulator', () => {
    const s = scene();
    const e = makeElement('emitter', { x: 2, y: 10 }, 0);
    const m = makeElement('modulator', { x: 10, y: 10.2 }, 0);
    s.elements.push(e, m);
    const tree = trace(s);
    expect(tree.segments).toHaveLength(2);
    expect(tree.segments[1]!.pulseSourceId).toBe(m.id);
    expect(tree.segments[1]!.pulseOriginS).toBeCloseTo(8, 1);
    expect(dot(tree.segments[1]!.dir, fromAngle(0))).toBeCloseTo(1, 9);
  });
});
