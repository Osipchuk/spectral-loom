import type { SceneElement } from '../scene/types';
import { add, cross, dot, fromAngle, norm, perp, rotate, scale, sub, type Vec2 } from './vec2';

export type SurfaceRole = 'glass' | 'mirror' | 'lens' | 'filter' | 'absorb' | 'receptor' | 'loom' | 'comb' | 'chord';

export interface SegmentCollider {
  kind: 'seg';
  a: Vec2;
  b: Vec2;
  /** Unit normal; for glass it points out of the solid. */
  normal: Vec2;
  role: SurfaceRole;
  elementId: string;
  face: number;
}

export interface CircleCollider {
  kind: 'circle';
  c: Vec2;
  r: number;
  role: 'modulator';
  elementId: string;
  face: 0;
}

export type Collider = SegmentCollider | CircleCollider;

export const MODULATOR_RADIUS = 0.7;
export const EMITTER_HALF = { along: 0.9, across: 0.45 };

/** Counter-clockwise vertices of a prism's equilateral triangle; the apex points along `rotation`. */
export function prismVertices(pos: Vec2, rotation: number, size: number): Vec2[] {
  const r = size / Math.sqrt(3);
  return [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3].map((a) => add(pos, scale(fromAngle(rotation + a), r)));
}

/** Endpoints of a line-like element; it spans perpendicular to its facing direction. */
export function lineEndpoints(pos: Vec2, rotation: number, length: number): [Vec2, Vec2] {
  const t = perp(fromAngle(rotation));
  return [add(pos, scale(t, -length / 2)), add(pos, scale(t, length / 2))];
}

/** Emitter housing as a CCW rectangle whose front face sits at pos. */
export function emitterBox(pos: Vec2, rotation: number): Vec2[] {
  const { along, across } = EMITTER_HALF;
  const pts: Vec2[] = [
    { x: -2 * along, y: -across },
    { x: 0, y: -across },
    { x: 0, y: across },
    { x: -2 * along, y: across },
  ];
  return pts.map((p) => add(pos, rotate(p, rotation)));
}

function polygonColliders(pts: Vec2[], role: SurfaceRole, elementId: string): SegmentCollider[] {
  return pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length]!;
    const e = norm(sub(b, a));
    return { kind: 'seg', a, b, normal: { x: e.y, y: -e.x }, role, elementId, face: i };
  });
}

function lineCollider(pos: Vec2, rotation: number, length: number, role: SurfaceRole, elementId: string): SegmentCollider {
  const [a, b] = lineEndpoints(pos, rotation, length);
  return { kind: 'seg', a, b, normal: fromAngle(rotation), role, elementId, face: 0 };
}

export function elementColliders(el: SceneElement): Collider[] {
  // Disabled elements are optically transparent, except emitters (which just stop emitting).
  if (!el.enabled && el.kind !== 'emitter') return [];
  switch (el.kind) {
    case 'emitter':
      return polygonColliders(emitterBox(el.pos, el.rotation), 'absorb', el.id);
    case 'prism':
      return polygonColliders(prismVertices(el.pos, el.rotation, el.size), 'glass', el.id);
    case 'mirror':
      return [lineCollider(el.pos, el.rotation, el.length, 'mirror', el.id)];
    case 'lens':
      return [lineCollider(el.pos, el.rotation, el.aperture, 'lens', el.id)];
    case 'filter':
      return [lineCollider(el.pos, el.rotation, el.length, 'filter', el.id)];
    case 'receptor':
      return [lineCollider(el.pos, el.rotation, el.aperture, 'receptor', el.id)];
    case 'blocker':
      return [lineCollider(el.pos, el.rotation, el.length, 'absorb', el.id)];
    case 'loom':
      return [lineCollider(el.pos, el.rotation, el.length, 'loom', el.id)];
    case 'comb':
      return [lineCollider(el.pos, el.rotation, el.length, 'comb', el.id)];
    case 'chord':
      return [lineCollider(el.pos, el.rotation, el.length, 'chord', el.id)];
    case 'modulator':
      return [{ kind: 'circle', c: el.pos, r: MODULATOR_RADIUS, role: 'modulator', elementId: el.id, face: 0 }];
  }
}

export const RAY_EPS = 1e-6;

/** Ray/segment intersection: returns distance along the unit ray and the segment parameter u. */
export function intersectSegment(o: Vec2, d: Vec2, a: Vec2, b: Vec2): { t: number; u: number } | null {
  const e = sub(b, a);
  const denom = cross(d, e);
  if (Math.abs(denom) < 1e-12) return null;
  const ao = sub(a, o);
  const t = cross(ao, e) / denom;
  const u = cross(ao, d) / denom;
  if (t <= RAY_EPS || u < 0 || u > 1) return null;
  return { t, u };
}

/**
 * Modulators act at the ray's closest approach to their centre, so the pulse origin
 * does not depend on which side of the ring the beam enters.
 */
export function intersectModulator(o: Vec2, d: Vec2, c: Vec2, r: number): number | null {
  const t = dot(sub(c, o), d);
  if (t <= RAY_EPS) return null;
  const closest = add(o, scale(d, t));
  const off = sub(closest, c);
  return dot(off, off) <= r * r ? t : null;
}

/** Distance along a ray (starting inside the rectangle) to the table boundary. */
export function exitBounds(o: Vec2, d: Vec2, w: number, h: number): number {
  let t = Infinity;
  if (d.x > 0) t = Math.min(t, (w - o.x) / d.x);
  if (d.x < 0) t = Math.min(t, -o.x / d.x);
  if (d.y > 0) t = Math.min(t, (h - o.y) / d.y);
  if (d.y < 0) t = Math.min(t, -o.y / d.y);
  return Math.max(t, 0);
}
