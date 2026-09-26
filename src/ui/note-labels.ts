import * as THREE from 'three';
import { ENVELOPES, envelopeAt } from '../audio/instruments';
import type { ScheduledNote } from '../audio/engine';
import { NOTE_NAMES } from '../music/scales';
import type { Vec2 } from '../scene/types';
import { readableRGB } from '../render/spectral-color';
import { h } from './dom';

export interface NoteLabel {
  receptorId: string;
  midi: number;
  /** What to print: a note name, or a drum for drum receptors. */
  text: string;
  /** Table position where this pitch's light lands. */
  at: Vec2;
  /** Direction pointing out of the receptor's back, to place the label behind it. */
  back: Vec2;
  rgb: [number, number, number];
}

export function midiName(midi: number): string {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

/**
 * Crisp DOM labels naming the pitch each colour plays, placed just behind receptors and
 * lit by the note's own envelope. Makes "colour is pitch" readable at a glance.
 */
export class NoteLabels {
  readonly el = h('div.sl-notes', { 'aria-hidden': 'true' });
  private items: { label: NoteLabel; node: HTMLElement; world: THREE.Vector3 }[] = [];
  private v = new THREE.Vector3();

  set(labels: NoteLabel[], toWorld: (p: Vec2, y: number) => THREE.Vector3): void {
    this.el.replaceChildren();
    this.items = labels.map((label) => {
      const node = h('span.sl-note', { text: label.text });
      const [r, g, b] = readableRGB(label.rgb, 0.1).map((c) => Math.round(Math.min(1, c) * 255));
      node.style.setProperty('--c', `rgb(${r},${g},${b})`);
      this.el.append(node);
      const p = { x: label.at.x + label.back.x * 1.1, y: label.at.y + label.back.y * 1.1 };
      return { label, node, world: toWorld(p, 0.95) };
    });
  }

  update(camera: THREE.Camera, width: number, height: number, notes: readonly ScheduledNote[], heard: number): void {
    if (this.items.length === 0) return;
    const level = new Map<string, number>();
    for (const n of notes) {
      const v = envelopeAt(ENVELOPES[n.instrument], n.holdS, heard - n.time);
      if (v <= 0.01) continue;
      const key = `${n.receptorId}|${n.midi}`;
      level.set(key, Math.max(level.get(key) ?? 0, v));
    }
    const placed: { x: number; y: number }[] = [];
    // Sounding notes claim their spot first; idle labels fill in where there is room.
    const order = [...this.items].sort(
      (a, b) => (level.get(`${b.label.receptorId}|${b.label.midi}`) ?? 0) - (level.get(`${a.label.receptorId}|${a.label.midi}`) ?? 0),
    );
    for (const it of order) {
      this.v.copy(it.world).project(camera);
      const x = (this.v.x * 0.5 + 0.5) * width;
      const y = (-this.v.y * 0.5 + 0.5) * height;
      const lv = level.get(`${it.label.receptorId}|${it.label.midi}`) ?? 0;
      const crowded = placed.some((p) => Math.abs(p.x - x) < 30 && Math.abs(p.y - y) < 15);
      const visible = !crowded;
      if (visible) placed.push({ x, y });
      const s = it.node.style;
      s.opacity = visible ? String(0.35 + 0.65 * Math.min(1, lv * 1.4)) : '0';
      s.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) scale(${(1 + 0.25 * lv).toFixed(3)})`;
      s.boxShadow = lv > 0.02 ? `0 0 ${(6 + 16 * lv).toFixed(0)}px var(--c)` : 'none';
      s.borderColor = lv > 0.02 ? 'var(--c)' : '';
      s.color = lv > 0.3 ? '#fff' : '';
    }
  }
}
