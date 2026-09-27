import type { DemoScene } from '../scene/demos';
import { h, svgIcon } from './dom';

const PLAY = '<path d="M7 5l12 7-12 7z" fill="currentColor" stroke="none"/>';
const PAUSE = '<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>';
const SAVE = '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>';
const LOAD = '<path d="M12 20V9M7 13l5-5 5 5M5 4h14"/>';
const RECORD = '<circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"/>';
const NEW = '<rect x="5" y="4" width="14" height="16" rx="2"/><path d="M12 9v6M9 12h6"/>';
const UNDO = '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-4"/>';
const REDO = '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 000 10h4"/>';
const SPARKLE = '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.2 2.2M15.5 15.5l2.2 2.2M6.3 17.7l2.2-2.2M15.5 8.5l2.2-2.2"/>';
const VOLUME = '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12"/>';

export interface TransportCallbacks {
  onPlayToggle(): void;
  onDemo(id: string): void;
  onSave(): void;
  onLoad(file: File): void;
  onRecord(): void;
  onVolume(db: number): void;
  onQuality(q: 'eco' | 'balanced' | 'high'): void;
  /** Interface sounds (clicks and chimes when handling things) on or off. */
  onUiSounds(on: boolean): void;
  /** Simple mode: just the table on a plain grey background. Lighter on the computer. */
  onSimple(on: boolean): void;
  onNewCanvas(): void;
  onUndo(): void;
  onRedo(): void;
  /** Put the open demo back as it was written. */
  onRestore(): void;
  /** Jump the song (every card and ring together) to this beat. */
  onSeek(beat: number): void;
}

/** Top bar: play, scene picker, save/load, record, volume; plus the scene caption. */
export class Transport {
  readonly bar: HTMLElement;
  readonly caption: HTMLElement;
  private playBtn: HTMLButtonElement;
  private recordBtn: HTMLButtonElement;
  private undoBtn: HTMLButtonElement;
  private redoBtn: HTMLButtonElement;
  private restoreBtn: HTMLButtonElement;
  private select: HTMLSelectElement;
  private beatDots: HTMLElement[] = [];
  private pos: HTMLInputElement;
  private posLabel: HTMLElement;
  private posDragging = false;

  constructor(
    private demos: DemoScene[],
    cb: TransportCallbacks,
    masterDb: number,
    quality: 'eco' | 'balanced' | 'high',
    uiSounds: boolean,
    simple: boolean,
  ) {
    this.playBtn = h('button.sl-tbtn.sl-play', { type: 'button', 'aria-label': 'Play' }, svgIcon(PLAY));
    this.playBtn.addEventListener('click', () => cb.onPlayToggle());

    this.select = h('select.sl-select', { 'aria-label': 'Scene' });
    const groups = new Map<string, HTMLOptGroupElement>();
    for (const d of demos) {
      const label = d.subtitle === 'generative' ? 'Generative' : d.subtitle.startsWith('sandbox') ? 'Sandbox' : 'Classics';
      let g = groups.get(label);
      if (!g) {
        g = h('optgroup', { label });
        groups.set(label, g);
        this.select.append(g);
      }
      g.append(h('option', { value: d.id, text: d.title }));
    }
    this.select.append(h('option', { value: '__custom', text: 'Custom scene', hidden: true }));
    this.select.addEventListener('change', () => cb.onDemo(this.select.value));

    const newBtn = h('button.sl-tbtn.sl-tbtn-label', { type: 'button', title: 'Start a new, empty canvas (your current table is kept)', 'aria-label': 'New canvas' }, svgIcon(NEW), h('span', { text: 'New' }));
    newBtn.addEventListener('click', () => cb.onNewCanvas());
    this.undoBtn = h('button.sl-tbtn', { type: 'button', title: 'Undo (Ctrl+Z)', 'aria-label': 'Undo', disabled: true }, svgIcon(UNDO));
    this.undoBtn.addEventListener('click', () => cb.onUndo());
    this.redoBtn = h('button.sl-tbtn', { type: 'button', title: 'Redo (Ctrl+Shift+Z)', 'aria-label': 'Redo', disabled: true }, svgIcon(REDO));
    this.redoBtn.addEventListener('click', () => cb.onRedo());
    this.restoreBtn = h('button.sl-tbtn.sl-tbtn-label.sl-restore', { type: 'button', title: 'Put this piece back as it was written (you can undo this)', hidden: true }, h('span', { text: 'Restore original' }));
    this.restoreBtn.addEventListener('click', () => cb.onRestore());

    const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      if (f) cb.onLoad(f);
      file.value = '';
    });
    const save = h('button.sl-tbtn', { type: 'button', title: 'Save scene as JSON', 'aria-label': 'Save scene' }, svgIcon(SAVE));
    save.addEventListener('click', () => cb.onSave());
    const load = h('button.sl-tbtn', { type: 'button', title: 'Load scene JSON', 'aria-label': 'Load scene' }, svgIcon(LOAD));
    load.addEventListener('click', () => file.click());
    this.recordBtn = h('button.sl-tbtn.sl-rec', { type: 'button', title: 'Record one loop to WAV', 'aria-label': 'Record WAV' }, svgIcon(RECORD));
    this.recordBtn.addEventListener('click', () => cb.onRecord());

    const vol = h('input.sl-range.sl-vol', { type: 'range', min: -40, max: 0, step: 1, value: masterDb, 'aria-label': 'Volume' });
    vol.addEventListener('input', () => cb.onVolume(Number(vol.value)));

    const uiSnd = h(
      'button.sl-tbtn.sl-uisnd',
      { type: 'button', title: 'Interface sounds: clicks and chimes as you handle the glass', 'aria-label': 'Interface sounds', 'aria-pressed': String(uiSounds) },
      svgIcon(SPARKLE),
    );
    uiSnd.classList.toggle('sl-on', uiSounds);
    uiSnd.addEventListener('click', () => {
      const on = uiSnd.getAttribute('aria-pressed') !== 'true';
      uiSnd.setAttribute('aria-pressed', String(on));
      uiSnd.classList.toggle('sl-on', on);
      cb.onUiSounds(on);
    });

    const simpleBtn = h(
      'button.sl-tbtn.sl-tbtn-label.sl-simple',
      {
        type: 'button',
        title: 'Simple mode: just the table on a plain grey background — no landscape, sky or weather. Lighter on the computer',
        'aria-label': 'Simple mode',
        'aria-pressed': String(simple),
      },
      h('span', { text: 'Simple' }),
    );
    simpleBtn.classList.toggle('sl-on', simple);
    simpleBtn.addEventListener('click', () => {
      const on = simpleBtn.getAttribute('aria-pressed') !== 'true';
      simpleBtn.setAttribute('aria-pressed', String(on));
      simpleBtn.classList.toggle('sl-on', on);
      cb.onSimple(on);
    });

    const qualitySel = h('select.sl-select.sl-quality', { 'aria-label': 'Graphics quality', title: 'Graphics quality: lower it if sound stutters' });
    for (const [v, t] of [
      ['eco', 'Eco'],
      ['balanced', 'Balanced'],
      ['high', 'High'],
    ]) {
      qualitySel.append(h('option', { value: v, text: t }));
    }
    qualitySel.value = quality;
    qualitySel.addEventListener('change', () => cb.onQuality(qualitySel.value as 'eco' | 'balanced' | 'high'));

    this.pos = h('input.sl-range.sl-pos', { type: 'range', min: 0, max: 16, step: 0.25, value: 0, 'aria-label': 'Song position', title: 'Where the song is: drag to rewind or skip ahead (every card together)' });
    this.pos.addEventListener('pointerdown', () => (this.posDragging = true));
    const release = (): void => {
      this.posDragging = false;
    };
    this.pos.addEventListener('pointerup', release);
    this.pos.addEventListener('pointercancel', release);
    this.pos.addEventListener('input', () => cb.onSeek(Number(this.pos.value)));
    this.posLabel = h('span.sl-pos-label');

    const beats = h('div.sl-beats', { 'aria-hidden': 'true' });
    for (let i = 0; i < 4; i++) {
      const d = h('span.sl-beat');
      this.beatDots.push(d);
      beats.append(d);
    }

    this.bar = h(
      'div.sl-panel.sl-transport',
      {},
      this.playBtn,
      beats,
      h('span.sl-pos-wrap', {}, this.pos, this.posLabel),
      h('span.sl-sep'),
      this.select,
      this.restoreBtn,
      h('span.sl-sep'),
      newBtn,
      this.undoBtn,
      this.redoBtn,
      h('span.sl-sep'),
      save,
      load,
      this.recordBtn,
      file,
      h('span.sl-sep'),
      h('span.sl-vol-wrap', {}, svgIcon(VOLUME), vol),
      uiSnd,
      h('span.sl-sep'),
      simpleBtn,
      qualitySel,
    );
    this.caption = h('div.sl-caption');
  }

  setPlaying(playing: boolean): void {
    this.playBtn.replaceChildren(svgIcon(playing ? PAUSE : PLAY));
    this.playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    this.playBtn.classList.toggle('sl-on', playing);
  }

  /**
   * Song position within its longest loop (a card's whole length). Seeking picks a beat in
   * that loop; every card and ring then plays from there.
   */
  setPosition(beat: number, songBeats: number, beatsPerBar: number): void {
    const len = Math.max(beatsPerBar, songBeats);
    const at = ((beat % len) + len) % len;
    if (this.pos.max !== String(len)) this.pos.max = String(len);
    if (!this.posDragging) this.pos.value = String(Math.floor(at * 4) / 4);
    const bar = Math.floor(at / beatsPerBar) + 1;
    const label = `${bar} / ${Math.ceil(len / beatsPerBar)}`;
    if (this.posLabel.textContent !== label) this.posLabel.textContent = label;
  }

  /** Undo/redo availability, and whether the open demo differs from how it was written. */
  setHistory(canUndo: boolean, canRedo: boolean, modifiedDemo: boolean): void {
    this.undoBtn.disabled = !canUndo;
    this.redoBtn.disabled = !canRedo;
    this.restoreBtn.hidden = !modifiedDemo;
  }

  setRecording(busy: boolean): void {
    this.recordBtn.classList.toggle('sl-busy', busy);
    this.recordBtn.disabled = busy;
  }

  setScene(id: string | null): void {
    const demo = this.demos.find((d) => d.id === id);
    this.select.value = demo ? demo.id : '__custom';
    this.caption.replaceChildren();
    if (!demo) return;
    this.caption.append(
      h('div.sl-caption-title', { text: demo.title }),
      h('div.sl-caption-sub', { text: demo.subtitle }),
      h('p.sl-caption-blurb', { text: demo.blurb }),
    );
  }

  /** Beat indicator: soft dots, the current beat of the bar glows. */
  setBeat(beat: number | null, beatsPerBar: number): void {
    const cur = beat === null ? -1 : Math.floor(beat) % beatsPerBar;
    const frac = beat === null ? 0 : beat - Math.floor(beat);
    this.beatDots.forEach((d, i) => {
      d.style.opacity = i === cur ? String(1 - frac * 0.6) : '0.22';
      d.style.display = i < beatsPerBar ? '' : 'none';
    });
  }
}
