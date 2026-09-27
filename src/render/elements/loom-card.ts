import * as THREE from 'three';
import type { Loom } from '../../scene/types';
import { cardStepAt } from '../../timing/sources';
import { BEAM_HEIGHT } from '../frame';

export const CARD_BOTTOM = 0.08;
export const CARD_HEIGHT = 1.0;
const PX_PER_UNIT = 96;
const ROWS_VISIBLE_ABOVE = 5;

export interface CardSurface {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  alpha: THREE.CanvasTexture;
  alphaCanvas: HTMLCanvasElement;
  alphaCtx: CanvasRenderingContext2D;
  /** What was drawn last, so an unchanged card (a paused song) is not redrawn every frame. */
  key: string;
}

export function createCardSurface(length: number): CardSurface {
  const make = (): [HTMLCanvasElement, CanvasRenderingContext2D] => {
    const c = document.createElement('canvas');
    c.width = Math.max(64, Math.round(length * PX_PER_UNIT));
    c.height = Math.round(CARD_HEIGHT * PX_PER_UNIT);
    return [c, c.getContext('2d')!];
  };
  const [canvas, ctx] = make();
  const [alphaCanvas, alphaCtx] = make();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const alpha = new THREE.CanvasTexture(alphaCanvas);
  return { canvas, ctx, texture, alpha, alphaCanvas, alphaCtx, key: '' };
}

/**
 * Draw the punched card like a player-piano roll: time runs downward through the beam
 * line. Holes are placed where the ray of that pitch crosses the card (`degreeU`, −0.5…0.5
 * along the card), so you can see which colour each hole lets through. Cut cards pass
 * their slots: `degreeU` then maps each slot to its centre and `rowWidth` to its width.
 */
export function drawCard(surface: CardSurface, loom: Loom, degreeU: Map<number, number>, beat: number, rowWidth?: Map<number, number>): void {
  const { canvas, ctx, alphaCtx } = surface;
  const W = canvas.width;
  const H = canvas.height;
  const step = cardStepAt(loom, beat);
  const key = cardKey(loom, degreeU, step, rowWidth);
  if (key === surface.key) return;
  surface.key = key;
  const beamY = H - ((BEAM_HEIGHT - CARD_BOTTOM) / CARD_HEIGHT) * H;
  const rowH = beamY / ROWS_VISIBLE_ABOVE;

  ctx.fillStyle = '#d9cfb8';
  ctx.fillRect(0, 0, W, H);
  // Paper fibre: a few faint horizontal streaks, deterministic.
  ctx.fillStyle = 'rgba(120,100,70,0.07)';
  for (let i = 0; i < 40; i++) ctx.fillRect(0, (i * 37) % H, W, 1);
  alphaCtx.fillStyle = '#d0d0d0';
  alphaCtx.fillRect(0, 0, W, H);

  // Beam line and faint degree guides.
  ctx.fillStyle = 'rgba(80,60,30,0.35)';
  ctx.fillRect(0, beamY - 0.5, W, 1);
  ctx.fillStyle = 'rgba(80,60,30,0.08)';
  for (const u of degreeU.values()) ctx.fillRect((u + 0.5) * W - 0.5, 0, 1, H);

  const holeW = Math.max(6, Math.min(18, (W / Math.max(4, degreeU.size)) * 0.6));
  for (let loop = -1; loop <= 1; loop++) {
    for (const n of loom.notes) {
      const u = degreeU.get(n.deg);
      if (u === undefined) continue;
      const start = n.at + loop * loom.steps - step;
      const end = start + n.len;
      // Row 0 sits on the beam; upcoming notes are above it and move down.
      const y0 = beamY - end * rowH;
      const y1 = beamY - start * rowH;
      if (y1 < -rowH || y0 > H + rowH) continue;
      const slotW = rowWidth?.get(n.deg);
      const hw = slotW === undefined ? holeW : Math.max(4, slotW * W - 3);
      const x = (u + 0.5) * W - hw / 2;
      const active = start <= 0 && end > 0;
      const r = Math.min(hw, holeW) / 2;
      const hy = y0 + 2;
      const hh = Math.max(2, y1 - y0 - 4);
      ctx.fillStyle = active ? '#2a1c08' : '#3a2d18';
      roundRect(ctx, x, hy, hw, hh, r);
      ctx.fill();
      alphaCtx.fillStyle = active ? '#000000' : '#303030';
      roundRect(alphaCtx, x, hy, hw, hh, r);
      alphaCtx.fill();
    }
  }
  surface.texture.needsUpdate = true;
  surface.alpha.needsUpdate = true;
}

function cardKey(loom: Loom, degreeU: Map<number, number>, step: number, rowWidth?: Map<number, number>): string {
  let k = `${step}|${loom.steps}|`;
  for (const n of loom.notes) k += `${n.deg},${n.at},${n.len};`;
  k += '|';
  for (const [d, u] of degreeU) k += `${d}:${u};`;
  k += '|';
  if (rowWidth) for (const [d, w] of rowWidth) k += `${d}:${w};`;
  return k;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
