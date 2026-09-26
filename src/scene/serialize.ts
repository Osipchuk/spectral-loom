import { DEFAULT_SETTINGS, DEFAULT_TABLE, makeElement } from './defaults';
import type { ElementKind, SceneElement, SceneModel } from './types';

const KINDS: readonly ElementKind[] = ['emitter', 'prism', 'mirror', 'lens', 'filter', 'modulator', 'receptor', 'blocker', 'loom', 'comb', 'chord'];

export function serializeScene(scene: SceneModel): string {
  return JSON.stringify(scene, null, 2);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Parse a scene, tolerating missing fields (defaults fill them) but rejecting
 * anything structurally wrong. Unknown element kinds are dropped.
 */
export function parseScene(json: string | unknown): SceneModel {
  const raw: unknown = typeof json === 'string' ? JSON.parse(json) : json;
  if (!isObject(raw) || raw.version !== 1 || !Array.isArray(raw.elements)) {
    throw new Error('Not a Spectral Loom scene (expected version 1 with an elements array).');
  }
  const table = isObject(raw.table) ? { ...DEFAULT_TABLE, ...raw.table } : { ...DEFAULT_TABLE };
  const settings = { ...DEFAULT_SETTINGS, ...(isObject(raw.settings) ? raw.settings : {}) };
  settings.engine = settings.engine === 2 ? 2 : 1;
  const elements: SceneElement[] = [];
  for (const e of raw.elements) {
    if (!isObject(e) || !KINDS.includes(e.kind as ElementKind) || !isObject(e.pos)) continue;
    const pos = { x: Number(e.pos.x) || 0, y: Number(e.pos.y) || 0 };
    const base = makeElement(e.kind as ElementKind, pos, Number(e.rotation) || 0);
    const el = { ...base, ...e, pos } as SceneElement;
    if (typeof el.id !== 'string' || elements.some((x) => x.id === el.id)) el.id = base.id;
    elements.push(el);
  }
  return {
    version: 1,
    name: typeof raw.name === 'string' ? raw.name : 'Untitled',
    table: table as SceneModel['table'],
    settings: settings as SceneModel['settings'],
    elements,
  };
}
