import * as THREE from 'three';
import type { RaySegment, RayTree } from '../../optics/types';
import { lineDistance } from '../../optics/vec2';
import { lightToRGB } from '../spectral-color';
import { BEAM_HEIGHT, type TableFrame } from '../frame';

/** Reference width that maps intensity 1 to radiance 1. */
export const BASE_WIDTH = 0.16;
export const MIN_WIDTH = 0.05;

/**
 * Neighbour spacing of a dispersed ray at its start and end. Fan rays are drawn at least
 * this wide so that 24 discrete rays overlap into one continuous rainbow.
 */
function fanSpread(tree: RayTree): Map<number, [number, number]> {
  const key = (g: RaySegment, index: number): string => `${g.group!.id}:${index}:${g.pathKey}`;
  const lookup = new Map<string, RaySegment>();
  for (const g of tree.segments) if (g.group) lookup.set(key(g, g.group.index), g);

  const out = new Map<number, [number, number]>();
  for (const g of tree.segments) {
    if (!g.group) continue;
    let s0 = 0;
    let s1 = 0;
    let n = 0;
    for (const di of [-1, 1]) {
      const nb = lookup.get(key(g, g.group.index + di));
      if (!nb) continue;
      s0 += lineDistance(g.start, nb.start, nb.dir);
      s1 += lineDistance(g.end, nb.start, nb.dir);
      n += 1;
    }
    if (n > 0) out.set(g.id, [s0 / n, s1 / n]);
  }
  return out;
}

export interface BeamGeometryOptions {
  /** Maps a pulse source id to its row in the pulse texture (used from M3 on). */
  sourceIndex?: (id: string) => number;
}

/**
 * One camera-facing quad per ray segment. Everything the shader needs is baked into
 * attributes here, so per-frame updates are uniforms only.
 */
export function buildBeamGeometry(tree: RayTree, frame: TableFrame, opts: BeamGeometryOptions = {}): THREE.BufferGeometry {
  const spread = fanSpread(tree);
  const segs = tree.segments.filter((g) => g.length > 1e-4);
  const n = segs.length;

  const position = new Float32Array(n * 4 * 3);
  const dir = new Float32Array(n * 4 * 3);
  const corner = new Float32Array(n * 4 * 2);
  const width = new Float32Array(n * 4 * 4);
  const color = new Float32Array(n * 4 * 3);
  const params = new Float32Array(n * 4 * 4);
  const pulse = new Float32Array(n * 4 * 4);
  const index = new Uint32Array(n * 6);

  segs.forEach((g, i) => {
    const a = frame.toWorld(g.start, BEAM_HEIGHT);
    const b = frame.toWorld(g.end, BEAM_HEIGHT);
    const d = b.clone().sub(a).normalize();
    const [sp0, sp1] = spread.get(g.id) ?? [0, 0];
    const fanFill = 1.35;
    const wMax = Math.max(
      MIN_WIDTH,
      Math.abs(g.width),
      Math.abs(g.width + g.widthRate * g.length),
      sp0 * fanFill,
      sp1 * fanFill,
    );
    // Quad half-extent covers the soft halo, which is proportional to width plus a fixed glow.
    const extent = wMax * 2.6 + 0.3;
    const rgb = lightToRGB(g.light);
    const src = opts.sourceIndex ? opts.sourceIndex(g.pulseSourceId) : 0;

    for (let v = 0; v < 4; v++) {
      const k = i * 4 + v;
      const along = v < 2 ? 0 : 1;
      const side = v % 2 === 0 ? -1 : 1;
      const p = along === 0 ? a : b;
      position.set([p.x, p.y, p.z], k * 3);
      dir.set([d.x, d.y, d.z], k * 3);
      corner.set([along, side], k * 2);
      width.set([g.width, g.widthRate, sp0 * fanFill, sp1 * fanFill], k * 4);
      color.set(rgb, k * 3);
      params.set([g.intensity, g.length, extent, g.audible ? 1 : 0], k * 4);
      pulse.set([g.sStart, g.pulseOriginS, src, g.bounces], k * 4);
    }
    const o = i * 4;
    index.set([o, o + 1, o + 2, o + 2, o + 1, o + 3], i * 6);
  });

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geo.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
  geo.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
  geo.setAttribute('aWidth', new THREE.BufferAttribute(width, 4));
  geo.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
  geo.setAttribute('aParams', new THREE.BufferAttribute(params, 4));
  geo.setAttribute('aPulse', new THREE.BufferAttribute(pulse, 4));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  return geo;
}
