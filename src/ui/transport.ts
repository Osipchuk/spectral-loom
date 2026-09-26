import type { DemoScene } from '../scene/demos';
import { h, svgIcon } from './dom';

const PLAY = '<path d="M7 5l12 7-12 7z" fill="currentColor" stroke="none"/>';
const PAUSE = '<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>';
const SAVE = '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>';
const LOAD = '<path d="M12 20V9M7 13l5-5 5 5M5 4h14"/>';
const RECORD = '<circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"/>';
const VOLUME = '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12"/>';

export interface TransportCallbacks {
  onPlayToggle(): void;
  onDemo(id: string): void;
  onSave(): void;
  onLoad(file: File): void;
  onRecord(): void;
  onVolume(db: number): void;
  onQuality(q: 'eco' | 'balanced' | 'high'): void;
}

/** Top bar: play, scene picker, save/load, record, volume; plus the scene caption. */
export class Transport {
  readonly bar: HTMLElement;
  readonly caption: HTMLElement;
  private playBtn: HTMLButtonElement;
  private recordBtn: HTMLButtonElement;
  private select: HTMLSelectElement;
  private beatDots: HTMLElement[] = [];

  constructor(
    private demos: DemoScene[],
    cb: TransportCallbacks,
    masterDb: number,
    quality: 'eco' | 'balanced' | 'high',
  ) {
    this.playBtn = h('button.sl-tbtn.sl-play', { type: 'button', 'aria-label': 'Play' }, svgIcon(PLAY));
    this.playBtn.addEventListener('click', () => cb.onPlayToggle());

    this.select = h('select.sl-select', { 'aria-label': 'Scene' });
    const groups = new Map<string, HTMLOptGroupElement>();
    for (const d of demos) {
      const label = d.subtitle === 'generative' ? 'Generative' : d.subtitle === 'sandbox' ? 'Sandbox' : 'Classics';
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
      h('span.sl-sep'),
      this.select,
      h('span.sl-sep'),
      save,
      load,
      this.recordBtn,
      file,
      h('span.sl-sep'),
      h('span.sl-vol-wrap', {}, svgIcon(VOLUME), vol),
      h('span.sl-sep'),
      qualitySel,
    );
    this.caption = h('div.sl-caption');
  }

  setPlaying(playing: boolean): void {
    this.playBtn.replaceChildren(svgIcon(playing ? PAUSE : PLAY));
    this.playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    this.playBtn.classList.toggle('sl-on', playing);
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
