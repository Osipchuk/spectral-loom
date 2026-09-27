import { GLASS, METAL, Sfx, WOOD } from '../audio/sfx';
import { degreeToMidi, midiToFrequency } from '../music/pitch';
import type { SceneStore } from '../scene/store';
import type { ElementKind, SceneElement, SceneModel } from '../scene/types';

/** One element as the director last saw it. */
interface Seen {
  kind: ElementKind;
  x: number;
  y: number;
  rotation: number;
  enabled: boolean;
  /** Everything else, to tell a parameter edit from a move. */
  params: string;
}

/** A detent every this many degrees while turning: each one plays the next step of the scale. */
const DETENT_DEG = 15;
/** Moving plays a tick per grid cell crossed, at most this often (seconds). */
const MOVE_GAP_S = 0.045;

/**
 * Turns what happens on the table into interface sounds, all tuned to the table's own scale
 * and key: dragging ticks cell by cell (pitch rises left to right), turning glass steps up a
 * music box scale at every detent, dropping clinks in the voice of the element (glass, metal,
 * wood, paper), switching on glides up, deleting whooshes away. It watches the store, so it
 * hears every change however it was made (mouse, keys, panel, tutorial).
 */
export class SfxDirector {
  private seen = new Map<string, Seen>();
  private selected: string | null = null;
  private lastMove = 0;
  private lastUi = 0;
  private unsubscribe: () => void;

  constructor(
    private store: SceneStore,
    readonly sfx: Sfx,
  ) {
    this.snapshot();
    this.unsubscribe = store.subscribe((kinds) => {
      if (kinds.has('load')) {
        this.snapshot();
        if (kinds.has('restore')) this.rewind();
        else this.sceneChord();
        return;
      }
      if (kinds.has('drop')) this.drop();
      if (kinds.has('geometry') || kinds.has('toggle')) this.diff();
      if (kinds.has('selection')) this.selection();
    });
  }

  dispose(): void {
    this.unsubscribe();
  }

  private get scene(): SceneModel {
    return this.store.scene;
  }

  /** Frequency of scale degree `deg` of the table's key, from `octave`. */
  private note(deg: number, octave = 5): number {
    const s = this.scene.settings;
    return midiToFrequency(degreeToMidi(Math.round(deg), { scale: s.scale, root: s.root, octave, span: 1 }));
  }

  private pan(el: { pos: { x: number } }): number {
    return ((el.pos.x / this.scene.table.w) * 2 - 1) * 0.7;
  }

  private snapshot(): void {
    this.seen.clear();
    for (const el of this.scene.elements) this.seen.set(el.id, see(el));
    this.selected = this.store.selectedId;
  }

  private diff(): void {
    const now = performance.now() / 1000;
    const before = this.seen;
    this.seen = new Map();
    for (const el of this.scene.elements) {
      const cur = see(el);
      this.seen.set(el.id, cur);
      const old = before.get(el.id);
      if (!old) {
        this.appear(el);
        continue;
      }
      if (old.enabled !== cur.enabled) this.toggle(el);
      if (old.rotation !== cur.rotation) this.turn(el, old.rotation, cur.rotation);
      const cellOld = `${Math.round(old.x)}:${Math.round(old.y)}`;
      const cellNew = `${Math.round(cur.x)}:${Math.round(cur.y)}`;
      if (cellOld !== cellNew && now - this.lastMove > MOVE_GAP_S) {
        this.lastMove = now;
        this.tick(el);
      }
      // Panel edits sound through the panel's own click; a slider ticks as it moves.
      if (old.params !== cur.params && now - this.lastUi > 0.12 && now - this.lastMove > MOVE_GAP_S) {
        this.lastMove = now;
        this.sfx.bell(this.note(4 + Math.random() * 3, 5), { partials: GLASS, decay: 0.12, gain: 0.05, pan: this.pan(el) });
      }
    }
    for (const [id, old] of before) if (!this.seen.has(id)) this.vanish(old);
  }

  // ------------------------------------------------------------------ the sounds

  /** A new element fades in with a small rising shimmer. */
  private appear(el: SceneElement): void {
    const p = this.pan(el);
    [0, 2, 4].forEach((d, i) => this.sfx.bell(this.note(d, 5), { decay: 0.35, gain: 0.07, pan: p, delay: i * 0.045 }));
  }

  /** Put down: the element's own material. */
  private drop(): void {
    const el = this.store.selected;
    if (!el) return;
    const p = this.pan(el);
    const deg = Math.round((el.pos.x / this.scene.table.w) * 9);
    switch (el.kind) {
      case 'mirror':
      case 'modulator':
        this.sfx.bell(this.note(deg, 5), { partials: METAL, decay: 0.7, gain: 0.13, pan: p });
        break;
      case 'receptor':
      case 'blocker':
        this.sfx.bell(this.note(deg, 3), { partials: WOOD, decay: 0.22, gain: 0.22, pan: p, type: 'triangle' });
        this.sfx.noise({ dur: 0.05, freq: 900, q: 2, gain: 0.08, pan: p });
        break;
      case 'loom':
        this.sfx.noise({ dur: 0.09, freq: 2600, freqTo: 1200, q: 0.8, gain: 0.1, pan: p });
        this.sfx.bell(this.note(deg, 4), { partials: WOOD, decay: 0.15, gain: 0.1, pan: p, type: 'triangle' });
        break;
      case 'emitter':
        this.sfx.bell(this.note(deg, 4), { partials: METAL, decay: 0.3, gain: 0.1, pan: p });
        break;
      default:
        // Glass: prism, lens, filter, comb, chord glass.
        this.sfx.bell(this.note(deg, 5), { partials: GLASS, decay: 0.9, gain: 0.16, pan: p });
        this.sfx.bell(this.note(deg + 2, 6), { partials: GLASS, decay: 0.5, gain: 0.05, pan: p, delay: 0.03 });
    }
  }

  /** A soft tick per grid cell while dragging; pitch climbs from left to right. */
  private tick(el: SceneElement): void {
    const deg = Math.round((el.pos.x / this.scene.table.w) * 14);
    this.sfx.bell(this.note(deg, 5), { partials: [[1, 1]], decay: 0.06, gain: 0.05, pan: this.pan(el), type: 'triangle' });
  }

  /** Turning: every detent passed plays the next note of the scale, like a music box. */
  private turn(el: SceneElement, from: number, to: number): void {
    const a = Math.floor(((from * 180) / Math.PI) / DETENT_DEG);
    const b = Math.floor(((to * 180) / Math.PI) / DETENT_DEG);
    if (a === b) return;
    const steps = Math.min(4, Math.abs(b - a));
    const dir = Math.sign(b - a);
    for (let i = 1; i <= steps; i++) {
      const detent = a + dir * i;
      const deg = ((detent % 10) + 10) % 10;
      this.sfx.bell(this.note(deg, 5), { partials: METAL, decay: 0.25, gain: 0.07, pan: this.pan(el), delay: (i - 1) * 0.03 });
    }
  }

  private toggle(el: SceneElement): void {
    const p = this.pan(el);
    if (el.enabled) {
      this.sfx.glide(this.note(0, 4), this.note(4, 5), 0.18, 0.09, p);
      this.sfx.bell(this.note(4, 5), { decay: 0.5, gain: 0.08, pan: p, delay: 0.16 });
    } else {
      this.sfx.glide(this.note(4, 5), this.note(0, 3), 0.22, 0.08, p);
    }
  }

  private vanish(old: Seen): void {
    const p = ((old.x / this.scene.table.w) * 2 - 1) * 0.7;
    this.sfx.noise({ dur: 0.32, freq: 3200, freqTo: 300, q: 0.9, gain: 0.12, pan: p });
    this.sfx.bell(this.note(0, 3), { partials: WOOD, decay: 0.25, gain: 0.1, pan: p, type: 'triangle', delay: 0.05 });
  }

  private selection(): void {
    const id = this.store.selectedId;
    const was = this.selected;
    this.selected = id;
    // A new element selects itself; its shimmer is enough.
    if (!id || id === was || !this.seen.has(id)) return;
    const el = this.store.get(id);
    if (!el) return;
    this.sfx.bell(this.note(4, 6), { partials: [[1, 1]], decay: 0.09, gain: 0.05, pan: this.pan(el) });
  }

  /** Undo or redo: a quick falling tick. */
  private rewind(): void {
    this.sfx.bell(this.note(4, 5), { partials: METAL, decay: 0.12, gain: 0.06 });
    this.sfx.bell(this.note(2, 5), { partials: METAL, decay: 0.16, gain: 0.05, delay: 0.05 });
  }

  /** A new scene opens with a soft arpeggio in its own key. */
  private sceneChord(): void {
    [0, 2, 4, 7].forEach((d, i) => this.sfx.bell(this.note(d, 4), { decay: 1.2, gain: 0.06, delay: i * 0.07, pan: (i - 1.5) * 0.25 }));
  }

  // ------------------------------------------------------------------ interface (outside the table)

  /** Buttons, pickers and toggles in the panels. */
  uiClick(): void {
    this.lastUi = performance.now() / 1000;
    this.sfx.noise({ dur: 0.025, freq: 3400, q: 3, gain: 0.07 });
    this.sfx.bell(this.note(7, 5), { partials: [[1, 1]], decay: 0.05, gain: 0.03 });
  }

  /** A slider moving: a tick whose pitch follows its value. */
  uiSlide(frac: number): void {
    const now = performance.now() / 1000;
    if (now - this.lastMove < MOVE_GAP_S) return;
    this.lastMove = now;
    this.lastUi = now;
    this.sfx.bell(this.note(Math.round(frac * 10), 5), { partials: [[1, 1]], decay: 0.05, gain: 0.04, type: 'triangle' });
  }

  /** A tutorial step done. */
  success(): void {
    [0, 2, 4, 7].forEach((d, i) => this.sfx.bell(this.note(d, 5), { decay: 0.9, gain: 0.08, delay: i * 0.08 }));
  }
}

function see(el: SceneElement): Seen {
  const { id: _id, pos, rotation, enabled, kind, ...rest } = el;
  return { kind, x: pos.x, y: pos.y, rotation, enabled, params: JSON.stringify(rest) };
}
