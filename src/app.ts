import * as THREE from 'three';
import { AudioEngine } from './audio/engine';
import { renderWav } from './audio/export';
import { ENVELOPES, envelopeAt } from './audio/instruments';
import { lightToDegree } from './music/pitch';
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
import { planNotes, type NoteTemplate } from './timing/arrivals';
import { pulseSources, SUBDIVISION_BEATS, type PulseSource } from './timing/sources';
import { h } from './ui/dom';
import { Interaction } from './ui/interaction';
import { Panels } from './ui/panels';
import { Transport } from './ui/transport';

export interface AppOptions {
  scene: SceneModel;
  demoId?: string | null;
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

  constructor(host: HTMLElement, opts: AppOptions) {
    this.store = new SceneStore(opts.scene);
    this.demoId = opts.demoId ?? null;
    this.engine = new AudioEngine(opts.scene.settings.bpm);
    this.canvas = h('canvas.sl-canvas', { 'aria-label': 'Spectral Loom table' });
    this.stats = h('div.sl-stats', { 'aria-hidden': 'true' });
    this.root = h('div.sl-root', { tabindex: 0 }, this.canvas);
    host.append(this.root);

    this.renderer = new Renderer(this.canvas, this.store.scene);
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
      opts.scene.settings.masterDb,
    );
    this.transport.setScene(this.demoId);

    const title = h(
      'header.sl-title',
      {},
      h('span.sl-title-name', { text: 'Spectral Loom' }),
      h('span.sl-title-sub', { text: 'an optical instrument' }),
    );
    const hint = h('footer.sl-keys', {
      html: '<kbd>drag</kbd> move <kbd>wheel</kbd>/<kbd>Q</kbd><kbd>E</kbd> rotate <kbd>⇧</kbd> free <kbd>dbl-click</kbd> on/off <kbd>Del</kbd> remove <kbd>drag table</kbd> tilt <kbd>space</kbd> play',
    });
    this.overlay = this.buildOverlay();
    this.root.append(title, this.transport.bar, this.transport.caption, this.panels.palette, this.panels.side, hint, this.stats, this.overlay);

    this.unsubscribe = this.store.subscribe((kinds) => this.onChange(kinds));
    this.root.addEventListener('keydown', this.onKey);

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

  private async start(): Promise<void> {
    if (!this.engine.ready) await this.engine.start(this.store.scene.settings.masterDb);
    this.overlay?.classList.add('sl-hidden');
    const o = this.overlay;
    this.overlay = null;
    window.setTimeout(() => o?.remove(), 700);
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
      this.engine.setMasterDb(s.masterDb);
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
    this.renderer.setInsets({
      left: Math.max(0, pal.right - r.left - 10),
      right: Math.max(0, r.right - side.left - 10),
      top: 60,
      bottom: 24,
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
    this.renderer.setTree(this.tree, now, this.dirty.crossfade);
  }

  private computeCardLayout(tree: RayTree): Map<string, Map<number, number>> {
    const out = new Map<string, Map<number, number>>();
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
      const deg = lightToDegree(hit.light, { scale: scene.settings.scale, span: receptor.span });
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
    if (!this.visible || document.hidden) return;
    const wall = performance.now() / 1000;

    if (this.dirty.views) {
      this.renderer.syncScene(this.store.scene);
      this.dirty.views = false;
    }
    if (this.dirty.optics) {
      this.rebuild(wall);
      this.dirty.optics = false;
      this.dirty.crossfade = false;
    }

    const heard = this.engine.ready ? this.engine.heardTime() : wall;
    const beat = this.engine.playing ? this.engine.clock.beatAt(heard) : null;
    this.updateInstruments(heard, beat);
    this.transport.setBeat(beat, this.store.scene.settings.beatsPerBar);

    const sel = this.store.selected ?? null;
    this.renderer.gizmo.setSelected(sel, sel ? (this.renderer.views.get(sel.id)?.radius ?? 1) : 1);
    const hov = this.interaction.hovered && this.interaction.hovered !== sel?.id ? this.store.get(this.interaction.hovered) : undefined;
    this.renderer.gizmo.setHover(hov ?? null, hov ? (this.renderer.views.get(hov.id)?.radius ?? 1) : 1);

    this.renderer.render(wall, wall);
    this.updateStats(wall);
    this.schedule();
  };

  /** Receptor slits glow with their notes; modulator rings and loom cards follow the beat. */
  private updateInstruments(heard: number, beat: number | null): void {
    const level = new Map<string, number>();
    for (const n of this.engine.recentNotes()) {
      const v = envelopeAt(ENVELOPES[n.instrument], n.holdS, heard - n.time) * n.velocity;
      if (v > 0) level.set(n.receptorId, (level.get(n.receptorId) ?? 0) + v);
    }
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

  private updateStats(now: number): void {
    this.frames.count += 1;
    const dt = now * 1000 - this.frames.t0;
    if (dt < 500) return;
    const fps = (this.frames.count * 1000) / dt;
    this.renderer.adaptResolution(1000 / fps);
    this.frames = { count: 0, t0: now * 1000 };
    const segs = this.tree?.segments.length ?? 0;
    this.stats.textContent = `${fps.toFixed(0)} fps · ${segs} rays${this.tree?.truncated ? ' (capped)' : ''}`;
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
    this.interaction.dispose();
    this.engine.dispose();
    this.renderer.dispose();
    this.root.remove();
  }
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
