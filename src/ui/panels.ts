import type { SceneStore } from '../scene/store';
import type { ElementKind, SceneElement } from '../scene/types';
import { h, svgIcon } from './dom';
import { ELEMENT_INFO } from './info';
import { ELEMENT_FIELDS, GLOBAL_FIELDS, KIND_LABELS, type Field, type FieldValue } from './params';

export const ICONS: Record<ElementKind, string> = {
  emitter: '<rect x="3" y="8" width="10" height="8" rx="1.5"/><path d="M13 12h8"/><path d="M17 9.5l2.5 2.5-2.5 2.5"/>',
  prism: '<path d="M12 4l8 15H4z"/><path d="M2 13l7-1.5" opacity=".6"/><path d="M15 12.5l7 2M15 13.5l6.5 3.5" opacity=".6"/>',
  mirror: '<path d="M6 20L18 4"/><path d="M8.5 21L20.5 5" opacity=".35"/><path d="M3 9l6 3 -6 3" opacity=".6"/>',
  lens: '<path d="M12 3c3 3 3 15 0 18c-3-3-3-15 0-18z"/><path d="M2 9h6M2 15h6M16 9l6 3M16 15l6-3" opacity=".6"/>',
  filter: '<rect x="10" y="3" width="4" height="18" rx="1"/><path d="M2 12h8M14 12h8" opacity=".6"/>',
  modulator: '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="4" r="1"/><circle cx="20" cy="12" r="1"/><circle cx="12" cy="20" r="1"/><circle cx="4" cy="12" r="1"/><path d="M2 12h20" opacity=".5"/>',
  receptor: '<rect x="14" y="4" width="6" height="16" rx="1.5"/><path d="M14 9v6" stroke-width="2.5"/><path d="M2 12h10" opacity=".6"/>',
  blocker: '<rect x="9" y="3" width="6" height="18" rx="1.5" fill="currentColor" opacity=".35"/><path d="M2 12h6" opacity=".6"/>',
  loom: '<rect x="8" y="3" width="8" height="18" rx="1"/><circle cx="10.5" cy="7" r=".9" fill="currentColor"/><circle cx="13.5" cy="10" r=".9" fill="currentColor"/><circle cx="10.5" cy="14" r=".9" fill="currentColor"/><circle cx="13.5" cy="17" r=".9" fill="currentColor"/><path d="M2 12h6M16 12h6" opacity=".5"/>',
};

export const PALETTE_ORDER: ElementKind[] = ['emitter', 'prism', 'mirror', 'lens', 'filter', 'modulator', 'loom', 'receptor', 'blocker'];

function fieldRow<T>(field: Field<T>, target: T, onChange: (v: FieldValue) => void): HTMLElement {
  const value = field.get(target);
  const label = h('label.sl-field-label', { text: field.label });
  if (field.kind === 'range') {
    const out = h('output.sl-field-value', { text: field.format ? field.format(Number(value)) : String(value) });
    const input = h('input.sl-range', {
      type: 'range',
      min: field.min,
      max: field.max,
      step: field.step,
      value: Number(value),
      'aria-label': field.label,
    });
    input.addEventListener('input', () => {
      const v = Number(input.value);
      out.textContent = field.format ? field.format(v) : String(v);
      onChange(v);
    });
    return h('div.sl-field', {}, h('div.sl-field-head', {}, label, out), input);
  }
  if (field.kind === 'select') {
    const group = h('div.sl-seg', { role: 'radiogroup', 'aria-label': field.label });
    for (const [v, text] of field.options) {
      const b = h('button.sl-seg-btn', { type: 'button', text, 'aria-pressed': String(v === value) });
      b.addEventListener('click', () => {
        for (const other of group.children) other.setAttribute('aria-pressed', 'false');
        b.setAttribute('aria-pressed', 'true');
        onChange(v);
      });
      group.append(b);
    }
    return h('div.sl-field', {}, h('div.sl-field-head', {}, label), group);
  }
  const input = h('input.sl-toggle', { type: 'checkbox', 'aria-label': field.label });
  input.checked = Boolean(value);
  input.addEventListener('change', () => onChange(input.checked));
  return h('div.sl-field.sl-field-inline', {}, label, input);
}

export interface PanelCallbacks {
  onPaletteDown(kind: ElementKind, e: PointerEvent): void;
  onDelete(id: string): void;
  onToggle(id: string): void;
}

/** Palette on the left, inspector + global settings on the right. Plain DOM, no framework. */
export class Panels {
  readonly palette: HTMLElement;
  readonly side: HTMLElement;
  private inspector: HTMLElement;
  private globals: HTMLElement;
  private inspectedId: string | null = null;

  constructor(
    private store: SceneStore,
    private cb: PanelCallbacks,
  ) {
    this.palette = h('nav.sl-panel.sl-palette', { 'aria-label': 'Elements' });
    for (const kind of PALETTE_ORDER) {
      const info = ELEMENT_INFO[kind];
      const btn = h(
        'button.sl-palette-btn',
        { type: 'button', 'aria-label': `${KIND_LABELS[kind]}: ${info.light}` },
        svgIcon(ICONS[kind]),
        h('span.sl-palette-label', { text: KIND_LABELS[kind] }),
        h(
          'span.sl-tip',
          { role: 'tooltip' },
          h('span.sl-tip-title', { text: KIND_LABELS[kind] }),
          h('span.sl-tip-row', {}, h('b', { text: 'Light ' }), info.light),
          h('span.sl-tip-row', {}, h('b', { text: 'Music ' }), info.music),
          h('span.sl-tip-foot', { text: 'Drag onto the table, or click to drop it in the middle.' }),
        ),
      );
      btn.dataset.kind = kind;
      btn.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        cb.onPaletteDown(kind, e);
      });
      this.palette.append(btn);
    }

    this.inspector = h('section.sl-panel.sl-inspector', { 'aria-label': 'Inspector' });
    this.globals = h('details.sl-panel.sl-globals', { 'aria-label': 'Global settings' });
    this.side = h('aside.sl-side', {}, this.inspector, this.globals);
    this.renderGlobals();
    this.renderInspector(true);
  }

  /** Re-render the inspector if the selection changed (or forced, e.g. after a load). */
  refresh(force = false): void {
    this.renderInspector(force);
    if (force) this.renderGlobals();
  }

  /** Update visible values in place during drags without rebuilding the DOM. */
  syncValues(): void {
    const el = this.store.selected;
    if (!el) return;
    const rot = this.inspector.querySelector<HTMLInputElement>('input[aria-label="Rotation"]');
    const field = ELEMENT_FIELDS[el.kind].find((f) => f.key === 'rotation');
    if (rot && field && field.kind === 'range') {
      const v = Number(field.get(el));
      rot.value = String(v);
      const out = rot.parentElement?.querySelector('output');
      if (out && field.format) out.textContent = field.format(v);
    }
  }

  private renderInspector(force: boolean): void {
    const el = this.store.selected;
    const id = el?.id ?? null;
    if (!force && id === this.inspectedId) return;
    this.inspectedId = id;
    this.inspector.replaceChildren();
    if (!el) {
      this.inspector.classList.add('sl-empty');
      this.inspector.append(
        h('div.sl-panel-title', { text: 'Inspector' }),
        h('p.sl-hint', { text: 'Select an element to tune it. Drag new ones in from the left.' }),
      );
      return;
    }
    this.inspector.classList.remove('sl-empty');
    this.inspector.append(this.inspectorBody(el));
  }

  private inspectorBody(el: SceneElement): HTMLElement {
    const title = h(
      'div.sl-panel-title',
      {},
      svgIcon(ICONS[el.kind]),
      h('span', { text: KIND_LABELS[el.kind] }),
      h('span.sl-badge', { text: el.enabled ? 'on' : 'off', 'data-on': String(el.enabled) }),
    );
    const info = ELEMENT_INFO[el.kind];
    const about = h('p.sl-about', {}, h('span.sl-about-light', { text: info.light }), ' ', h('span.sl-about-music', { text: info.music }));
    const body = h('div.sl-fields');
    const rebuild = (): void => {
      body.replaceChildren();
      for (const field of ELEMENT_FIELDS[el.kind]) {
        if (field.hidden?.(el)) continue;
        body.append(
          fieldRow(field, el, (v) => {
            const hadHidden = ELEMENT_FIELDS[el.kind].map((f) => f.hidden?.(el) ?? false).join();
            this.store.updateElement(el.id, (target) => field.set(target, v));
            const nowHidden = ELEMENT_FIELDS[el.kind].map((f) => f.hidden?.(el) ?? false).join();
            if (hadHidden !== nowHidden) rebuild();
          }),
        );
      }
    };
    rebuild();
    const actions = h(
      'div.sl-actions',
      {},
      h('button.sl-btn', { type: 'button', text: el.enabled ? 'Disable' : 'Enable', onclick: () => this.cb.onToggle(el.id) }),
      h('button.sl-btn.sl-btn-danger', { type: 'button', text: 'Delete', onclick: () => this.cb.onDelete(el.id) }),
    );
    return h('div', {}, title, about, body, actions);
  }

  private renderGlobals(): void {
    const open = (this.globals as HTMLDetailsElement).open;
    this.globals.replaceChildren(h('summary.sl-panel-title.sl-summary', {}, h('span', { text: 'Table' }), h('span.sl-summary-hint', { text: 'tempo · scale' })));
    (this.globals as HTMLDetailsElement).open = open;
    const s = this.store.scene.settings;
    for (const field of GLOBAL_FIELDS) {
      this.globals.append(
        fieldRow(field, s, (v) => {
          const patch = { ...s };
          field.set(patch, v);
          this.store.updateSettings(patch);
        }),
      );
    }
  }
}
