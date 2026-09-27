import * as THREE from 'three';
import { bandToRGB, type RGB } from '../spectral-color';

const PX_PER_UNIT = 64;
const HEIGHT_PX = 64;

export interface GlassSurface {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  /** What was drawn last, so an unchanged chord is not re-uploaded every frame. */
  key: string;
}

/** Where one colour (one note) crosses a chord glass: −0.5…0.5 along it. */
export interface GlassMark {
  degree: number;
  lo: number;
  hi: number;
  rgb: RGB;
}

export function createGlassSurface(length: number): GlassSurface {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(128, Math.round(length * PX_PER_UNIT));
  canvas.height = HEIGHT_PX;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const surface = { canvas, ctx: canvas.getContext('2d')!, texture, key: '' };
  drawChordGlass(surface, [], null);
  return surface;
}

const css = (rgb: RGB, k: number): string => {
  const max = Math.max(rgb[0], rgb[1], rgb[2], 1e-3);
  return `rgb(${[0, 1, 2].map((i) => Math.round(Math.min(255, (rgb[i]! / max) * k))).join(',')})`;
};

/**
 * Stained glass that shows its chord. Where no light crosses it yet: plain rainbow panes.
 * Once light does, each colour crossing it gets its own pane where it crosses: panes of the
 * current chord's notes glow in their colour (that light passes and plays), the others are
 * smoked dark. `chord` null = not playing: every pane shown, half lit.
 */
export function drawChordGlass(surface: GlassSurface, marks: GlassMark[], chord: ReadonlySet<number> | null): void {
  const key = `${chord ? [...chord].join(',') : '-'}|${marks.map((m) => `${m.degree}:${m.lo.toFixed(3)}:${m.hi.toFixed(3)}`).join(' ')}`;
  if (key === surface.key) return;
  surface.key = key;
  const { canvas, ctx } = surface;
  const W = canvas.width;
  const H = canvas.height;
  const lead = '#1a1510';

  if (marks.length === 0) {
    const panes = 7;
    for (let i = 0; i < panes; i++) {
      ctx.fillStyle = css(bandToRGB(700 - (300 * (i + 1)) / panes, 700 - (300 * i) / panes), 150);
      ctx.fillRect((i * W) / panes, 0, W / panes, H);
    }
    ctx.fillStyle = lead;
    for (let i = 0; i <= panes; i++) ctx.fillRect((i * W) / panes - 2, 0, 4, H);
  } else {
    ctx.fillStyle = 'rgb(28,24,20)';
    ctx.fillRect(0, 0, W, H);
    const sorted = [...marks].sort((a, b) => a.lo - b.lo);
    // Panes meet halfway between neighbouring colours; the outer ones reach a little past their light.
    const edges = sorted.map((m, i) => {
      const next = sorted[i + 1];
      return next ? (m.hi + next.lo) / 2 : null;
    });
    sorted.forEach((m, i) => {
      const pad = 0.03;
      const u0 = i === 0 ? m.lo - pad : edges[i - 1]!;
      const u1 = edges[i] ?? m.hi + pad;
      const x0 = Math.max(0, (u0 + 0.5) * W);
      const x1 = Math.min(W, (u1 + 0.5) * W);
      const on = chord === null ? null : chord.has(m.degree);
      ctx.fillStyle = on === null ? css(m.rgb, 130) : on ? css(m.rgb, 255) : css(m.rgb, 38);
      ctx.fillRect(x0, 0, x1 - x0, H);
      if (on) {
        // A bright core where the light actually passes.
        const cx = ((m.lo + m.hi) / 2 + 0.5) * W;
        const g = ctx.createLinearGradient(x0, 0, x1, 0);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(Math.min(1, Math.max(0, (cx - x0) / Math.max(1, x1 - x0))), 'rgba(255,255,255,0.55)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x0, 0, x1 - x0, H);
      }
      ctx.fillStyle = lead;
      ctx.fillRect(x1 - 1.5, 0, 3, H);
    });
  }
  ctx.fillStyle = lead;
  ctx.fillRect(0, 0, W, 4);
  ctx.fillRect(0, H - 4, W, 4);
  surface.texture.needsUpdate = true;
}
