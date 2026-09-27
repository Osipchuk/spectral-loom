import { cloneScene, findElement } from './defaults';
import type { GlobalSettings, SceneElement, SceneModel } from './types';

/**
 * What changed, so consumers can do the minimum work:
 * - geometry: element transforms/params → retrace, instant beam swap
 * - toggle: enable/disable → retrace with a cross-fade
 * - settings: global settings → retrace (dispersion) and/or retime
 * - selection: UI only
 * - load: whole scene replaced
 * - drop: the user let go of something they were dragging (no data change by itself)
 * - restore: comes with load when the table is an earlier state of the same one (undo, redo)
 */
export type ChangeKind = 'geometry' | 'toggle' | 'settings' | 'selection' | 'load' | 'drop' | 'restore';
export type Listener = (kinds: ReadonlySet<ChangeKind>) => void;

export class SceneStore {
  private listeners = new Set<Listener>();
  selectedId: string | null = null;

  constructor(public scene: SceneModel) {}

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(...kinds: ChangeKind[]): void {
    const set = new Set(kinds);
    for (const fn of this.listeners) fn(set);
  }

  get selected(): SceneElement | undefined {
    return this.selectedId ? findElement(this.scene, this.selectedId) : undefined;
  }

  get(id: string): SceneElement | undefined {
    return findElement(this.scene, id);
  }

  /** Signal that a drag ended, so listeners can react to the final placement. */
  dropped(): void {
    this.emit('drop');
  }

  select(id: string | null): void {
    if (id === this.selectedId) return;
    this.selectedId = id;
    this.emit('selection');
  }

  add(el: SceneElement, select = true): void {
    this.scene.elements.push(el);
    if (select) this.selectedId = el.id;
    this.emit('geometry', 'selection');
  }

  remove(id: string): void {
    const i = this.scene.elements.findIndex((e) => e.id === id);
    if (i < 0) return;
    this.scene.elements.splice(i, 1);
    if (this.selectedId === id) this.selectedId = null;
    this.emit('geometry', 'selection');
  }

  updateElement(id: string, fn: (el: SceneElement) => void, kind: ChangeKind = 'geometry'): void {
    const el = findElement(this.scene, id);
    if (!el) return;
    fn(el);
    this.emit(kind);
  }

  toggle(id: string): void {
    this.updateElement(id, (el) => (el.enabled = !el.enabled), 'toggle');
  }

  updateSettings(patch: Partial<GlobalSettings>): void {
    Object.assign(this.scene.settings, patch);
    this.emit('settings');
  }

  load(scene: SceneModel): void {
    this.scene = cloneScene(scene);
    this.selectedId = null;
    this.emit('load', 'geometry', 'settings', 'selection');
  }

  /** Go back (or forward) to another state of the same table: undo, redo. Keeps the selection if it still exists. */
  restore(scene: SceneModel): void {
    this.scene = cloneScene(scene);
    if (this.selectedId && !findElement(this.scene, this.selectedId)) this.selectedId = null;
    this.emit('load', 'restore', 'geometry', 'settings', 'selection');
  }
}
