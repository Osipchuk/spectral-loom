import * as THREE from 'three';
import type { RayTree } from '../optics/types';
import { BEAM_HEIGHT, type TableFrame } from './frame';
import { lightToRGB } from './spectral-color';

function radialTexture(): THREE.CanvasTexture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.12, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

interface Spot {
  pos: THREE.Vector3;
  rgb: [number, number, number];
  energy: number;
  size: number;
}

/**
 * Soft glows where light lands: wall impacts, receptor slits, glass entry points and
 * lens foci (caustics). Rebuilt with the ray tree; brightness is per-frame uniform only.
 */
export class Glows {
  readonly group = new THREE.Group();
  private texture = radialTexture();
  private sprites: THREE.Sprite[] = [];
  private gain = 1;

  constructor(private frame: TableFrame) {}

  setTree(tree: RayTree): void {
    this.clear();
    const merged = new Map<string, Spot>();
    const add = (s: Spot): void => {
      // Merge co-located spots (a dispersed fan hitting a wall) into one coloured glow.
      const key = `${Math.round(s.pos.x * 3)}:${Math.round(s.pos.y * 3)}:${Math.round(s.pos.z * 3)}:${s.size}`;
      const prev = merged.get(key);
      if (!prev) {
        merged.set(key, { ...s, rgb: [s.rgb[0] * s.energy, s.rgb[1] * s.energy, s.rgb[2] * s.energy] });
        return;
      }
      prev.rgb = [prev.rgb[0] + s.rgb[0] * s.energy, prev.rgb[1] + s.rgb[1] * s.energy, prev.rgb[2] + s.rgb[2] * s.energy];
      prev.energy += s.energy;
    };

    for (const g of tree.segments) {
      const ev = g.endEvent;
      const rgb = lightToRGB(g.light);
      const end = this.frame.toWorld(g.end, BEAM_HEIGHT);
      if (ev.kind === 'bounds' || ev.kind === 'absorbed') {
        add({ pos: end, rgb, energy: g.intensity, size: 1.3 });
      } else if (ev.kind === 'receptor') {
        add({ pos: end, rgb, energy: g.intensity * 1.2, size: 1.0 });
      } else if (ev.kind === 'interact' && (ev.role === 'glass' || ev.role === 'lens') && g.intensity > 0.1) {
        add({ pos: end, rgb, energy: g.intensity * 0.25, size: 0.7 });
      }
    }
    for (const f of tree.foci) {
      const seg = tree.segments[f.segmentId]!;
      add({ pos: this.frame.toWorld(f.pos, BEAM_HEIGHT), rgb: lightToRGB(seg.light), energy: f.strength * 2.2, size: 1.6 });
    }

    for (const s of merged.values()) {
      if (s.energy < 0.01) continue;
      const k = 1 / Math.max(s.energy, 1e-6);
      const mat = new THREE.SpriteMaterial({
        map: this.texture,
        color: new THREE.Color(s.rgb[0] * k, s.rgb[1] * k, s.rgb[2] * k),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.position.copy(s.pos);
      const e = Math.min(s.energy, 2.5);
      sprite.scale.setScalar(s.size * (0.5 + Math.sqrt(e) * 0.8));
      sprite.userData.energy = e;
      sprite.renderOrder = 3;
      this.sprites.push(sprite);
      this.group.add(sprite);
    }
    this.applyGain();
  }

  setGain(gain: number): void {
    if (gain === this.gain) return;
    this.gain = gain;
    this.applyGain();
  }

  private applyGain(): void {
    for (const s of this.sprites) (s.material as THREE.SpriteMaterial).opacity = Math.min(1, (s.userData.energy as number) * 0.8) * this.gain;
  }

  private clear(): void {
    for (const s of this.sprites) {
      this.group.remove(s);
      s.material.dispose();
    }
    this.sprites = [];
  }

  dispose(): void {
    this.clear();
    this.texture.dispose();
  }
}
