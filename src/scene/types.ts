/**
 * Serializable scene model. All distances are in grid units (1 unit = 1 table cell),
 * all angles in radians. `rotation` is the element's facing direction; line-like
 * elements (mirror, lens, filter, receptor, blocker) extend perpendicular to it.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export type NodeId = string;

export type Subdivision = '1/4' | '1/8' | '1/16';
export type Instrument = 'pad' | 'pluck' | 'bell' | 'drums';
export type ScaleName = 'majorPent' | 'minorPent' | 'dorian' | 'major' | 'minor';

export type SpectrumSpec = { kind: 'white' } | { kind: 'band'; minNm: number; maxNm: number };

interface BaseElement {
  id: NodeId;
  pos: Vec2;
  rotation: number;
  enabled: boolean;
}

export interface Emitter extends BaseElement {
  kind: 'emitter';
  spectrum: SpectrumSpec;
  intensity: number;
  pulse: Subdivision | 'drone';
}

export interface Prism extends BaseElement {
  kind: 'prism';
  /** Side length of the equilateral triangle. */
  size: number;
  /** Per-prism multiplier on top of the global dispersion. */
  dispersion: number;
}

export interface Mirror extends BaseElement {
  kind: 'mirror';
  length: number;
  reflectance: number;
  /** A splitter transmits what it does not reflect; a mirror absorbs it. */
  splitter: boolean;
}

export interface Lens extends BaseElement {
  kind: 'lens';
  aperture: number;
  /** Focal length in grid units, negative = diverging. */
  focal: number;
}

export interface Filter extends BaseElement {
  kind: 'filter';
  length: number;
  minNm: number;
  maxNm: number;
}

export interface Modulator extends BaseElement {
  kind: 'modulator';
  steps: number;
  hits: number;
  rotate: number;
  subdivision: Subdivision;
  depth: number;
}

export interface Receptor extends BaseElement {
  kind: 'receptor';
  aperture: number;
  instrument: Instrument;
  /** Octave of scale degree 0 (the reddest light). */
  octave: number;
  /** Octaves the visible spectrum is stretched over. */
  span: number;
  voices: number;
  gain: number;
}

/** One note on a loom card, in scale-degree space (0 = root at the receptor's octave). */
export interface LoomNote {
  at: number;
  len: number;
  deg: number;
}

/**
 * A punched card across a dispersed fan: at each step it launches swells only on the rays
 * whose pitch matches a hole. This is how a composed melody enters the instrument.
 */
export interface Loom extends BaseElement {
  kind: 'loom';
  length: number;
  subdivision: Subdivision;
  steps: number;
  notes: LoomNote[];
  depth: number;
  title: string;
}

/**
 * An interference comb: passes light only on evenly spaced fringes in pitch space and
 * narrows it to thin lines. A smeared rainbow becomes a few clean, separate colours.
 */
export interface Comb extends BaseElement {
  kind: 'comb';
  length: number;
  /** Number of bright fringes across the visible spectrum. */
  fringes: number;
  /** Shifts the fringes, 0…1 of one fringe spacing. */
  phase: number;
}

export interface Blocker extends BaseElement {
  kind: 'blocker';
  length: number;
}

export type SceneElement = Emitter | Prism | Mirror | Lens | Filter | Modulator | Receptor | Blocker | Loom | Comb;
export type ElementKind = SceneElement['kind'];
export type ElementOf<K extends ElementKind> = Extract<SceneElement, { kind: K }>;

export interface GlobalSettings {
  bpm: number;
  beatsPerBar: number;
  scale: ScaleName;
  /** Root pitch class, 0 = C. */
  root: number;
  /** Scene speed of light, grid units per beat. 4 → one cell per 1/16 note. */
  c: number;
  quantize: number;
  /** Global dispersion multiplier on the Cauchy B term, 1..5. */
  dispersion: number;
  masterDb: number;
  gridSnap: boolean;
  raysPerSplit: number;
}

export interface SceneModel {
  version: 1;
  name: string;
  table: { w: number; h: number };
  settings: GlobalSettings;
  elements: SceneElement[];
}
