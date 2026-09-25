import type { Vec2 } from '../scene/types';

export type { Vec2 };

export const vec = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
export const madd = (a: Vec2, b: Vec2, k: number): Vec2 => ({ x: a.x + b.x * k, y: a.y + b.y * k });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const fromAngle = (a: number): Vec2 => ({ x: Math.cos(a), y: Math.sin(a) });
/** Counter-clockwise perpendicular. */
export const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });

export function norm(a: Vec2): Vec2 {
  const l = Math.hypot(a.x, a.y);
  return l > 0 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
}

export function rotate(a: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

/** Distance from point p to the infinite line through a with unit direction d. */
export function lineDistance(p: Vec2, a: Vec2, d: Vec2): number {
  return Math.abs(cross(sub(p, a), d));
}
