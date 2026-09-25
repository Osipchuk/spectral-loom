import * as THREE from 'three';
import { PULSES_PER_CHANNEL, type VisualPulse } from '../../timing/visual';

/**
 * Pulse schedule for the beam shader: one row per visual channel, one texel per pulse,
 * sorted by launch time. Texel = (launch time, hold, ±depth (negative = plateau), valid).
 */
export class PulseTexture {
  texture: THREE.DataTexture;
  private data: Float32Array;
  private rows: number;

  constructor(rows = 64) {
    this.rows = rows;
    this.data = new Float32Array(PULSES_PER_CHANNEL * rows * 4);
    this.texture = this.makeTexture();
  }

  private makeTexture(): THREE.DataTexture {
    const t = new THREE.DataTexture(this.data, PULSES_PER_CHANNEL, this.rows, THREE.RGBAFormat, THREE.FloatType);
    t.minFilter = THREE.NearestFilter;
    t.magFilter = THREE.NearestFilter;
    t.needsUpdate = true;
    return t;
  }

  /** Make sure there are at least `rows` rows; returns true if the texture object changed. */
  ensureRows(rows: number): boolean {
    if (rows <= this.rows) return false;
    this.rows = Math.max(rows, this.rows * 2);
    this.texture.dispose();
    this.data = new Float32Array(PULSES_PER_CHANNEL * this.rows * 4);
    this.texture = this.makeTexture();
    return true;
  }

  write(rows: VisualPulse[][]): void {
    this.data.fill(0);
    rows.forEach((pulses, r) => {
      if (r >= this.rows) return;
      pulses.forEach((p, i) => {
        const o = (r * PULSES_PER_CHANNEL + i) * 4;
        this.data[o] = p.time;
        this.data[o + 1] = p.hold;
        this.data[o + 2] = p.plateau ? -p.depth : p.depth;
        this.data[o + 3] = 1;
      });
    });
    this.texture.needsUpdate = true;
  }

  clear(): void {
    this.data.fill(0);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
