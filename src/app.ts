import * as THREE from 'three';
import { AudioEngine } from './audio/engine';
import { renderTimelineWav, renderWav } from './audio/export';
import type { ScheduledNote } from './audio/engine';
import type { Timeline } from './capture/timeline';
import { holdSeconds } from './audio/instruments';
import { ENVELOPES, envelopeAt } from './audio/instruments';
import { degreeCount, degreeToMidi, lightToDegree, receptorPitch } from './music/pitch';
import { lightToRGB } from './render/spectral-color';
import { midiName, NoteLabels, type NoteLabel } from './ui/note-labels';
import { DRUM_BASE_MIDI, DRUM_PIECES } from './audio/drums';
import { CALM_NIGHT, moodWeather, weatherName, type Weather } from './music/mood';
import { AUDIO_THRESHOLD } from './timing/arrivals';
import { trace } from './optics/tracer';
import type { RayTree } from './optics/types';
import { dot, fromAngle, perp, sub } from './optics/vec2';
import { drawCard } from './render/elements/loom-card';
import { INSTRUMENT_COLORS } from './render/elements/element-views';
import { Renderer } from './render/renderer';
import { DEMO_SCENES } from './scene/demos';
import { parseScene, serializeScene } from './scene/serialize';
import { SceneStore, type ChangeKind } from './scene/store';
import type { Loom, SceneModel } from './scene/types';
import { notesInWindow, planNotes, type NoteTemplate } from './timing/arrivals';
import { BeatClock } from './timing/clock';
import { pulseSources, SUBDIVISION_BEATS, type PulseSource } from './timing/sources';
import { channelPulses, ENV_SLOTS, layoutVisuals, type VisualLayout } from './timing/visual';
import { PulseTexture } from './render/beams/pulse-texture';
import { h } from './ui/dom';
import { Interaction } from './ui/interaction';
import { Panels } from './ui/panels';
import { Transport } from './ui/transport';
import { Tutorial } from './ui/tutorial';
import { LoomEditor, type LoomRows } from './ui/loom-editor';
import { degreeToWavelength } from './music/pitch';
import { emptyScene } from './scene/defaults';
import type { ElementKind } from './scene/types';

export interface AppOptions {
  /** Scene to open; omitted → an empty table with the welcome screen. */
  scene?: SceneModel;
  demoId?: string | null;
}

/** The empty table the welcome screen and tutorial start from. */
export function starterScene(): SceneModel {
  const s = emptyScene('Empty table');
  s.settings = { ...s.settings, bpm: 100, scale: 'majorPent', root: 0 };
  return s;
}

/**
 * Wires the pure layers (scene → optics → timing) to audio, renderer and UI, and owns the
 * frame loop. Everything lives inside `root`; nothing touches the host page globally.
 */
export class App {
  readonly store: SceneStore;
  readonly root: HTMLElement;
  readonly engine: AudioEngine;
  private renderer: Renderer;
  private interaction: Interaction;
  private panels: Panels;
  private transport: Transport;
  private overlay: HTMLElement | null;
  private canvas: HTMLCanvasElement;
  private tree: RayTree | null = null;
  private plan: NoteTemplate[] = [];
  private sources = new Map<string, PulseSource>();
  /** Per loom card: where each pitch's ray crosses it (−0.5…0.5 along the card). */
  private cardLayout = new Map<string, Map<number, number>>();
  private dirty = { optics: true, crossfade: false, views: true };
  private raf = 0;
  private visible = true;
  private resizeObserver: ResizeObserver;
  private intersectionObserver: IntersectionObserver;
  private unsubscribe: () => void;
  private stats: HTMLElement;
  private frames = { count: 0, t0: performance.now() };
  private demoId: string | null;
  private tmpColor = new THREE.Color();
  private visual: VisualLayout = { channels: [], segments: new Map() };
  private pulseTexture = new PulseTexture();
  /** Longest light travel time in the scene, seconds: how far back pulses stay visible. */
  private maxDelayS = 0;
  private noteLabels = new NoteLabels();
  private lastMood = 0;
  private weatherLabel = 'clear night';
  /** `?weather=aurora|rain|snow|mist` pins the sky (for screenshots and debugging). */
  private pinnedWeather: Weather | null = pinnedWeatherFromUrl();
  /** Silent clock that animates light before audio is started. */
  private previewClock: BeatClock;

  private tutorial: Tutorial | null = null;
  private loomEditor: LoomEditor;
  /** Per loom card: the pitches (or drums) its light can reach, for the editor. */
  private cardRows = new Map<string, LoomRows>();
  private soundChip!: HTMLButtonElement;

  private onAnyPointer = (): void => {
    if (this.engine.ready && this.engine.playing) void this.engine.resume();
  };

  constructor(host: HTMLElement, opts: AppOptions) {
    const scene = opts.scene ?? starterScene();
    this.store = new SceneStore(scene);
    this.demoId = opts.demoId ?? null;
    this.engine = new AudioEngine(scene.settings.bpm);
    this.canvas = h('canvas.sl-canvas', { 'aria-label': 'Spectral Loom table' });
    this.stats = h('div.sl-stats', { 'aria-hidden': 'true' });
    this.root = h('div.sl-root', { tabindex: 0 }, this.canvas);
    host.append(this.root);

    this.renderer = new Renderer(this.canvas, this.store.scene);
    this.previewClock = new BeatClock(scene.settings.bpm);
    this.previewClock.anchor(performance.now() / 1000, 0);
    const shared = this.renderer.beams.shared;
    shared.uPulses!.value = this.pulseTexture.texture;
    ENV_SLOTS.forEach((slot, i) => {
      const e = slot === 'neutral' ? { attack: 0.08, decay: 0.6, sustain: 0, release: 1.2 } : ENVELOPES[slot];
      (shared.uEnv!.value as THREE.Vector4[])[i]!.set(Math.max(0.04, e.attack), Math.max(0.02, e.decay / 3), e.sustain, Math.max(0.02, e.release / 4));
    });
    this.interaction = new Interaction(this.root, this.canvas, this.renderer, this.store, () => {});
    this.panels = new Panels(this.store, {
      onPaletteDown: (kind, e) => this.interaction.beginPlace(kind, e, e.currentTarget as HTMLElement),
      onDelete: (id) => this.store.remove(id),
      onToggle: (id) => this.store.toggle(id),
    });
    this.transport = new Transport(
      DEMO_SCENES,
      {
        onPlayToggle: () => void this.togglePlay(),
        onDemo: (id) => this.loadDemo(id),
        onSave: () => this.saveScene(),
        onLoad: (f) => void this.loadFile(f),
        onRecord: () => void this.record(),
        onVolume: (db) => {
          this.store.scene.settings.masterDb = db;
          this.engine.setMasterDb(db);
        },
      },
      scene.settings.masterDb,
    );
    this.transport.setScene(this.demoId);

    const home = h('button.sl-title-name', { type: 'button', text: 'Spectral Loom', title: 'Back to the start screen' });
    home.addEventListener('click', () => this.goHome());
    const title = h('header.sl-title', {}, home, h('span.sl-title-sub', { text: 'an optical instrument' }));
    const hint = h('footer.sl-keys', {
      html: '<kbd>drag</kbd> move <kbd>wheel</kbd>/<kbd>Q</kbd><kbd>E</kbd> rotate <kbd>⇧</kbd> free <kbd>dbl-click</kbd> on/off <kbd>Del</kbd> remove <kbd>drag table</kbd> tilt <kbd>wheel</kbd>/<kbd>pinch</kbd> zoom <kbd>right-drag</kbd> pan <kbd>space</kbd> play',
    });
    this.overlay = opts.scene ? this.buildOverlay() : this.buildWelcome();
    this.loomEditor = new LoomEditor(this.store, (id) => this.rowsForCard(id));
    this.root.append(this.noteLabels.el, this.loomEditor.el, title, this.transport.bar, this.transport.caption, this.panels.palette, this.panels.side, hint, this.stats, this.overlay);

    this.unsubscribe = this.store.subscribe((kinds) => this.onChange(kinds));
    this.root.addEventListener('keydown', this.onKey);
    // Browsers suspend audio (device change, sleep, autoplay rules): say so, resume on the next click.
    this.soundChip = h('button.sl-chip', { type: 'button', hidden: true, text: 'Sound paused by the browser — click to resume' });
    this.soundChip.addEventListener('click', () => void this.engine.resume());
    this.root.append(this.soundChip);
    // One floating tooltip for every "?": panels scroll, so tips inside them would be clipped.
    const tip = h('div.sl-float-tip', { hidden: true, role: 'tooltip' });
    this.root.append(tip);
    const showTip = (e: Event): void => {
      const help = (e.target as HTMLElement).closest?.('.sl-help');
      if (!help) return;
      const r = help.getBoundingClientRect();
      const root = this.root.getBoundingClientRect();
      tip.textContent = help.querySelector('.sl-help-tip')?.textContent ?? '';
      tip.hidden = false;
      const left = r.left - root.left - 240 > 8 ? r.left - root.left - 240 : r.right - root.left + 10;
      tip.style.left = `${left}px`;
      tip.style.top = `${Math.min(root.height - 120, Math.max(8, r.top - root.top - 8))}px`;
    };
    const hideTip = (e: Event): void => {
      if ((e.target as HTMLElement).closest?.('.sl-help')) tip.hidden = true;
    };
    this.root.addEventListener('pointerover', showTip);
    this.root.addEventListener('focusin', showTip);
    this.root.addEventListener('pointerout', hideTip);
    this.root.addEventListener('focusout', hideTip);
    const zoomBtn = (text: string, label: string, fn: () => void): HTMLButtonElement => {
      const b = h('button.sl-zbtn', { type: 'button', text, 'aria-label': label, title: label });
      b.addEventListener('click', fn);
      return b;
    };
    this.root.append(
      h(
        'div.sl-zoom',
        {},
        zoomBtn('+', 'Zoom in (+)', () => this.interaction.zoomAt(1.3)),
        zoomBtn('−', 'Zoom out (−)', () => this.interaction.zoomAt(1 / 1.3)),
        zoomBtn('⤢', 'Fit table (0)', () => this.interaction.resetView()),
      ),
    );
    this.engine.onStatus = (status) => (this.soundChip.hidden = status === 'running');
    this.root.addEventListener('pointerdown', this.onAnyPointer, true);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.root);
    this.intersectionObserver = new IntersectionObserver((entries) => {
      this.visible = entries.some((e) => e.isIntersecting);
      this.schedule();
    });
    this.intersectionObserver.observe(this.root);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.resize();
    this.schedule();
  }

  private buildOverlay(): HTMLElement {
    const btn = h('button.sl-start-btn', { type: 'button' }, h('span', { text: 'Play' }));
    const overlay = h(
      'div.sl-overlay',
      {},
      h(
        'div.sl-overlay-card',
        {},
        h('div.sl-overlay-kicker', { text: 'Spectral Loom' }),
        h('h2.sl-overlay-title', { text: 'Light is the score.' }),
        h('p.sl-overlay-text', {
          text: 'White light splits into colours; every colour is a pitch. Light travels slowly here, so distance becomes time — rearrange the glass and the music changes.',
        }),
        btn,
        h('p.sl-overlay-foot', { text: 'Sound on · best in desktop Chrome' }),
      ),
    );
    btn.addEventListener('click', () => void this.start());
    return overlay;
  }

  private buildWelcome(): HTMLElement {
    const tutorialBtn = h('button.sl-start-btn', { type: 'button' }, h('span', { text: 'Build your first melody' }));
    tutorialBtn.addEventListener('click', () => this.startTutorial());
    const demos = h('div.sl-welcome-demos');
    for (const d of DEMO_SCENES) {
      if (d.id === 'bench') continue;
      const b = h('button.sl-demo-card', { type: 'button' }, h('span.sl-demo-title', { text: d.title }), h('span.sl-demo-sub', { text: d.subtitle }));
      b.addEventListener('click', () => {
        this.loadDemo(d.id);
        void this.start();
      });
      demos.append(b);
    }
    const empty = h('button.sl-link', { type: 'button', text: 'or start with an empty table' });
    empty.addEventListener('click', () => this.dismissOverlay());
    return h(
      'div.sl-overlay.sl-welcome',
      {},
      h(
        'div.sl-overlay-card',
        {},
        h('div.sl-overlay-kicker', { text: 'Spectral Loom' }),
        h('h2.sl-overlay-title', { text: 'Light is the score.' }),
        h('p.sl-overlay-text', {
          text: 'Place glass on a table and a beam of light plays it. White light splits into colours, every colour is a pitch, and light travels slowly — so distance becomes time.',
        }),
        tutorialBtn,
        h('p.sl-overlay-foot', { text: 'A two-minute guided tour · sound on' }),
        h('div.sl-welcome-label', { text: 'Or listen to a finished table' }),
        demos,
        empty,
      ),
    );
  }

  /** Back to the start screen: stop, clear the table, show the welcome card. */
  goHome(): void {
    this.engine.pause();
    this.transport.setPlaying(false);
    this.tutorial?.close();
    this.loadScene(starterScene());
    this.overlay?.remove();
    this.overlay = this.buildWelcome();
    this.root.append(this.overlay);
  }

  private dismissOverlay(): void {
    const o = this.overlay;
    this.overlay = null;
    o?.classList.add('sl-hidden');
    window.setTimeout(() => o?.remove(), 700);
    this.root.focus({ preventScroll: true });
  }

  private startTutorial(): void {
    this.loadScene(starterScene());
    this.dismissOverlay();
    // Build the audio graph now, inside this click, so later steps can start sound.
    void this.engine.start(this.store.scene.settings.masterDb);
    this.tutorial = new Tutorial({
      store: this.store,
      setGhost: (el) => this.renderer.setGhost(el),
      highlight: (kind) => this.highlightPalette(kind),
      ensureAudio: () => {
        if (!this.engine.playing) void this.start();
      },
      relayout: () => this.resize(),
      openDemo: (id) => {
        this.tutorial?.close();
        this.loadDemo(id);
        void this.start();
      },
      finish: () => {
        if (this.tutorial) this.resizeObserver.unobserve(this.tutorial.el);
        this.tutorial = null;
        this.interaction.onClickPlace = null;
        this.interaction.onGhost = null;
        this.resize();
      },
    });
    this.interaction.onClickPlace = () => this.tutorial?.snapNow();
    this.interaction.onGhost = () => this.tutorial?.placeFromGhost() ?? null;
    this.root.append(this.tutorial.el);
    this.resizeObserver.observe(this.tutorial.el);
    this.resize();
  }

  private highlightPalette(kind: ElementKind | null): void {
    for (const b of this.panels.palette.querySelectorAll<HTMLElement>('.sl-palette-btn')) {
      b.classList.toggle('sl-attn', b.dataset.kind === kind);
    }
  }

  private async start(): Promise<void> {
    if (!this.engine.ready) await this.engine.start(this.store.scene.settings.masterDb);
    if (this.overlay) this.dismissOverlay();
    this.engine.play();
    this.transport.setPlaying(true);
    this.root.focus({ preventScroll: true });
  }

  private async togglePlay(): Promise<void> {
    if (!this.engine.ready || this.overlay) return this.start();
    if (this.engine.playing) this.engine.pause();
    else this.engine.play();
    this.transport.setPlaying(this.engine.playing);
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.key !== ' ' || (e.target as HTMLElement).closest('input, select, textarea, button')) return;
    e.preventDefault();
    void this.togglePlay();
  };

  private onVisibility = (): void => this.schedule();

  private onChange(kinds: ReadonlySet<ChangeKind>): void {
    if (kinds.has('geometry') || kinds.has('toggle') || kinds.has('settings')) {
      this.dirty.optics = true;
      this.dirty.views = true;
    }
    if (kinds.has('toggle')) this.dirty.crossfade = true;
    if (kinds.has('settings') || kinds.has('load')) {
      const s = this.store.scene.settings;
      if (s.bpm !== this.engine.clock.bpm) this.engine.setBpm(s.bpm);
      if (s.bpm !== this.previewClock.bpm) this.previewClock.setBpm(s.bpm, performance.now() / 1000);
      this.engine.setMasterDb(s.masterDb);
    }
    if (kinds.has('selection') || kinds.has('load')) {
      const sel = this.store.selected;
      const was = this.loomEditor.openId;
      if (sel?.kind === 'loom') this.loomEditor.open(sel.id);
      else this.loomEditor.close();
      this.tutorial?.setDockTop(!!this.loomEditor.openId);
      if (was !== this.loomEditor.openId) this.resize();
    }
    if (kinds.has('selection') || kinds.has('load') || kinds.has('toggle')) {
      this.panels.refresh(kinds.has('load') || kinds.has('toggle'));
    } else if (kinds.has('geometry')) {
      this.panels.syncValues();
    }
  }

  private resize(): void {
    const r = this.root.getBoundingClientRect();
    this.renderer.resize(Math.max(1, Math.round(r.width)), Math.max(1, Math.round(r.height)));
    const pal = this.panels.palette.getBoundingClientRect();
    const side = this.panels.side.getBoundingClientRect();
    // Bottom: the loom editor if open, else the tutorial card. Top: the tutorial card when
    // it is docked up there (while the editor is open). The table is framed in between.
    const coach = this.tutorial?.el.getBoundingClientRect();
    const editor = this.loomEditor.openId ? this.loomEditor.el.getBoundingClientRect() : undefined;
    const coachTop = !!this.tutorial?.el.classList.contains('sl-coach-top');
    const bottomBox = editor ?? (coach && !coachTop ? coach : undefined);
    // Hidden panels (film mode, small screens) report empty rects: they take no room.
    const shown = (b?: DOMRect): b is DOMRect => !!b && b.width > 0 && b.height > 0;
    this.renderer.setInsets({
      left: shown(pal) ? Math.max(0, pal.right - r.left - 10) : 0,
      right: shown(side) ? Math.max(0, r.right - side.left - 10) : 0,
      top: this.capture ? 0 : coachTop && shown(coach) ? Math.max(60, coach.bottom - r.top + 8) : 60,
      bottom: shown(bottomBox) ? Math.max(24, r.bottom - bottomBox.top + 8) : 24,
    });
  }

  private schedule(): void {
    if (this.raf || !this.visible || document.hidden) return;
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Retrace and re-plan. Cheap enough to run on every drag frame. */
  private rebuild(now: number): void {
    const scene = this.store.scene;
    this.tree = trace(scene);
    this.plan = planNotes(scene, this.tree);
    this.sources = pulseSources(scene);
    this.engine.setPlan(this.plan, this.sources);
    this.cardLayout = this.computeCardLayout(this.tree);
    if (this.loomEditor.openId) this.loomEditor.refresh();
    this.visual = layoutVisuals(scene, this.tree, this.plan, scene.settings.bpm);
    if (this.pulseTexture.ensureRows(this.visual.channels.length)) {
      this.renderer.beams.shared.uPulses!.value = this.pulseTexture.texture;
    }
    const cs = (scene.settings.c * scene.settings.bpm) / 60;
    this.maxDelayS = 0;
    for (const g of this.tree.segments) {
      const w = this.visual.segments.get(g.id)?.warp ?? 0;
      this.maxDelayS = Math.max(this.maxDelayS, (g.sStart + g.length - g.pulseOriginS) / cs + Math.max(0, w));
    }
    this.renderer.setTree(this.tree, now, this.dirty.crossfade, this.visual);
    this.noteLabels.set(this.computeNoteLabels(this.tree), (p, y) => this.renderer.frame.toWorld(p, y));
  }

  /** One label per pitch per receptor, where that colour's light lands on the slit. */
  private computeNoteLabels(tree: RayTree): NoteLabel[] {
    const scene = this.store.scene;
    const acc = new Map<string, { label: NoteLabel; n: number; u: number }>();
    for (const hit of tree.receptorHits) {
      const r = this.store.get(hit.receptorId);
      if (r?.kind !== 'receptor' || !r.enabled || hit.bounces > 0 || hit.intensity < AUDIO_THRESHOLD) continue;
      const pc = receptorPitch(scene.settings, r);
      const deg = lightToDegree(hit.light, pc);
      const midi = degreeToMidi(deg, pc);
      const seg = tree.segments[hit.segmentId]!;
      const key = `${r.id}|${midi}`;
      const a = acc.get(key);
      if (a) {
        a.label.at = { x: (a.label.at.x * a.n + seg.end.x) / (a.n + 1), y: (a.label.at.y * a.n + seg.end.y) / (a.n + 1) };
        a.u = (a.u * a.n + hit.u) / (a.n + 1);
        a.n += 1;
      } else {
        const back = fromAngle(r.rotation + Math.PI);
        const text = r.instrument === 'drums' ? (DRUM_PIECES[midi - DRUM_BASE_MIDI] ?? '') : midiName(midi);
        acc.set(key, { label: { receptorId: r.id, midi, text, at: { ...seg.end }, back, rgb: lightToRGB(hit.light) }, n: 1, u: hit.u });
      }
    }
    return [...acc.values()].sort((a, b) => (a.label.receptorId === b.label.receptorId ? a.u - b.u : a.label.receptorId < b.label.receptorId ? -1 : 1)).map((a) => a.label);
  }

  /** Rows for the loom editor: what this card's light can play, labelled and coloured. */
  private rowsForCard(id: string): LoomRows {
    const known = this.cardRows.get(id);
    if (known && known.rows.length > 0) return known;
    // Not connected yet: offer one octave of the table's scale from a mid register.
    const s = this.store.scene.settings;
    const pc = { scale: s.scale, root: s.root, octave: 4, span: 1 };
    const count = degreeCount(pc);
    const rows = Array.from({ length: count + 1 }, (_, deg) => ({
      deg,
      label: midiName(degreeToMidi(deg, pc)),
      rgb: lightToRGB({ kind: 'mono', nm: degreeToWavelength(Math.min(deg, count - 1), pc) }),
    }));
    return { rows, kit: false, connected: false };
  }

  private computeCardLayout(tree: RayTree): Map<string, Map<number, number>> {
    const out = new Map<string, Map<number, number>>();
    this.cardRows = new Map();
    const scene = this.store.scene;
    const looms = new Map(scene.elements.filter((e): e is Loom => e.kind === 'loom').map((l) => [l.id, l]));
    for (const hit of tree.receptorHits) {
      const loom = looms.get(hit.pulseSourceId);
      const receptor = this.store.get(hit.receptorId);
      if (!loom || receptor?.kind !== 'receptor') continue;
      // Walk up to the segment that ended on the card.
      let seg: RayTree['segments'][number] | undefined = tree.segments[hit.segmentId];
      while (seg && !(seg.endEvent.kind === 'interact' && seg.endEvent.elementId === loom.id)) {
        seg = seg.parent === null ? undefined : tree.segments[seg.parent];
      }
      if (!seg) continue;
      const tangent = perp(fromAngle(loom.rotation));
      const u = dot(sub(seg.end, loom.pos), tangent) / loom.length;
      const pc = receptorPitch(scene.settings, receptor);
      const deg = lightToDegree(hit.light, pc);
      const rows = this.cardRows.get(loom.id) ?? { rows: [], kit: pc.kit === true, connected: true };
      if (!rows.rows.some((r) => r.deg === deg)) {
        const midi = degreeToMidi(deg, pc);
        const label = pc.kit ? (DRUM_PIECES[midi - DRUM_BASE_MIDI] ?? '') : midiName(midi);
        rows.rows.push({ deg, label, rgb: lightToRGB(hit.light) });
        rows.rows.sort((a, b) => a.deg - b.deg);
      }
      this.cardRows.set(loom.id, rows);
      const map = out.get(loom.id) ?? new Map<number, number>();
      // Several rays can share a degree; keep their average position.
      const prev = map.get(deg);
      map.set(deg, prev === undefined ? u : (prev + u) / 2);
      out.set(loom.id, map);
    }
    return out;
  }

  private frame = (): void => {
    this.raf = 0;
    if (this.capture || !this.visible || document.hidden) return;
    this.renderAt(performance.now() / 1000, null);
    this.schedule();
  };

  /**
   * Draw one frame. `virtual` (capture mode) replaces the audio clock with a scripted time,
   * so a film can be rendered frame by frame, faster or slower than real time.
   */
  private renderAt(wall: number, virtual: BeatClock | null): void {
    if (this.dirty.views) {
      this.renderer.syncScene(this.store.scene);
      this.dirty.views = false;
    }
    if (this.dirty.optics) {
      this.rebuild(wall);
      this.dirty.optics = false;
      this.dirty.crossfade = false;
    }

    const live = this.engine.ready && !virtual;
    const heard = live ? this.engine.heardTime() : wall;
    const clock = virtual ?? (live ? (this.engine.playing ? this.engine.clock : null) : this.previewClock);
    const beat = clock ? clock.beatAt(heard) : null;
    this.updateLight(heard, clock);
    this.updateInstruments(heard, beat);
    this.transport.setBeat(beat, this.store.scene.settings.beatsPerBar);
    this.loomEditor.setBeat(beat);
    this.updateMood(heard, wall);

    const sel = this.store.selected ?? null;
    this.renderer.gizmo.setSelected(sel, sel ? (this.renderer.views.get(sel.id)?.radius ?? 1) : 1);
    const hov = this.interaction.hovered && this.interaction.hovered !== sel?.id ? this.store.get(this.interaction.hovered) : undefined;
    this.renderer.gizmo.setHover(hov ?? null, hov ? (this.renderer.views.get(hov.id)?.radius ?? 1) : 1);

    this.renderer.render(wall, wall);
    this.noteLabels.update(this.renderer.camera, this.canvas.clientWidth, this.canvas.clientHeight, this.visibleNotes(heard), heard);
    this.updateStats(wall);
  }

  /** Notes sounding around `time`: from the audio engine, or computed from the plan while filming. */
  private visibleNotes(time: number): readonly ScheduledNote[] {
    const clock = this.captureClock;
    if (!clock) return this.engine.recentNotes();
    return notesInWindow(this.plan, this.sources, clock.beatAt(time - 6), clock.beatAt(time + 0.05))
      .filter((n) => n.launchBeat >= 0)
      .map((n) => ({ ...n, time: clock.timeAt(n.beat), holdS: holdSeconds(n.instrument, n.lenBeats * clock.secondsPerBeat) }));
  }

  // ------------------------------------------------------------------ capture mode

  private capture: Timeline | null = null;
  private captureClock: BeatClock | null = null;

  /** Enter film mode: no UI, no real-time loop; frames are rendered on demand. */
  captureStart(timeline: Timeline): void {
    this.capture = timeline;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.tutorial?.close();
    this.overlay?.remove();
    this.overlay = null;
    this.store.select(null);
    this.root.classList.add('sl-capture');
    const scene = timeline.at(0);
    this.captureClock = new BeatClock(scene.settings.bpm);
    this.captureClock.anchor(0, 0);
    this.store.load(scene);
    this.resize();
  }

  /** Render the film at time t (seconds). */
  captureFrame(t: number): void {
    const tl = this.capture;
    if (!tl || !this.captureClock) return;
    const next = tl.at(t);
    const prev = this.store.scene;
    const toggled = next.elements.some((e) => prev.elements.find((p) => p.id === e.id)?.enabled !== e.enabled);
    if (JSON.stringify(next.elements) !== JSON.stringify(prev.elements)) {
      this.store.scene = next;
      this.dirty.optics = true;
      this.dirty.views = true;
      this.dirty.crossfade = toggled;
    }
    Object.assign(this.renderer.angles, tl.camera(t));
    this.renderer.atmosphere.setWeather(tl.weather(t), true);
    this.renderer.updateCamera();
    this.renderAt(t, this.captureClock);
  }

  /** The film's soundtrack, rendered offline against the same timeline. */
  async captureWav(): Promise<Blob> {
    if (!this.capture) throw new Error('not in capture mode');
    return renderTimelineWav(this.capture, this.store.scene.settings.masterDb);
  }

  /**
   * Upload the pulses that can still be visible somewhere on a beam: launched within the
   * longest travel time plus a release tail. Visuals are a pure function of (ray tree,
   * pulse schedule, audio time); nothing here reacts to note events.
   */
  private updateLight(time: number, clock: BeatClock | null): void {
    const shared = this.renderer.beams.shared;
    const s = this.store.scene.settings;
    shared.uAudioTime!.value = time;
    shared.uLightSpeed!.value = (s.c * s.bpm) / 60;
    // While music plays the base glow drops so swells stand out; paused beams stay bright.
    const base = shared.uBase!.value as number;
    shared.uBase!.value = base + ((clock ? 0.4 : 0.62) - base) * 0.08;
    if (!clock) {
      shared.uPulsesOn!.value = 0;
      return;
    }
    shared.uPulsesOn!.value = 1;
    const from = time - this.maxDelayS - 6;
    const to = time + 0.05;
    const rows = this.visual.channels.map((ch) => {
      const src = this.sources.get(ch.sourceId);
      return src ? channelPulses(ch, src, clock, from, to) : [];
    });
    this.pulseTexture.write(rows);
  }

  /** Receptor slits glow with their notes; modulator rings and loom cards follow the beat. */
  private updateInstruments(heard: number, beat: number | null): void {
    const level = new Map<string, number>();
    for (const n of this.visibleNotes(heard)) {
      const v = envelopeAt(ENVELOPES[n.instrument], n.holdS, heard - n.time) * n.velocity;
      if (v > 0) level.set(n.receptorId, (level.get(n.receptorId) ?? 0) + v);
    }
    let energy = 0;
    for (const v of level.values()) energy += v;
    this.renderer.energy = Math.min(1, energy * 0.5);
    for (const el of this.store.scene.elements) {
      const view = this.renderer.views.get(el.id);
      if (!view) continue;
      if (el.kind === 'receptor' && view.dynamic.slit) {
        const rgb = INSTRUMENT_COLORS[el.instrument] ?? [1, 1, 1];
        const g = el.enabled ? 0.3 + Math.min(1.5, level.get(el.id) ?? 0) * 3 : 0.03;
        view.dynamic.slit.color.setRGB(rgb[0] * g, rgb[1] * g, rgb[2] * g);
      } else if (el.kind === 'modulator' && view.dynamic.dots) {
        const stepBeats = SUBDIVISION_BEATS[el.subdivision];
        const src = this.sources.get(el.id);
        const hits = new Set(src?.events.map((e) => Math.round(e.beat / stepBeats)));
        const cur = beat === null ? -1 : Math.floor(beat / stepBeats) % el.steps;
        view.dynamic.dots.forEach((dot, i) => {
          const on = hits.has(i);
          const c = i === cur ? (on ? 3.2 : 0.6) : on ? 0.9 : 0.08;
          this.tmpColor.setRGB(c * 1.0, c * 0.78, c * 0.45);
          dot.material.color.copy(this.tmpColor);
        });
      } else if (el.kind === 'loom' && view.dynamic.card) {
        drawCard(view.dynamic.card, el, this.cardLayout.get(el.id) ?? new Map(), beat ?? 0);
      }
    }
  }

  /** Let the sky follow the music: re-estimate the mood twice a second. */
  private updateMood(heard: number, wall: number): void {
    if (this.capture || wall - this.lastMood < 0.5) return;
    this.lastMood = wall;
    const windowS = 6;
    const notes = this.engine.playing || this.captureClock ? this.visibleNotes(heard).filter((n) => n.time <= heard && n.time > heard - windowS) : [];
    const w = this.pinnedWeather ?? moodWeather({ scale: this.store.scene.settings.scale, bpm: this.store.scene.settings.bpm, notes, windowS });
    this.renderer.atmosphere.setWeather(w, this.pinnedWeather !== null);
    this.weatherLabel = weatherName(w);
  }

  private updateStats(now: number): void {
    this.frames.count += 1;
    const dt = now * 1000 - this.frames.t0;
    if (dt < 500) return;
    const fps = (this.frames.count * 1000) / dt;
    this.renderer.adaptResolution(1000 / fps);
    this.frames = { count: 0, t0: now * 1000 };
    const segs = this.tree?.segments.length ?? 0;
    this.stats.textContent = `sky: ${this.weatherLabel} · ${fps.toFixed(0)} fps · ${segs} rays${this.tree?.truncated ? ' (capped)' : ''}`;
  }

  loadScene(scene: SceneModel, demoId: string | null = null): void {
    this.demoId = demoId;
    this.transport.setScene(demoId);
    this.store.load(scene);
  }

  loadDemo(id: string): void {
    const demo = DEMO_SCENES.find((d) => d.id === id);
    if (demo) this.loadScene(parseScene(demo.scene), demo.id);
  }

  private saveScene(): void {
    const blob = new Blob([serializeScene(this.store.scene)], { type: 'application/json' });
    download(blob, `${slug(this.store.scene.name)}.spectral-loom.json`);
  }

  private async loadFile(file: File): Promise<void> {
    try {
      this.loadScene(parseScene(await file.text()));
    } catch (err) {
      window.alert(`Could not load this scene: ${(err as Error).message}`);
    }
  }

  /** Length of one full musical loop, in seconds (longest card, else 8 bars), capped. */
  loopSeconds(): number {
    const s = this.store.scene.settings;
    let beats = 8 * s.beatsPerBar;
    for (const src of this.sources.values()) if (src.loopBeats > s.beatsPerBar * 2) beats = Math.max(beats, src.loopBeats);
    const lead = Math.max(0, ...this.plan.map((t) => t.offsetBeats));
    return Math.min(120, ((beats + lead) * 60) / s.bpm);
  }

  async renderLoopWav(): Promise<Blob> {
    if (this.dirty.optics) this.rebuild(performance.now() / 1000);
    const s = this.store.scene.settings;
    return renderWav(this.plan, this.sources, s.bpm, s.masterDb, this.loopSeconds());
  }

  private async record(): Promise<void> {
    this.transport.setRecording(true);
    try {
      download(await this.renderLoopWav(), `${slug(this.store.scene.name)}.wav`);
    } finally {
      this.transport.setRecording(false);
    }
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.visible = false;
    this.unsubscribe();
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.root.removeEventListener('keydown', this.onKey);
    this.root.removeEventListener('pointerdown', this.onAnyPointer, true);
    this.interaction.dispose();
    this.engine.dispose();
    this.pulseTexture.dispose();
    this.renderer.dispose();
    this.root.remove();
  }
}

function pinnedWeatherFromUrl(): Weather | null {
  const w = new URLSearchParams(location.search).get('weather');
  if (!w) return null;
  const base = { ...CALM_NIGHT, mist: 0.2 };
  if (w === 'aurora') return { ...base, aurora: 1, clouds: 0.05, wind: 0.5, warmth: 0.8 };
  if (w === 'rain') return { ...base, rain: 1, clouds: 0.85, mist: 0.4, wind: 0.8, warmth: 0.1, fireflies: 0 };
  if (w === 'snow') return { ...base, snow: 1, clouds: 0.5, mist: 0.5, wind: 0.2, warmth: 0.3, fireflies: 0 };
  if (w === 'mist') return { ...base, mist: 1, clouds: 0.3, fireflies: 0.8 };
  return base;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'scene';
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
