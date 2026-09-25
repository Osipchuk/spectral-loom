import * as THREE from 'three';
import type { Vec2 } from '../scene/types';

/** Height of the beam plane above the tabletop, world units. */
export const BEAM_HEIGHT = 0.42;

/**
 * Table coordinates (grid units, origin at a corner) ↔ world coordinates (origin at the
 * table centre, y up). Table +y maps to world +z, so a table angle θ is a world
 * rotation of −θ around Y.
 */
export class TableFrame {
  constructor(
    public w: number,
    public h: number,
  ) {}

  toWorld(p: Vec2, y = 0, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(p.x - this.w / 2, y, p.y - this.h / 2);
  }

  toTable(v: THREE.Vector3): Vec2 {
    return { x: v.x + this.w / 2, y: v.z + this.h / 2 };
  }
}

export function yawFor(rotation: number): number {
  return -rotation;
}
