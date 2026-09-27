import type { SceneElement, SceneModel } from '../scene/types';
import { reflect, refract, refractiveIndex, schlick } from './dispersion';
import {
  elementColliders,
  exitBounds,
  intersectModulator,
  intersectSegment,
  type Collider,
  type SegmentCollider,
} from './geometry';
import { cardU, isCut, loomSlots, slotAt } from './slots';
import { centroidNm, combTransmission, filterLight, sampleBand, WHITE, type RayLight } from './spectrum';
import { DEFAULT_TRACE_OPTIONS, type RaySegment, type RayTree, type ReceptorHit, type TraceOptions } from './types';
import { add, dot, fromAngle, madd, norm, perp, scale, sub, type Vec2 } from './vec2';

export const EMITTER_BEAM_WIDTH = 0.26;
/** Light between an interference comb's fringes: visible, but below the audio threshold. */
export const COMB_LEAK = 0.08;

interface RayState {
  o: Vec2;
  d: Vec2;
  light: RayLight;
  intensity: number;
  width: number;
  widthRate: number;
  s: number;
  emitterId: string;
  pulseSourceId: string;
  pulseOriginS: number;
  depth: number;
  bounces: number;
  parent: number | null;
  group: RaySegment['group'];
  pathKey: string;
  ignoreId: string | null;
  thin: boolean;
  slot: number | null;
  cardU: number | null;
}

/** Max-heap on intensity so the segment budget is spent on the brightest rays first. */
class RayHeap {
  private items: RayState[] = [];
  get size(): number {
    return this.items.length;
  }
  push(r: RayState): void {
    const a = this.items;
    a.push(r);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p]!.intensity >= a[i]!.intensity) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      i = p;
    }
  }
  pop(): RayState {
    const a = this.items;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l]!.intensity > a[m]!.intensity) m = l;
        if (r < a.length && a[r]!.intensity > a[m]!.intensity) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}

/** Signed width at distance t along a segment: w(t) = w0 + rate·t; |w| is the physical width. */
function widthAt(width: number, rate: number, t: number): { width: number; rate: number } {
  const w = width + rate * t;
  return w >= 0 ? { width: w, rate } : { width: -w, rate: -rate };
}

function lightFromEmitter(el: Extract<SceneElement, { kind: 'emitter' }>): RayLight {
  return el.spectrum.kind === 'white' ? WHITE : { kind: 'band', minNm: el.spectrum.minNm, maxNm: el.spectrum.maxNm };
}

/**
 * Trace every enabled emitter through the scene. Pure: depends only on the scene model.
 * Rays are processed brightest-first so that, if the segment budget runs out, only the
 * faintest secondary reflections are lost.
 */
export function trace(scene: SceneModel, options: Partial<TraceOptions> = {}): RayTree {
  const opts = { ...DEFAULT_TRACE_OPTIONS, ...options };
  const colliders: Collider[] = scene.elements.flatMap(elementColliders);
  const byId = new Map(scene.elements.map((e) => [e.id, e]));
  const { w: tableW, h: tableH } = scene.table;
  const segments: RaySegment[] = [];
  const receptorHits: ReceptorHit[] = [];
  const foci: RayTree['foci'] = [];
  const heap = new RayHeap();
  let groupCounter = 0;
  let truncated = false;

  for (const el of scene.elements) {
    if (el.kind !== 'emitter' || !el.enabled || el.intensity <= 0) continue;
    const d = fromAngle(el.rotation);
    heap.push({
      o: madd(el.pos, d, 0.02),
      d,
      light: lightFromEmitter(el),
      intensity: el.intensity,
      width: EMITTER_BEAM_WIDTH,
      widthRate: 0,
      s: 0,
      emitterId: el.id,
      pulseSourceId: el.id,
      pulseOriginS: 0,
      depth: 0,
      bounces: 0,
      parent: null,
      group: null,
      pathKey: el.id,
      ignoreId: null,
      thin: false,
      slot: null,
      cardU: null,
    });
  }

  const dispersionScale = (id: string): number => {
    const el = byId.get(id);
    return scene.settings.dispersion * (el?.kind === 'prism' ? el.dispersion : 1);
  };

  while (heap.size > 0) {
    if (segments.length >= opts.maxSegments) {
      truncated = true;
      break;
    }
    const ray = heap.pop();
    if (!(ray.o.x >= 0 && ray.o.x <= tableW && ray.o.y >= 0 && ray.o.y <= tableH)) continue;

    let bestT = exitBounds(ray.o, ray.d, tableW, tableH);
    let best: { c: Collider; u: number } | null = null;
    for (const c of colliders) {
      if (c.elementId === ray.ignoreId) continue;
      if (c.kind === 'seg') {
        const hit = intersectSegment(ray.o, ray.d, c.a, c.b);
        if (hit && hit.t < bestT) {
          bestT = hit.t;
          best = { c, u: hit.u };
        }
      } else {
        const t = intersectModulator(ray.o, ray.d, c.c, c.r);
        if (t !== null && t < bestT) {
          bestT = t;
          best = { c, u: 0.5 };
        }
      }
    }

    const end = madd(ray.o, ray.d, bestT);
    const fanPower = ray.group ? ray.intensity * ray.group.count : ray.intensity;
    const seg: RaySegment = {
      id: segments.length,
      parent: ray.parent,
      start: ray.o,
      end,
      dir: ray.d,
      length: bestT,
      light: ray.light,
      intensity: ray.intensity,
      width: ray.width,
      widthRate: ray.widthRate,
      sStart: ray.s,
      emitterId: ray.emitterId,
      pulseSourceId: ray.pulseSourceId,
      pulseOriginS: ray.pulseOriginS,
      endEvent: { kind: 'bounds' },
      group: ray.group,
      pathKey: ray.pathKey,
      bounces: ray.bounces,
      thin: ray.thin,
      slot: ray.slot,
      cardU: ray.cardU,
      depth: ray.depth,
      audible: fanPower >= opts.audioThreshold,
    };
    segments.push(seg);

    if (ray.widthRate < 0) {
      const tf = ray.width / -ray.widthRate;
      if (tf < bestT) foci.push({ pos: madd(ray.o, ray.d, tf), segmentId: seg.id, strength: ray.intensity });
    }
    if (!best) continue;

    const { c } = best;
    const atEnd = widthAt(ray.width, ray.widthRate, bestT);
    const child = (over: Partial<RayState> & Pick<RayState, 'd' | 'intensity'>, tag: string): void => {
      const next: RayState = {
        ...ray,
        o: end,
        s: ray.s + bestT,
        width: atEnd.width,
        widthRate: atEnd.rate,
        parent: seg.id,
        ignoreId: null,
        pathKey: `${ray.pathKey}|${c.elementId}:${c.face}${tag}`,
        ...over,
      };
      // Faint light behind an interference comb is judged by its whole fan's power (one of
      // 24 rays is weak on its own); everything else by its own intensity, which prunes
      // the many faint Fresnel reflections of fan rays.
      const power = tag === 'c-' && next.group ? next.intensity * next.group.count : next.intensity;
      if (power < opts.minIntensity) return;
      if (next.depth > opts.maxDepth) {
        seg.endEvent = { kind: 'cutoff' };
        return;
      }
      heap.push(next);
    };

    switch (c.role) {
      case 'absorb':
        seg.endEvent = { kind: 'absorbed', elementId: c.elementId };
        break;

      case 'receptor': {
        const sc = c as SegmentCollider;
        if (dot(ray.d, sc.normal) < 0) {
          seg.endEvent = { kind: 'receptor', elementId: c.elementId };
          receptorHits.push({
            receptorId: c.elementId,
            segmentId: seg.id,
            s: ray.s + bestT,
            light: ray.light,
            intensity: ray.intensity * (ray.group ? ray.group.count : 1),
            width: atEnd.width,
            pulseSourceId: ray.pulseSourceId,
            pulseOriginS: ray.pulseOriginS,
            bounces: ray.bounces,
            u: best.u - 0.5,
            pos: end,
            fan: ray.group ? ray.group.count : 1,
            slot: ray.slot,
            cardU: ray.cardU,
            fanId: ray.group ? ray.group.id : -1,
          });
        } else {
          seg.endEvent = { kind: 'absorbed', elementId: c.elementId };
        }
        break;
      }

      case 'mirror': {
        const el = byId.get(c.elementId);
        if (el?.kind !== 'mirror') break;
        const sc = c as SegmentCollider;
        seg.endEvent = { kind: 'interact', elementId: c.elementId, role: 'mirror' };
        child(
          { d: reflect(ray.d, sc.normal), intensity: ray.intensity * el.reflectance, depth: ray.depth + 1, bounces: ray.bounces + 1 },
          'r',
        );
        if (el.splitter) {
          child({ d: ray.d, intensity: ray.intensity * (1 - el.reflectance), ignoreId: c.elementId }, 't');
        }
        break;
      }

      case 'glass': {
        const sc = c as SegmentCollider;
        seg.endEvent = { kind: 'interact', elementId: c.elementId, role: 'glass' };
        const entering = dot(ray.d, sc.normal) < 0;
        const nrm = entering ? sc.normal : scale(sc.normal, -1);
        const disp = dispersionScale(c.elementId);
        const cosI = -dot(ray.d, nrm);
        const depth = ray.depth + 1;

        if (ray.light.kind === 'band' && entering) {
          // First refraction of a band: reflect it whole, disperse the transmitted part.
          const r = schlick(cosI, 1, refractiveIndex(550, disp));
          child({ d: reflect(ray.d, nrm), intensity: ray.intensity * r, depth }, 'r');
          const samples = sampleBand(ray.light.minNm, ray.light.maxNm, scene.settings.raysPerSplit);
          const gid = ++groupCounter;
          samples.forEach((nm, index) => {
            const n2 = refractiveIndex(nm, disp);
            const t = refract(ray.d, nrm, 1 / n2);
            if (!t) return;
            const tr = 1 - schlick(cosI, 1, n2);
            child(
              {
                d: norm(t),
                light: { kind: 'mono', nm },
                intensity: (ray.intensity * tr) / samples.length,
                group: { id: gid, index, count: samples.length },
                depth,
              },
              '>s',
            );
          });
          break;
        }

        const n = refractiveIndex(centroidNm(ray.light), disp);
        const [n1, n2] = entering ? [1, n] : [n, 1];
        const t = refract(ray.d, nrm, n1 / n2);
        const r = t ? schlick(cosI, n1, n2) : 1;
        child({ d: reflect(ray.d, nrm), intensity: ray.intensity * r, depth }, t ? 'r' : 'R');
        if (t) child({ d: norm(t), intensity: ray.intensity * (1 - r), depth }, 't');
        break;
      }

      case 'lens': {
        const el = byId.get(c.elementId);
        if (el?.kind !== 'lens') break;
        const sc = c as SegmentCollider;
        seg.endEvent = { kind: 'interact', elementId: c.elementId, role: 'lens' };
        // Paraxial thin lens: slope relative to the optical axis changes by -h/f.
        const f = lensFocal(el.focal);
        const axis = sc.normal;
        const tangent = perp(axis);
        const h = dot(sub(end, el.pos), tangent);
        const along = dot(ray.d, axis);
        const slope = dot(ray.d, tangent) / Math.max(Math.abs(along), 1e-3);
        const d = norm(add(scale(axis, Math.sign(along) || 1), scale(tangent, slope - h / f)));
        // Fermat: a converging lens is thicker in the middle, so a ray through its centre is
        // held back just enough that rays through the rim, which travel further to the focus,
        // arrive together with it (a diverging lens the other way round). Measured from the
        // centre, so the axis keeps its timing. Without this a rainbow gathered to a point
        // arrives as a ragged strum.
        child(
          {
            d,
            s: ray.s + bestT - (h * h) / (2 * f),
            intensity: ray.intensity * 0.97,
            widthRate: atEnd.rate - atEnd.width / f,
            depth: ray.depth + 1,
            ignoreId: c.elementId,
          },
          'l',
        );
        break;
      }

      case 'filter': {
        const el = byId.get(c.elementId);
        if (el?.kind !== 'filter') break;
        const res = filterLight(ray.light, el.minNm, el.maxNm);
        if (!res) {
          seg.endEvent = { kind: 'absorbed', elementId: c.elementId };
          break;
        }
        seg.endEvent = { kind: 'interact', elementId: c.elementId, role: 'filter' };
        child({ d: ray.d, light: res.light, intensity: ray.intensity * res.gain * 0.95, ignoreId: c.elementId }, 'f');
        break;
      }

      case 'comb': {
        const el = byId.get(c.elementId);
        if (el?.kind !== 'comb') break;
        seg.endEvent = { kind: 'interact', elementId: c.elementId, role: 'comb' };
        // The comb straightens what it lets through: every line leaves square to it, so a
        // fan of colours comes out as parallel lines. (A real interference filter only picks
        // colours; picking and straightening together is what a grating and a collimating
        // lens do in a spectrograph. Here one element does both.)
        const sc = c as SegmentCollider;
        const out = dot(ray.d, sc.normal) >= 0 ? sc.normal : scale(sc.normal, -1);
        const thin = { d: out, width: Math.min(atEnd.width, 0.06), widthRate: 0, thin: true, ignoreId: c.elementId };
        if (ray.light.kind === 'mono') {
          const gain = combTransmission(ray.light.nm, el.fringes, el.phase);
          if (gain < 0.04) {
            // Between fringes the comb is dark but not black: the rainbow carries on faintly
            // behind it, as it was going — too dim to sound, bright enough to see.
            child({ d: ray.d, intensity: ray.intensity * COMB_LEAK, ignoreId: c.elementId }, 'c-');
            break;
          }
          // A colour of the fan on a fringe: a thin straight line, keeping its slice's power.
          child({ intensity: ray.intensity * gain, ...thin }, 'c');
          break;
        }
        // White (or band) light: the comb makes no colours (only a prism does). It spreads the
        // beam over its whole length as parallel strands of the same light, one per fringe,
        // evenly spaced like slits: the comb's length sets the width, Fringes how dense.
        const n = Math.max(1, Math.round(el.fringes));
        const gid = ++groupCounter;
        const along = perp(out);
        const at = (best.u - 0.5) * el.length;
        for (let index = 0; index < n; index++) {
          const slit = ((index + 0.5) / n - 0.5) * el.length;
          child(
            {
              o: madd(end, along, slit - at),
              intensity: (ray.intensity * 0.85) / n,
              ...thin,
              group: { id: gid, index, count: n },
            },
            'c',
          );
        }
        break;
      }

      case 'modulator':
      case 'loom':
      case 'chord': {
        seg.endEvent = { kind: 'interact', elementId: c.elementId, role: c.role };
        // A cut card remembers where the light crossed it and through which slot. A card not
        // cut yet (no slots) still holds pitches.
        const el = byId.get(c.elementId);
        const u = el?.kind === 'loom' && isCut(el) ? cardU(el, end) : null;
        const slot = u !== null && el?.kind === 'loom' ? slotAt(loomSlots(el), u) : null;
        child(
          { d: ray.d, intensity: ray.intensity, pulseSourceId: c.elementId, pulseOriginS: ray.s + bestT, ignoreId: c.elementId, slot, cardU: u },
          'm',
        );
        break;
      }
    }
  }

  return { segments, receptorHits, foci, truncated };
}

/** Shortest focal length a lens has: f = 0 would bend light by infinity (NaN rays). */
export const MIN_FOCAL = 0.5;

/** A lens's focal length as the optics use it: never shorter than MIN_FOCAL, 0 counts as +. */
export function lensFocal(focal: number): number {
  if (!Number.isFinite(focal)) return MIN_FOCAL;
  return Math.abs(focal) >= MIN_FOCAL ? focal : focal < 0 ? -MIN_FOCAL : MIN_FOCAL;
}

/** Width of a segment at distance t from its start, never below `minWidth`. */
export function segmentWidthAt(seg: Pick<RaySegment, 'width' | 'widthRate'>, t: number, minWidth: number): number {
  return Math.max(minWidth, Math.abs(seg.width + seg.widthRate * t));
}
