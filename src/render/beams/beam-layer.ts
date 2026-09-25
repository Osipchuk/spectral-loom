import * as THREE from 'three';
import type { RayTree } from '../../optics/types';
import type { TableFrame } from '../frame';
import { buildBeamGeometry, type BeamGeometryOptions } from './beam-geometry';
import { createBeamMaterial, createSharedUniforms } from './beam-material';

interface BeamSet {
  beam: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  spill: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  /** Fade: gain goes from `from` to `to` over [t0, t0 + duration] (wall-clock seconds). */
  fade: { from: number; to: number; t0: number; duration: number };
}

const TOGGLE_FADE = 0.22;

/**
 * Owns beam meshes. A normal scene change swaps geometry instantly (dragging must feel
 * immediate); a toggle cross-fades the old and new light over ~200 ms so nothing snaps.
 */
export class BeamLayer {
  readonly group = new THREE.Group();
  private current: BeamSet | null = null;
  private fading: BeamSet[] = [];
  /** Clock and pulse uniforms shared by every beam material (live and fading). */
  readonly shared = createSharedUniforms();

  constructor(private frame: TableFrame) {}

  setTree(tree: RayTree, now: number, crossfade: boolean, opts: BeamGeometryOptions = {}): void {
    const geo = buildBeamGeometry(tree, this.frame, opts);
    if (this.current && !crossfade) {
      this.current.beam.geometry.dispose();
      this.current.beam.geometry = geo;
      this.current.spill.geometry = geo;
      return;
    }
    if (this.current) {
      const g = this.gain(this.current, now);
      this.current.fade = { from: g, to: 0, t0: now, duration: TOGGLE_FADE };
      this.fading.push(this.current);
    }
    const beam = new THREE.Mesh(geo, createBeamMaterial('beam', this.shared));
    const spill = new THREE.Mesh(geo, createBeamMaterial('spill', this.shared));
    for (const m of [beam, spill]) {
      m.frustumCulled = false;
      this.group.add(m);
    }
    spill.renderOrder = 1;
    beam.renderOrder = 2;
    this.current = { beam, spill, fade: crossfade ? { from: 0, to: 1, t0: now, duration: TOGGLE_FADE } : { from: 1, to: 1, t0: now, duration: 0 } };
  }

  /** Shared uniforms, applied to every live material. */
  forEachMaterial(fn: (m: THREE.ShaderMaterial) => void): void {
    for (const set of [this.current, ...this.fading]) {
      if (!set) continue;
      fn(set.beam.material);
      fn(set.spill.material);
    }
  }

  update(time: number, now: number): void {
    this.fading = this.fading.filter((set) => {
      if (now - set.fade.t0 >= set.fade.duration) {
        this.disposeSet(set);
        return false;
      }
      return true;
    });
    for (const set of [this.current, ...this.fading]) {
      if (!set) continue;
      const gain = this.gain(set, now);
      for (const m of [set.beam.material, set.spill.material]) {
        m.uniforms.uTime!.value = time;
        m.uniforms.uGain!.value = gain;
      }
    }
  }

  private gain(set: BeamSet, now: number): number {
    const { from, to, t0, duration } = set.fade;
    if (duration <= 0) return to;
    const t = Math.min(1, Math.max(0, (now - t0) / duration));
    const e = t * t * (3 - 2 * t);
    return from + (to - from) * e;
  }

  private disposeSet(set: BeamSet): void {
    this.group.remove(set.beam, set.spill);
    set.beam.geometry.dispose();
    set.beam.material.dispose();
    set.spill.material.dispose();
  }

  dispose(): void {
    for (const set of [this.current, ...this.fading]) if (set) this.disposeSet(set);
    this.current = null;
    this.fading = [];
  }
}
