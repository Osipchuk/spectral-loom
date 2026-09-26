import { BEAT_PRESETS, composeBeat, composeMelody, MELODY_PRESETS } from '../music/compose';
import type { SceneStore } from '../scene/store';
import type { Loom, LoomNote, Subdivision } from '../scene/types';
import { SUBDIVISION_BEATS } from '../timing/sources';
import { readableRGB } from '../render/spectral-color';
import { h } from './dom';
import { helpIcon } from './panels';

/**
 * One row of the card. Engine 1: a pitch (or drum) that reaches a receptor through it, and
 * `deg` is that scale degree. Engine 2: a slot cut through the card, `deg` is the slot index
 * and `pitch` the degree of the colour falling through it now (none if it is dark).
 */
export interface LoomRow {
  deg: number;
  pitch?: number;
  label: string;
  rgb: [number, number, number];
}

export interface LoomRows {
  rows: LoomRow[];
  kit: boolean;
  /** False when no receptor hears this card yet (rows are then a generic guess). */
  connected: boolean;
  /** Engine 2: rows are slots, and the light decides what they play. */
  slots?: boolean;
}

const ROW_H = 17;
const CELL_W = 20;
const LABEL_W = 64;

const css = (rgb: [number, number, number], a = 1): string =>
  `rgba(${readableRGB(rgb).map((c) => Math.round(Math.min(1, c) * 255)).join(',')},${a})`;

/**
 * Piano-roll editor for a loom card. Click an empty cell to punch a note and drag right to
 * lengthen it; click a note to remove it. Rows are exactly the pitches the card's light
 * can reach, coloured like their rays, so what you punch is what you hear.
 */
export class LoomEditor {
  readonly el: HTMLElement;
  private loomId: string | null = null;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private scroller: HTMLElement;
  private hint: HTMLElement;
  private title: HTMLElement;
  private stepsSel: HTMLSelectElement;
  private subSel: HTMLSelectElement;
  private presetSel: HTMLSelectElement;
  private rows: LoomRows = { rows: [], kit: false, connected: false };
  private drag: { note: LoomNote; startStep: number } | null = null;
  private playStep = -1;
  private dpr = 1;

  private recutBtn: HTMLButtonElement;

  constructor(
    private store: SceneStore,
    private rowsFor: (loomId: string) => LoomRows,
    onRecut: (loomId: string) => void,
  ) {
    this.title = h('span.sl-le-title');
    this.stepsSel = h('select.sl-le-select', { 'aria-label': 'Steps' });
    for (const n of [8, 12, 16, 24, 32, 48, 64]) this.stepsSel.append(h('option', { value: n, text: `${n} steps` }));
    this.stepsSel.addEventListener('change', () =>
      this.update((l) => {
        l.steps = Number(this.stepsSel.value);
        l.notes = l.notes.filter((n) => n.at < l.steps).map((n) => ({ ...n, len: Math.min(n.len, l.steps - n.at) }));
      }),
    );
    this.subSel = h('select.sl-le-select', { 'aria-label': 'Step length' });
    for (const [v, t] of [
      ['1/4', 'quarter notes'],
      ['1/8', 'eighth notes'],
      ['1/16', 'sixteenths'],
    ]) {
      this.subSel.append(h('option', { value: v, text: t }));
    }
    this.subSel.addEventListener('change', () => this.update((l) => (l.subdivision = this.subSel.value as Subdivision)));
    this.presetSel = h('select.sl-le-select', { 'aria-label': 'Presets' });
    this.presetSel.addEventListener('change', () => {
      this.applyPreset(this.presetSel.value);
      this.presetSel.value = '';
    });
    const compose = h('button.sl-btn.sl-btn-primary', { type: 'button', text: 'Compose ✦', title: 'Write a new pattern for me' });
    compose.addEventListener('click', () => this.compose());
    this.recutBtn = h('button.sl-btn', {
      type: 'button',
      text: 'Cut to light',
      title: 'Freeze what you hear: cut the slots again around the colours crossing the card now, one colour per slot',
    });
    this.recutBtn.addEventListener('click', () => {
      if (this.loomId) onRecut(this.loomId);
    });
    const clear = h('button.sl-btn', { type: 'button', text: 'Clear' });
    clear.addEventListener('click', () => this.update((l) => (l.notes = [])));
    const close = h('button.sl-btn.sl-btn-quiet', { type: 'button', text: 'Done', 'aria-label': 'Close editor' });
    close.addEventListener('click', () => this.store.select(null));

    this.canvas = h('canvas.sl-le-canvas');
    this.ctx = this.canvas.getContext('2d')!;
    this.scroller = h('div.sl-le-scroll', {}, this.canvas);
    this.hint = h('p.sl-le-hint');
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    this.canvas.addEventListener('pointerup', (e) => this.up(e));
    this.canvas.addEventListener('pointercancel', () => (this.drag = null));

    this.el = h(
      'section.sl-panel.sl-loom-editor',
      { 'aria-label': 'Loom card editor', hidden: true },
      h(
        'header.sl-le-head',
        {},
        this.title,
        helpIcon(
          'This is the punched card. Columns are steps in time; rows are the colours (notes) whose light reaches a receptor through the card. A hole lets a swell through on that colour at that step, so that note plays. Steps and step length set how long the pattern is.',
        ),
        this.stepsSel,
        this.subSel,
        this.presetSel,
        compose,
        this.recutBtn,
        clear,
        close,
      ),
      this.scroller,
      this.hint,
    );
  }

  get openId(): string | null {
    return this.loomId;
  }

  private get loom(): Loom | null {
    const el = this.loomId ? this.store.get(this.loomId) : undefined;
    return el?.kind === 'loom' ? el : null;
  }

  open(id: string): void {
    this.loomId = id;
    this.el.hidden = false;
    this.refresh();
  }

  close(): void {
    this.loomId = null;
    this.el.hidden = true;
    this.drag = null;
  }

  /** Re-read the card and its rows (after optics changed, or the card was edited). */
  refresh(): void {
    const loom = this.loom;
    if (!loom) {
      if (this.loomId) this.close();
      return;
    }
    this.rows = this.rowsFor(loom.id);
    this.title.textContent = loom.title || 'Loom card';
    this.stepsSel.value = String(loom.steps);
    if (!this.stepsSel.value) {
      this.stepsSel.append(h('option', { value: loom.steps, text: `${loom.steps} steps` }));
      this.stepsSel.value = String(loom.steps);
    }
    this.subSel.value = loom.subdivision;
    this.presetSel.replaceChildren(h('option', { value: '', text: 'Presets…' }));
    for (const p of this.rows.kit ? BEAT_PRESETS : MELODY_PRESETS) this.presetSel.append(h('option', { value: p.id, text: p.label }));
    this.recutBtn.hidden = !this.rows.slots;
    this.hint.textContent = this.rows.slots
      ? 'Rows are slots cut through the card; each plays whatever colour falls through it now. Turn a prism or move the card and the same holes play other notes. Cut to light freezes what you hear: one colour per slot again.'
      : this.rows.connected
        ? `Click to punch a hole, drag right to hold it longer, click a hole to remove it. Rows are the ${this.rows.kit ? 'drums' : 'notes'} this card’s light can reach.`
        : 'No receptor hears this card yet: put a receptor in its light. Rows below are a guess until then.';
    this.draw();
  }

  /** Move the playhead; cheap, called every frame. */
  setBeat(beat: number | null): void {
    const loom = this.loom;
    if (!loom || this.el.hidden) return;
    const step = beat === null ? -1 : Math.floor(beat / SUBDIVISION_BEATS[loom.subdivision]) % loom.steps;
    if (step !== this.playStep) {
      this.playStep = step;
      this.draw();
    }
  }

  private update(fn: (l: Loom) => void): void {
    const loom = this.loom;
    if (!loom) return;
    this.store.updateElement(loom.id, (e) => {
      if (e.kind === 'loom') fn(e);
    });
    this.refresh();
  }

  /** Pitches the card can play now (scale degrees). */
  private available(): number[] {
    const out = new Set<number>();
    for (const r of this.rows.rows) {
      const p = this.rows.slots ? r.pitch : r.deg;
      if (p !== undefined) out.add(p);
    }
    return [...out];
  }

  /** Card rows for notes written in pitch space; notes with no row for their pitch are dropped. */
  private toRows(notes: LoomNote[]): LoomNote[] {
    if (!this.rows.slots) return notes;
    const rowOf = new Map<number, number>();
    for (const r of this.rows.rows) if (r.pitch !== undefined && !rowOf.has(r.pitch)) rowOf.set(r.pitch, r.deg);
    return notes.flatMap((n) => {
      const deg = rowOf.get(n.deg);
      return deg === undefined ? [] : [{ ...n, deg }];
    });
  }

  private applyPreset(id: string): void {
    const preset = (this.rows.kit ? BEAT_PRESETS : MELODY_PRESETS).find((p) => p.id === id);
    if (!preset) return;
    const avail = new Set(this.available());
    // Melodies: shift by whole octaves so as many notes as possible land on playable rows.
    let shift = 0;
    if (!this.rows.kit && avail.size > 0) {
      let best = -1;
      for (const s of [-14, -7, 0, 7, 14]) {
        const hits = preset.notes.filter((n) => avail.has(n.deg + s)).length;
        if (hits > best) {
          best = hits;
          shift = s;
        }
      }
    }
    this.update((l) => {
      l.steps = preset.steps;
      l.notes = this.toRows(preset.notes.map((n) => ({ ...n, deg: n.deg + shift })));
    });
  }

  private compose(): void {
    const loom = this.loom;
    if (!loom) return;
    const notes = this.rows.kit ? composeBeat(loom.steps) : composeMelody(loom.steps, this.available());
    this.update((l) => (l.notes = this.toRows(notes)));
  }

  // ---------------------------------------------------------------- drawing

  private rowIndex(deg: number): number {
    return this.rows.rows.findIndex((r) => r.deg === deg);
  }

  private draw(): void {
    const loom = this.loom;
    if (!loom) return;
    const rows = this.rows.rows;
    const w = LABEL_W + loom.steps * CELL_W;
    const hgt = Math.max(1, rows.length) * ROW_H;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.canvas.width !== Math.round(w * this.dpr) || this.canvas.height !== Math.round(hgt * this.dpr)) {
      this.canvas.width = Math.round(w * this.dpr);
      this.canvas.height = Math.round(hgt * this.dpr);
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${hgt}px`;
    }
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, w, hgt);
    const stepsPerBeat = 1 / SUBDIVISION_BEATS[loom.subdivision];

    // Rows are drawn top = highest pitch.
    rows.forEach((row, i) => {
      const y = (rows.length - 1 - i) * ROW_H;
      c.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.045)';
      c.fillRect(LABEL_W, y, loom.steps * CELL_W, ROW_H);
      c.fillStyle = css(row.rgb, 0.95);
      c.fillRect(4, y + 4, 8, ROW_H - 8);
      c.strokeStyle = 'rgba(255,255,255,0.5)';
      c.lineWidth = 1;
      c.strokeRect(4.5, y + 4.5, 7, ROW_H - 9);
      c.fillStyle = '#c9cedb';
      c.font = '500 10px ui-monospace, "JetBrains Mono", Menlo, monospace';
      c.textBaseline = 'middle';
      c.fillText(row.label, 16, y + ROW_H / 2 + 0.5);
    });
    for (let s = 0; s <= loom.steps; s++) {
      const x = LABEL_W + s * CELL_W;
      const bar = s % (stepsPerBeat * 4) === 0;
      c.fillStyle = bar ? 'rgba(255,255,255,0.22)' : s % stepsPerBeat === 0 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)';
      c.fillRect(x, 0, 1, hgt);
    }
    if (this.playStep >= 0) {
      c.fillStyle = 'rgba(200,220,255,0.12)';
      c.fillRect(LABEL_W + this.playStep * CELL_W, 0, CELL_W, hgt);
    }
    for (const n of loom.notes) {
      const i = this.rowIndex(n.deg);
      if (i < 0) continue;
      const row = rows[i]!;
      const y = (rows.length - 1 - i) * ROW_H;
      const x = LABEL_W + n.at * CELL_W;
      const active = this.playStep >= n.at && this.playStep < n.at + n.len;
      c.fillStyle = css(row.rgb, active ? 1 : 0.85);
      roundRect(c, x + 2, y + 2, n.len * CELL_W - 4, ROW_H - 4, 4);
      c.fill();
      // Always framed, so even the deepest red and violet notes stand out from the grid.
      c.strokeStyle = active ? '#ffffff' : 'rgba(255,255,255,0.6)';
      c.lineWidth = active ? 2 : 1;
      c.stroke();
    }
  }

  // ---------------------------------------------------------------- pointer

  private cellAt(e: PointerEvent): { step: number; deg: number } | null {
    const loom = this.loom;
    if (!loom) return null;
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left - LABEL_W;
    const y = e.clientY - r.top;
    const rows = this.rows.rows;
    if (x < 0 || y < 0 || rows.length === 0) return null;
    const step = Math.floor(x / CELL_W);
    const i = rows.length - 1 - Math.floor(y / ROW_H);
    if (step >= loom.steps || i < 0 || i >= rows.length) return null;
    return { step, deg: rows[i]!.deg };
  }

  private down(e: PointerEvent): void {
    const loom = this.loom;
    const cell = this.cellAt(e);
    if (!loom || !cell) return;
    e.preventDefault();
    const hit = loom.notes.find((n) => n.deg === cell.deg && cell.step >= n.at && cell.step < n.at + n.len);
    if (hit) {
      this.update((l) => (l.notes = l.notes.filter((n) => n !== l.notes.find((m) => m.deg === hit.deg && m.at === hit.at))));
      return;
    }
    this.canvas.setPointerCapture(e.pointerId);
    const note = { at: cell.step, deg: cell.deg, len: 1 };
    this.drag = { note, startStep: cell.step };
    this.update((l) => l.notes.push(note));
  }

  private move(e: PointerEvent): void {
    const loom = this.loom;
    if (!this.drag || !loom) return;
    const r = this.canvas.getBoundingClientRect();
    const step = Math.floor((e.clientX - r.left - LABEL_W) / CELL_W);
    const { note, startStep } = this.drag;
    // Stop at the next note in the same row.
    const next = Math.min(loom.steps, ...loom.notes.filter((n) => n.deg === note.deg && n.at > startStep).map((n) => n.at));
    const len = Math.max(1, Math.min(next - startStep, step - startStep + 1));
    if (len === note.len) return;
    this.update((l) => {
      const n = l.notes.find((m) => m.deg === note.deg && m.at === startStep);
      if (n) n.len = len;
    });
    note.len = len;
  }

  private up(e: PointerEvent): void {
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    this.drag = null;
  }
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, hh: number, r: number): void {
  const rr = Math.min(r, w / 2, hh / 2);
  c.beginPath();
  c.moveTo(x + rr, y);
  c.arcTo(x + w, y, x + w, y + hh, rr);
  c.arcTo(x + w, y + hh, x, y + hh, rr);
  c.arcTo(x, y + hh, x, y, rr);
  c.arcTo(x, y, x + w, y, rr);
  c.closePath();
}
