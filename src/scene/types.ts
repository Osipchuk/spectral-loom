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

/**
 * Clockwork: an element that turns by itself as the music plays, on the beat clock.
 * `turn` keeps rotating; `swing` rocks to and fro around its set angle.
 */
export type Motion = { kind: 'turn'; degPerBar: number } | { kind: 'swing'; degrees: number; bars: number };

interface BaseElement {
  id: NodeId;
  pos: Vec2;
  rotation: number;
  enabled: boolean;
  motion?: Motion;
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

/**
 * One note on a loom card. `deg` is the card's row: a scale degree (0 = root at the
 * receptor's octave) on an engine-1 card, a slot index on an engine-2 card.
 */
export interface LoomNote {
  at: number;
  len: number;
  deg: number;
}

/** A slot cut through an engine-2 card, from u0 to u1 along it (−0.5…0.5). */
export interface LoomSlot {
  u0: number;
  u1: number;
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
  /**
   * Engine 2: the slots cut through the card. A hole in row k lets through whatever colour
   * crosses slot k, so the optics decide the pitch. Missing → evenly spaced default slots.
   */
  slots?: LoomSlot[];
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

/**
 * Chord glass: sits across a rainbow and plays a chord progression. On each chord it lets
 * swells through only on the colours of that chord's notes — harmony without a punch card.
 */
export interface ChordGlass extends BaseElement {
  kind: 'chord';
  length: number;
  /** Progression preset id (see music/chords.ts). */
  progression: string;
  beatsPerChord: number;
  /** How often the chord is struck: once per chord ('hold') or on every step. */
  rhythm: Subdivision | 'hold';
}

export interface Blocker extends BaseElement {
  kind: 'blocker';
  length: number;
}

export type SceneElement = Emitter | Prism | Mirror | Lens | Filter | Modulator | Receptor | Blocker | Loom | Comb | ChordGlass;
export type ElementKind = SceneElement['kind'];
export type ElementOf<K extends ElementKind> = Extract<SceneElement, { kind: K }>;

/**
 * 1: loom cards store pitches (the card is the score, light only carries it).
 * 2: loom cards store slots (the card says when, the light says what), soft quantization,
 *    loudness, tone and stereo per note from where and how tightly its light lands.
 */
export type EngineVersion = 1 | 2;

export interface GlobalSettings {
  engine: EngineVersion;
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
