import { DEFAULT_SETTINGS, DEFAULT_TABLE, makeElement } from './defaults';
import type { ElementKind, SceneElement, SceneModel } from './types';

const KINDS: readonly ElementKind[] = ['emitter', 'prism', 'mirror', 'lens', 'filter', 'modulator', 'receptor', 'blocker', 'loom', 'comb', 'chord'];

/**
 * Hard limits for a scene read from a file. They sit well outside what the editor produces
 * (and what the demos use), so they never change a real table; they only stop a hand-edited
 * or hostile file from asking for a billion-step loop or a thousand receptors and hanging the tab.
 */
const MAX_ELEMENTS = 200;
const MAX_NOTES = 2048;
const MAX_SLOTS = 128;
const MAX_TEXT = 120;

/** [min, max] for numeric fields, by key; any other number only has to be finite. */
const RANGES: Record<string, readonly [number, number]> = {
  // settings
  bpm: [20, 300],
  beatsPerBar: [1, 16],
  root: [0, 11],
  c: [0.25, 64],
  quantize: [0, 1],
  dispersion: [0, 50],
  masterDb: [-60, 12],
  raysPerSplit: [1, 128],
  // elements
  size: [0.1, 100],
  length: [0.1, 100],
  aperture: [0.1, 100],
  focal: [-1000, 1000],
  intensity: [0, 10],
  reflectance: [0, 1],
  minNm: [300, 800],
  maxNm: [300, 800],
  steps: [1, 512],
  hits: [0, 512],
  rotate: [-512, 512],
  depth: [0, 1],
  octave: [-2, 9],
  span: [0.1, 8],
  voices: [1, 16],
  gain: [0, 4],
  fringes: [1, 64],
  phase: [-1, 2],
  beatsPerChord: [0.25, 128],
  offset: [-4096, 4096],
};

const ENUMS: Record<string, readonly string[]> = {
  subdivision: ['1/4', '1/8', '1/16'],
  pulse: ['1/4', '1/8', '1/16', 'drone'],
  rhythm: ['1/4', '1/8', '1/16', 'hold'],
  instrument: ['pad', 'pluck', 'bell', 'drums'],
  scale: ['majorPent', 'minorPent', 'dorian', 'major', 'minor'],
};

export function serializeScene(scene: SceneModel): string {
  return JSON.stringify(scene, null, 2);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function clamp(v: number, [lo, hi]: readonly [number, number]): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Bring every field that has a default to the default's type, clamp numbers into RANGES and
 * enums into their values. Fields without a default (optional ones) are checked by the caller.
 */
function conform(target: Record<string, unknown>, defaults: Record<string, unknown>): void {
  for (const [k, d] of Object.entries(defaults)) {
    const v = target[k];
    const range = RANGES[k];
    const values = ENUMS[k];
    if (typeof d === 'number') {
      target[k] = finite(v) ? (range ? clamp(v, range) : v) : d;
    } else if (typeof d === 'string') {
      const ok = typeof v === 'string' && (values ? values.includes(v) : v.length <= MAX_TEXT);
      target[k] = ok ? v : d;
    } else if (typeof d === 'boolean') {
      if (typeof v !== 'boolean') target[k] = d;
    }
  }
}

function spectrumOk(v: unknown): boolean {
  if (!isObject(v)) return false;
  if (v.kind === 'white') return true;
  return v.kind === 'band' && finite(v.minNm) && finite(v.maxNm) && v.minNm >= 300 && v.maxNm <= 800 && v.minNm < v.maxNm;
}

function motionOk(v: unknown): boolean {
  if (!isObject(v)) return false;
  if (v.kind === 'turn') return finite(v.degPerBar) && Math.abs(v.degPerBar) <= 3600;
  return v.kind === 'swing' && finite(v.degrees) && Math.abs(v.degrees) <= 360 && finite(v.bars) && v.bars > 0 && v.bars <= 64;
}

/** Sanitize one element in place: its own parameters and the optional fields. */
function conformElement(el: Record<string, unknown>, base: Record<string, unknown>): void {
  conform(el, base);
  if (typeof el.enabled !== 'boolean') el.enabled = true;
  if ('spectrum' in base && !spectrumOk(el.spectrum)) el.spectrum = base.spectrum;
  if ('motion' in el && !motionOk(el.motion)) delete el.motion;
  if ('offset' in el) {
    if (finite(el.offset)) el.offset = clamp(el.offset, RANGES.offset!);
    else delete el.offset;
  }
  if ('notes' in base) {
    const notes: unknown[] = Array.isArray(el.notes) ? el.notes : [];
    el.notes = notes.filter((n) => isObject(n) && finite(n.at) && finite(n.len) && finite(n.deg) && n.len > 0).slice(0, MAX_NOTES);
  }
  if ('slots' in el) {
    if (Array.isArray(el.slots)) {
      const slots: unknown[] = el.slots;
      el.slots = slots.filter((s) => isObject(s) && finite(s.u0) && finite(s.u1)).slice(0, MAX_SLOTS);
    } else delete el.slots;
  }
}

/**
 * Parse a scene, tolerating missing fields (defaults fill them) but rejecting
 * anything structurally wrong. Unknown element kinds are dropped; values of the wrong
 * type fall back to defaults and numbers are clamped to sane limits (see RANGES).
 */
export function parseScene(json: string | unknown): SceneModel {
  const raw: unknown = typeof json === 'string' ? JSON.parse(json) : json;
  if (!isObject(raw) || raw.version !== 1 || !Array.isArray(raw.elements)) {
    throw new Error('Not a Spectral Loom scene (expected version 1 with an elements array).');
  }
  const table: Record<string, unknown> = { ...DEFAULT_TABLE, ...(isObject(raw.table) ? raw.table : {}) };
  for (const k of ['w', 'h'] as const) {
    const v = table[k];
    table[k] = finite(v) ? clamp(v, [4, 200]) : DEFAULT_TABLE[k];
  }
  const settings: Record<string, unknown> = { ...DEFAULT_SETTINGS, ...(isObject(raw.settings) ? raw.settings : {}) };
  // Files from the first engine (settings.engine 1) hold cards written in pitches; any slots
  // they carry are placeholders. Drop them: the cards are cut where they lie when loaded.
  const pitchCards = settings.engine === 1;
  delete settings.engine;
  conform(settings, DEFAULT_SETTINGS as unknown as Record<string, unknown>);
  const elements: SceneElement[] = [];
  for (const e of raw.elements) {
    if (elements.length >= MAX_ELEMENTS) break;
    if (!isObject(e) || !KINDS.includes(e.kind as ElementKind) || !isObject(e.pos)) continue;
    const pos = { x: Number(e.pos.x) || 0, y: Number(e.pos.y) || 0 };
    const rotation = finite(e.rotation) ? e.rotation : 0;
    const base = makeElement(e.kind as ElementKind, pos, rotation);
    const el: Record<string, unknown> = { ...base, ...e, pos, rotation };
    conformElement(el, base as unknown as Record<string, unknown>);
    if (pitchCards && el.kind === 'loom') delete el.slots;
    if (typeof el.id !== 'string' || el.id.length > MAX_TEXT || elements.some((x) => x.id === el.id)) el.id = base.id;
    elements.push(el as unknown as SceneElement);
  }
  return {
    version: 1,
    name: typeof raw.name === 'string' ? raw.name.slice(0, MAX_TEXT) : 'Untitled',
    table: table as SceneModel['table'],
    settings: settings as unknown as SceneModel['settings'],
    elements,
  };
}
