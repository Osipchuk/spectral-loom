import { trace } from './optics/tracer';
import type { RayTree } from './optics/types';
import { Renderer } from './render/renderer';
import { SceneStore, type ChangeKind } from './scene/store';
import type { SceneModel } from './scene/types';
import { h } from './ui/dom';
import { Interaction } from './ui/interaction';
import { Panels } from './ui/panels';

export interface AppOptions {
  scene: SceneModel;
}

/**
 * Wires the pure layers (scene → optics) to the renderer and UI, and owns the frame
 * loop. Everything lives inside `root`; nothing touches the host page globally.
 */
export class App {
  readonly store: SceneStore;
  readonly root: HTMLElement;
  private renderer: Renderer;
  private interaction: Interaction;
  private panels: Panels;
  private canvas: HTMLCanvasElement;
  private tree: RayTree | null = null;
  private dirty = { optics: true, crossfade: false, views: true };
  private raf = 0;
  private visible = true;
  private resizeObserver: ResizeObserver;
  private intersectionObserver: IntersectionObserver;
  private unsubscribe: () => void;
  private stats: HTMLElement;
  private frames = { count: 0, t0: performance.now() };

  constructor(host: HTMLElement, opts: AppOptions) {
    this.store = new SceneStore(opts.scene);
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
    const title = h(
      'header.sl-title',
      {},
      h('span.sl-title-name', { text: 'Spectral Loom' }),
      h('span.sl-title-sub', { text: 'an optical instrument' }),
    );
    const hint = h('footer.sl-keys', {
      html: '<kbd>drag</kbd> move <kbd>wheel</kbd>/<kbd>Q</kbd><kbd>E</kbd> rotate <kbd>⇧</kbd> free <kbd>dbl-click</kbd> on/off <kbd>Del</kbd> remove <kbd>drag table</kbd> tilt',
    });
    this.root.append(title, this.panels.palette, this.panels.side, hint, this.stats);

    this.unsubscribe = this.store.subscribe((kinds) => this.onChange(kinds));

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

  private onVisibility = (): void => this.schedule();

  private onChange(kinds: ReadonlySet<ChangeKind>): void {
    if (kinds.has('geometry') || kinds.has('toggle') || kinds.has('settings')) {
      this.dirty.optics = true;
      this.dirty.views = true;
    }
    if (kinds.has('toggle')) this.dirty.crossfade = true;
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
      top: 36,
      bottom: 24,
    });
  }

  private schedule(): void {
    if (this.raf || !this.visible || document.hidden) return;
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (): void => {
    this.raf = 0;
    if (!this.visible || document.hidden) return;
    const now = performance.now() / 1000;

    if (this.dirty.views) {
      this.renderer.syncScene(this.store.scene);
      this.dirty.views = false;
    }
    if (this.dirty.optics) {
      this.tree = trace(this.store.scene);
      this.renderer.setTree(this.tree, now, this.dirty.crossfade);
      this.dirty.optics = false;
      this.dirty.crossfade = false;
    }
    const sel = this.store.selected ?? null;
    this.renderer.gizmo.setSelected(sel, sel ? (this.renderer.views.get(sel.id)?.radius ?? 1) : 1);
    const hov = this.interaction.hovered && this.interaction.hovered !== sel?.id ? this.store.get(this.interaction.hovered) : undefined;
    this.renderer.gizmo.setHover(hov ?? null, hov ? (this.renderer.views.get(hov.id)?.radius ?? 1) : 1);

    this.renderer.render(now, now);
    this.updateStats(now);
    this.schedule();
  };

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

  loadScene(scene: SceneModel): void {
    this.store.load(scene);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.visible = false;
    this.unsubscribe();
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.interaction.dispose();
    this.renderer.dispose();
    this.root.remove();
  }
}
