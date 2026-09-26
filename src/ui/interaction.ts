import * as THREE from 'three';
import { BEAM_HEIGHT } from '../render/frame';
import { CAMERA_LIMITS, ZOOM_LIMITS, type Renderer } from '../render/renderer';
import { makeElement } from '../scene/defaults';
import type { SceneStore } from '../scene/store';
import type { ElementKind, SceneElement, Vec2 } from '../scene/types';

const ROT_STEP = (5 * Math.PI) / 180;
const FINE_STEP = Math.PI / 180;

type Mode =
  | { kind: 'idle' }
  | { kind: 'drag'; id: string; offset: Vec2; moved: boolean; startClient: Vec2 }
  | { kind: 'rotate'; id: string }
  | { kind: 'orbit'; startClient: Vec2; az0: number; pol0: number }
  | { kind: 'pan'; last: Vec2 }
  | { kind: 'place'; elementId: string | null; elKind: ElementKind; startClient: Vec2; moved: boolean };

function snapAngle(a: number, free: boolean): number {
  const step = free ? FINE_STEP : ROT_STEP;
  const snapped = Math.round(a / step) * step;
  return ((snapped % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

/**
 * Pointer and keyboard interaction. Keyboard shortcuts listen on the demo root only, so
 * the host page (blog) keeps its own keys; the wheel is only captured over an element.
 */
export class Interaction {
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BEAM_HEIGHT);
  private mode: Mode = { kind: 'idle' };
  private hoverId: string | null = null;
  private cleanup: (() => void)[] = [];

  constructor(
    private root: HTMLElement,
    private canvas: HTMLCanvasElement,
    private renderer: Renderer,
    private store: SceneStore,
    private onCameraChange: () => void,
  ) {
    const on = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement,
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ): void => {
      target.addEventListener(type, fn as EventListener, opts);
      this.cleanup.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };
    on(canvas, 'pointerdown', (e) => this.pointerDown(e));
    on(canvas, 'pointermove', (e) => this.pointerMove(e));
    on(canvas, 'pointerup', (e) => this.pointerUp(e));
    on(canvas, 'pointercancel', () => (this.mode = { kind: 'idle' }));
    on(canvas, 'dblclick', (e) => this.doubleClick(e));
    on(canvas, 'wheel', (e) => this.wheel(e), { passive: false });
    on(canvas, 'contextmenu', (e) => e.preventDefault());
    on(canvas, 'pointerleave', () => this.setHover(null));
    on(root, 'keydown', (e) => this.keyDown(e));
  }

  /** Lets the tutorial move a click-placed element straight to its target. */
  onClickPlace: ((id: string) => void) | null = null;
  /** Pressing on the tutorial's ghost outline places the real element there. */
  onGhost: (() => string | null) | null = null;

  get hovered(): string | null {
    return this.hoverId;
  }

  private setNdc(clientX: number, clientY: number): void {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.renderer.camera);
  }

  private tablePoint(clientX: number, clientY: number): Vec2 | null {
    this.setNdc(clientX, clientY);
    const hit = this.raycaster.ray.intersectPlane(this.dragPlane, new THREE.Vector3());
    return hit ? this.renderer.frame.toTable(hit) : null;
  }

  private pickElement(clientX: number, clientY: number): string | null {
    this.setNdc(clientX, clientY);
    const hits = this.raycaster.intersectObjects(this.renderer.views.pickTargets(), false);
    return (hits[0]?.object.userData.elementId as string | undefined) ?? null;
  }

  private pickGhost(clientX: number, clientY: number): boolean {
    const g = this.renderer.ghostPick;
    if (!g) return false;
    this.setNdc(clientX, clientY);
    return this.raycaster.intersectObject(g, false).length > 0;
  }

  private pickKnob(clientX: number, clientY: number): boolean {
    if (!this.store.selected) return false;
    this.setNdc(clientX, clientY);
    return this.raycaster.intersectObject(this.renderer.gizmo.knob, false).length > 0;
  }

  private snapPos(p: Vec2): Vec2 {
    const { w, h } = this.store.scene.table;
    let { x, y } = p;
    if (this.store.scene.settings.gridSnap) {
      x = Math.round(x * 2) / 2;
      y = Math.round(y * 2) / 2;
    }
    return { x: Math.min(w - 0.5, Math.max(0.5, x)), y: Math.min(h - 0.5, Math.max(0.5, y)) };
  }

  private setHover(id: string | null): void {
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.canvas.style.cursor = id ? 'grab' : 'default';
  }

  private pointerDown(e: PointerEvent): void {
    this.root.focus({ preventScroll: true });
    this.canvas.setPointerCapture(e.pointerId);
    const client = { x: e.clientX, y: e.clientY };
    if (e.button === 0 && this.pickKnob(e.clientX, e.clientY)) {
      this.mode = { kind: 'rotate', id: this.store.selectedId! };
      this.canvas.style.cursor = 'grabbing';
      return;
    }
    let id = e.button === 0 ? this.pickElement(e.clientX, e.clientY) : null;
    if (!id && e.button === 0 && this.onGhost && this.pickGhost(e.clientX, e.clientY)) {
      // The element appears where the ghost was and stays grabbed, so a drag just continues.
      id = this.onGhost();
    }
    if (id) {
      const el = this.store.get(id)!;
      const p = this.tablePoint(e.clientX, e.clientY);
      this.store.select(id);
      this.mode = {
        kind: 'drag',
        id,
        offset: p ? { x: el.pos.x - p.x, y: el.pos.y - p.y } : { x: 0, y: 0 },
        moved: false,
        startClient: client,
      };
      this.canvas.style.cursor = 'grabbing';
      return;
    }
    if (e.button === 2 || e.button === 1) {
      this.mode = { kind: 'pan', last: client };
      this.canvas.style.cursor = 'move';
      return;
    }
    const { azimuth, polar } = this.renderer.angles;
    this.mode = { kind: 'orbit', startClient: client, az0: azimuth, pol0: polar };
  }

  private pointerMove(e: PointerEvent): void {
    const m = this.mode;
    if (m.kind === 'idle') {
      this.setHover(this.pickKnob(e.clientX, e.clientY) ? '__knob' : this.pickElement(e.clientX, e.clientY));
      return;
    }
    if (m.kind === 'drag') {
      if (!m.moved && Math.hypot(e.clientX - m.startClient.x, e.clientY - m.startClient.y) < 3) return;
      m.moved = true;
      const p = this.tablePoint(e.clientX, e.clientY);
      if (!p) return;
      const pos = this.snapPos({ x: p.x + m.offset.x, y: p.y + m.offset.y });
      const el = this.store.get(m.id);
      if (el && (el.pos.x !== pos.x || el.pos.y !== pos.y)) this.store.updateElement(m.id, (t) => (t.pos = pos));
      return;
    }
    if (m.kind === 'rotate') {
      const el = this.store.get(m.id);
      const p = this.tablePoint(e.clientX, e.clientY);
      if (!el || !p) return;
      const a = snapAngle(Math.atan2(p.y - el.pos.y, p.x - el.pos.x), e.shiftKey);
      if (a !== el.rotation) this.store.updateElement(m.id, (t) => (t.rotation = a));
      return;
    }
    if (m.kind === 'pan') {
      const a = this.tablePoint(m.last.x, m.last.y);
      const b = this.tablePoint(e.clientX, e.clientY);
      m.last = { x: e.clientX, y: e.clientY };
      if (!a || !b) return;
      this.renderer.angles.panX -= b.x - a.x;
      this.renderer.angles.panZ -= b.y - a.y;
      this.renderer.updateCamera();
      return;
    }
    if (m.kind === 'orbit') {
      const dx = (e.clientX - m.startClient.x) / this.canvas.clientWidth;
      const dy = (e.clientY - m.startClient.y) / this.canvas.clientHeight;
      const L = CAMERA_LIMITS;
      this.renderer.angles.azimuth = THREE.MathUtils.clamp(m.az0 - dx * 1.2, -L.azimuth, L.azimuth);
      this.renderer.angles.polar = THREE.MathUtils.clamp(m.pol0 - dy * 1.0, L.polarMin, L.polarMax);
      this.renderer.updateCamera();
      this.onCameraChange();
    }
  }

  private pointerUp(e: PointerEvent): void {
    const m = this.mode;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (m.kind === 'orbit' && Math.hypot(e.clientX - m.startClient.x, e.clientY - m.startClient.y) < 4) {
      this.store.select(null);
    }
    this.mode = { kind: 'idle' };
    this.canvas.style.cursor = this.hoverId ? 'grab' : 'default';
    if (m.kind === 'drag' || m.kind === 'rotate') this.store.dropped();
  }

  private doubleClick(e: MouseEvent): void {
    const id = this.pickElement(e.clientX, e.clientY);
    if (id) this.store.toggle(id);
  }

  /** Zoom by `factor`, keeping the table point under (clientX, clientY) where it is. */
  zoomAt(factor: number, clientX?: number, clientY?: number): void {
    const a = this.renderer.angles;
    const next = Math.min(ZOOM_LIMITS.max, Math.max(ZOOM_LIMITS.min, a.zoom * factor));
    if (next === a.zoom) return;
    const r = this.canvas.getBoundingClientRect();
    const cx = clientX ?? r.left + r.width / 2;
    const cy = clientY ?? r.top + r.height / 2;
    const before = this.tablePoint(cx, cy);
    a.zoom = next;
    this.renderer.updateCamera();
    const after = this.tablePoint(cx, cy);
    if (before && after) {
      a.panX += before.x - after.x;
      a.panZ += before.y - after.y;
      this.renderer.updateCamera();
    }
  }

  resetView(): void {
    Object.assign(this.renderer.angles, { zoom: 1, panX: 0, panZ: 0, azimuth: 0, polar: 0.66 });
    this.renderer.updateCamera();
  }

  private wheel(e: WheelEvent): void {
    const id = this.pickElement(e.clientX, e.clientY);
    if (!id) {
      // Zoom with a pinch (ctrl+wheel) always, with a plain wheel once the demo has focus;
      // before that the wheel scrolls the host page.
      if (!e.ctrlKey && !this.root.contains(document.activeElement)) return;
      e.preventDefault();
      this.zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX, e.clientY);
      return;
    }
    e.preventDefault();
    const el = this.store.get(id)!;
    const dir = Math.sign(e.deltaY || e.deltaX);
    const step = e.shiftKey ? FINE_STEP : ROT_STEP;
    this.store.select(id);
    this.rotateBy(el, dir * step, e.shiftKey);
  }

  private rotateBy(el: SceneElement, delta: number, free: boolean): void {
    this.store.updateElement(el.id, (t) => (t.rotation = snapAngle(t.rotation + delta, free)));
  }

  private keyDown(e: KeyboardEvent): void {
    if ((e.target as HTMLElement).closest('input, select, textarea')) return;
    const key = e.key.toLowerCase();
    if (key === '+' || key === '=' || key === '-' || key === '0') {
      if (key === '0') this.resetView();
      else this.zoomAt(key === '-' ? 1 / 1.25 : 1.25);
      e.preventDefault();
      return;
    }
    const el = this.store.selected;
    if (!el) return;
    if (key === 'q' || key === 'e') {
      this.rotateBy(el, (key === 'q' ? -1 : 1) * (e.shiftKey ? FINE_STEP : ROT_STEP), e.shiftKey);
    } else if (key === 'delete' || key === 'backspace') {
      this.store.remove(el.id);
    } else if (key === 'escape') {
      this.store.select(null);
    } else if (key.startsWith('arrow')) {
      const step = e.shiftKey ? 0.1 : 0.5;
      const d = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] }[key];
      if (!d) return;
      const pos = { x: el.pos.x + d[0]!, y: el.pos.y + d[1]! };
      this.store.updateElement(el.id, (t) => (t.pos = pos));
    } else {
      return;
    }
    e.preventDefault();
  }

  /** Palette drag: the element appears under the cursor once it is over the table. */
  beginPlace(kind: ElementKind, e: PointerEvent, source: HTMLElement): void {
    this.root.focus({ preventScroll: true });
    source.setPointerCapture(e.pointerId);
    const mode: Extract<Mode, { kind: 'place' }> = {
      kind: 'place',
      elementId: null,
      elKind: kind,
      startClient: { x: e.clientX, y: e.clientY },
      moved: false,
    };
    this.mode = mode;
    const overCanvas = (ev: PointerEvent): boolean => {
      const r = this.canvas.getBoundingClientRect();
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom && under === this.canvas;
    };
    const move = (ev: PointerEvent): void => {
      if (Math.hypot(ev.clientX - mode.startClient.x, ev.clientY - mode.startClient.y) > 4) mode.moved = true;
      const p = overCanvas(ev) ? this.tablePoint(ev.clientX, ev.clientY) : null;
      if (!p) return;
      const pos = this.snapPos(p);
      if (!mode.elementId) {
        const el = makeElement(kind, pos, defaultRotation(kind));
        mode.elementId = el.id;
        this.store.add(el);
      } else {
        this.store.updateElement(mode.elementId, (t) => (t.pos = pos));
      }
    };
    const up = (ev: PointerEvent): void => {
      source.removeEventListener('pointermove', move);
      source.removeEventListener('pointerup', up);
      source.removeEventListener('pointercancel', up);
      if (source.hasPointerCapture(ev.pointerId)) source.releasePointerCapture(ev.pointerId);
      this.mode = { kind: 'idle' };
      if (!mode.moved && !mode.elementId) {
        // A plain click drops the element in the middle of the table.
        const { w, h } = this.store.scene.table;
        const el = makeElement(kind, this.snapPos({ x: w / 2, y: h / 2 }), defaultRotation(kind));
        this.store.add(el);
        this.onClickPlace?.(el.id);
        this.store.dropped();
        return;
      }
      if (mode.elementId && !overCanvas(ev)) this.store.remove(mode.elementId);
      else this.store.dropped();
    };
    source.addEventListener('pointermove', move);
    source.addEventListener('pointerup', up);
    source.addEventListener('pointercancel', up);
  }

  dispose(): void {
    for (const fn of this.cleanup) fn();
    this.cleanup = [];
  }
}

function defaultRotation(kind: ElementKind): number {
  // Receptors face the incoming light (usually travelling +x), so they look back along −x.
  if (kind === 'receptor') return Math.PI;
  if (kind === 'mirror') return (3 * Math.PI) / 4;
  return 0;
}
