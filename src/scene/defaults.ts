import type { ElementKind, ElementOf, GlobalSettings, SceneElement, SceneModel, Vec2 } from './types';

export const DEFAULT_SETTINGS: GlobalSettings = {
  bpm: 96,
  beatsPerBar: 4,
  scale: 'majorPent',
  root: 2,
  c: 4,
  quantize: 0.7,
  dispersion: 12,
  masterDb: 0,
  gridSnap: true,
  raysPerSplit: 24,
};

export const DEFAULT_TABLE = { w: 48, h: 28 };

let idCounter = 0;
export function newId(kind: ElementKind): string {
  idCounter += 1;
  return `${kind}-${Date.now().toString(36)}-${idCounter}`;
}

type Params<K extends ElementKind> = Omit<ElementOf<K>, 'id' | 'pos' | 'rotation' | 'enabled' | 'kind'>;

export const PARAMS: { [K in ElementKind]: Params<K> } = {
  emitter: { spectrum: { kind: 'white' }, intensity: 1, pulse: '1/4' },
  prism: { size: 3, dispersion: 1 },
  mirror: { length: 3, reflectance: 0.9, splitter: false },
  lens: { aperture: 4, focal: 6 },
  filter: { length: 3, minNm: 480, maxNm: 580 },
  modulator: { steps: 8, hits: 3, rotate: 0, subdivision: '1/8', depth: 0.6 },
  receptor: { aperture: 3, instrument: 'pluck', octave: 3, span: 2, voices: 4, gain: 0.8 },
  blocker: { length: 2 },
  comb: { length: 3, fringes: 5, phase: 0 },
  chord: { length: 4, progression: 'pop', beatsPerChord: 4, rhythm: '1/4' },
  // A new card is not blank: a gentle arpeggio, so it sounds as soon as light reaches a receptor.
  loom: {
    length: 4,
    subdivision: '1/8',
    steps: 16,
    notes: [0, 2, 4, 2, 0, 2, 4, 6].map((deg, i) => ({ at: i * 2, deg, len: 2 })),
    depth: 0.8,
    title: 'New card',
  },
};

export function makeElement<K extends ElementKind>(
  kind: K,
  pos: Vec2,
  rotation = 0,
  overrides: Partial<Params<K>> = {},
): ElementOf<K> {
  const base = structuredClone(PARAMS[kind]);
  return { id: newId(kind), kind, pos: { ...pos }, rotation, enabled: true, ...base, ...overrides } as unknown as ElementOf<K>;
}

export function emptyScene(name = 'Untitled'): SceneModel {
  return { version: 1, name, table: { ...DEFAULT_TABLE }, settings: { ...DEFAULT_SETTINGS }, elements: [] };
}

export function cloneScene(scene: SceneModel): SceneModel {
  return structuredClone(scene);
}

export function findElement(scene: SceneModel, id: string): SceneElement | undefined {
  return scene.elements.find((e) => e.id === id);
}
