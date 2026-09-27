import { parseVoice } from '../../music/notation';
import { degreeToWavelength } from '../../music/pitch';
import { DEFAULT_SETTINGS, DEFAULT_TABLE, PARAMS } from '../defaults';
import { layOutScore } from '../cards';
import type { ElementKind, ElementOf, LoomNote, ScaleName, SceneElement, SceneModel, Subdivision, Vec2 } from '../types';

const rad = (deg: number): number => (deg * Math.PI) / 180;
/** Pitch class of D, the key of most demos. */
const D = 2;

/** Deterministic element builder for hand-authored demo scenes. */
export function el<K extends ElementKind>(kind: K, id: string, x: number, y: number, rotDeg: number, params: Partial<ElementOf<K>> = {}): ElementOf<K> {
  return {
    ...(structuredClone(PARAMS[kind]) as object),
    id,
    kind,
    pos: { x, y },
    rotation: rad(rotDeg),
    enabled: true,
    ...params,
  } as ElementOf<K>;
}

/*
 * The spectrometer "chain": emitter → prism → (loom card) → (lens) → receptor, authored in
 * a local frame where the emitter sits at the origin shooting along +x. With the prism at
 * 70° and dispersion 12×, the fan leaves the prism at FAN_EXIT heading FAN_DIR (measured
 * with the tracer) and spreads ~19°. Rotating the chain as a whole keeps the optics intact.
 */
const FAN_EXIT = { x: 8.37, y: -1.15 };
const FAN_DIR = -39.61;

interface ChainOptions {
  id: string;
  origin: Vec2;
  heading: number;
  emitter?: Partial<ElementOf<'emitter'>>;
  loom?: { at: number; length: number; subdivision: Subdivision; steps: number; notes: LoomNote[]; title: string };
  modulator?: { at: number } & Partial<ElementOf<'modulator'>>;
  lens?: { at: number; focal: number; aperture: number };
  receptor: { at: number; tilt?: number } & Partial<ElementOf<'receptor'>>;
}

/** Positions along a spectrometer chain rooted at `origin`, heading `heading` degrees. */
export function chainPoints(origin: Vec2, heading: number): {
  place: (lx: number, ly: number) => [number, number];
  alongFan: (L: number) => [number, number];
  /** Direction of the dispersed fan, degrees. */
  fan: number;
} {
  const c = Math.cos(rad(heading));
  const s = Math.sin(rad(heading));
  const place = (lx: number, ly: number): [number, number] => [origin.x + lx * c - ly * s, origin.y + lx * s + ly * c];
  const alongFan = (L: number): [number, number] => place(FAN_EXIT.x + L * Math.cos(rad(FAN_DIR)), FAN_EXIT.y + L * Math.sin(rad(FAN_DIR)));
  return { place, alongFan, fan: FAN_DIR + heading };
}

function chain(o: ChainOptions): SceneElement[] {
  const { place, alongFan, fan } = chainPoints(o.origin, o.heading);
  const out: SceneElement[] = [];
  out.push(el('emitter', `${o.id}-emitter`, ...place(0, 0), o.heading, { pulse: 'drone', ...o.emitter }));
  out.push(el('prism', `${o.id}-prism`, ...place(7, 0), 70 + o.heading, { size: 4 }));
  if (o.modulator) {
    const { at, ...rest } = o.modulator;
    out.push(el('modulator', `${o.id}-mod`, ...place(3.5, 0), 0, rest));
    void at;
  }
  if (o.loom) {
    const { at, ...rest } = o.loom;
    out.push(el('loom', `${o.id}-loom`, ...alongFan(at), fan, rest));
  }
  if (o.lens) out.push(el('lens', `${o.id}-lens`, ...alongFan(o.lens.at), fan, { focal: o.lens.focal, aperture: o.lens.aperture }));
  const { at, tilt = 0, ...rp } = o.receptor;
  out.push(el('receptor', `${o.id}-receptor`, ...alongFan(at), fan + 180 + tilt, rp));
  return out;
}

/* ------------------------------------------------------------- Optics bench */

/** Centre of the light carousel: the spinning lens. */
const HUB = { x: 24, y: 14 };
/** Radius of the ring of stations around it. */
const RING = 10;

/**
 * A light carousel. Two spectrometers throw rainbows into a lens of very short focal length
 * that turns in the middle of the table; it flings the colours out in a wide spray that
 * sweeps round a ring of stations like a lighthouse. Each station is a colour filter in
 * front of a receptor with its own voice, so the spray plays whichever it sweeps across.
 */
export function lightCarousel(): SceneElement[] {
  const out: SceneElement[] = [];
  // Two rainbows aimed at the hub from opposite sides (the fan leaves at heading + FAN_DIR).
  for (const [id, side] of [['w', 0], ['e', 180]] as const) {
    const heading = side - FAN_DIR;
    const probe = chainPoints({ x: 0, y: 0 }, heading).alongFan(BENCH_LENS_AT);
    const origin = { x: HUB.x - probe[0], y: HUB.y - probe[1] };
    const { place } = chainPoints(origin, heading);
    out.push(el('emitter', `bench-${id}-lamp`, origin.x, origin.y, heading, { pulse: '1/4' }));
    out.push(el('prism', `bench-${id}-prism`, ...place(7, 0), 70 + heading, { size: 4 }));
  }
  out.push(el('lens', 'bench-lens', HUB.x, HUB.y, 135, { aperture: 5, focal: 0.5, motion: { kind: 'turn', degPerBar: 30 } }));
  for (const st of BENCH_STATIONS) {
    const a = rad(st.at);
    const face = st.at + 180;
    const r = { x: HUB.x + Math.cos(a) * RING, y: HUB.y + Math.sin(a) * RING };
    const inner = { x: HUB.x + Math.cos(a) * (RING - 1.2), y: HUB.y + Math.sin(a) * (RING - 1.2) };
    if (st.filter) out.push(el('filter', `bench-${st.id}-filter`, inner.x, inner.y, face, { length: 4.2, minNm: st.filter[0], maxNm: st.filter[1] }));
    if (st.comb) out.push(el('comb', `bench-${st.id}-comb`, inner.x, inner.y, face, { length: 4.2, fringes: st.comb, phase: 0.3 }));
    out.push(el('receptor', `bench-${st.id}`, r.x, r.y, face, { aperture: 4.5, octave: 4, span: 1, voices: 2, gain: 0.8, ...st.receptor }));
  }
  return out;
}

/** How far along its fan each rainbow meets the lens. */
const BENCH_LENS_AT = 6;

/**
 * The stations round the ring, by angle (degrees, 0 = east, counter-clockwise on the table).
 * The spinning lens throws each colour into its own sectors (the spray is point-symmetric),
 * so every filter sits where its colour sweeps by; angles near 0° and 180° are left to the
 * lamps' beams.
 */
const BENCH_STATIONS: {
  id: string;
  at: number;
  filter?: [number, number];
  comb?: number;
  receptor: Partial<ElementOf<'receptor'>>;
}[] = [
  { id: 'green', at: 30, filter: [495, 570], receptor: { instrument: 'bell', octave: 5 } },
  { id: 'blue', at: 60, filter: [440, 495], receptor: { instrument: 'pad', octave: 3, gain: 0.6 } },
  { id: 'violet', at: 90, filter: [380, 440], receptor: { instrument: 'drums', octave: 3, gain: 0.7 } },
  { id: 'red', at: 120, filter: [620, 720], receptor: { instrument: 'drums', octave: 3, gain: 0.9 } },
  { id: 'amber', at: 150, filter: [570, 620], receptor: { instrument: 'pluck', octave: 3 } },
  { id: 'comb', at: 210, comb: 6, receptor: { instrument: 'bell', octave: 4, span: 2, voices: 3 } },
  { id: 'catch', at: 255, receptor: { instrument: 'pluck', octave: 4, span: 2, voices: 3, gain: 0.6 } },
  { id: 'deep', at: 300, filter: [620, 720], receptor: { instrument: 'pad', octave: 2, gain: 0.7 } },
  { id: 'gold', at: 330, filter: [570, 620], receptor: { instrument: 'bell', octave: 4 } },
];

/** Parse several voices into one card, all in the same scale-degree space. */
export function card(scale: ScaleName, root: number, octave: number, ...voices: string[]): { notes: LoomNote[]; steps: number } {
  let steps = 0;
  const notes: LoomNote[] = [];
  for (const v of voices) {
    const p = parseVoice(v, scale, root, octave);
    notes.push(...p.notes);
    steps = Math.max(steps, p.length);
  }
  return { notes, steps };
}

/* ------------------------------------------------------ Gymnopédie No. 1 */

/*
 * Satie, 1888. 3/4, one step per quarter. Four bars of the G–D rocking accompaniment,
 * then the two opening phrases of the melody.
 */
const GYM_BASS = 'G2:3 | D2:3 | '.repeat(10);
const GYM_CHORDS = '-:1 [B3 D4 F#4]:2 | -:1 [A3 C#4 F#4]:2 | '.repeat(10);
const GYM_MELODY =
  '-:12 | ' +
  '-:1 F#5:1 A5:1 | G5:1 F#5:1 C#5:1 | B4:1 C#5:1 D5:1 | A4:3 | F#4:12 | ' +
  '-:1 F#5:1 A5:1 | G5:1 F#5:1 C#5:1 | B4:1 C#5:1 D5:1 | A4:3 | C#5:3 | F#5:3 | E5:6 |';
const gymAccomp = card('major', D, 2, GYM_BASS, GYM_CHORDS);
const gymMelody = card('major', D, 4, GYM_MELODY);

/** Build a light path that bounces between mirrors: returns the mirrors and the end pose. */
function mirrorPath(start: Vec2, legs: { heading: number; length: number }[], mirrorLength: number, idPrefix: string): { mirrors: SceneElement[]; end: Vec2; heading: number } {
  const mirrors: SceneElement[] = [];
  let p = { ...start };
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i]!;
    p = { x: p.x + Math.cos(rad(leg.heading)) * leg.length, y: p.y + Math.sin(rad(leg.heading)) * leg.length };
    const next = legs[i + 1];
    if (!next) break;
    // The mirror's normal bisects the turn: it points along (out − in).
    const nx = Math.cos(rad(next.heading)) - Math.cos(rad(leg.heading));
    const ny = Math.sin(rad(next.heading)) - Math.sin(rad(leg.heading));
    mirrors.push(el('mirror', `${idPrefix}-${i + 1}`, p.x, p.y, (Math.atan2(ny, nx) * 180) / Math.PI, { length: mirrorLength, reflectance: 0.96 }));
  }
  return { mirrors, end: p, heading: legs[legs.length - 1]!.heading };
}

function gymnopedie(): SceneElement[] {
  // Melody: emitter → prism → loom card → lens that collimates the fan into a parallel
  // rainbow ribbon → four mirrors → bell receptor.
  const M = chainPoints({ x: 3, y: 3 }, 62);
  const lensAt = M.alongFan(8);
  const ribbon = mirrorPath(
    { x: lensAt[0], y: lensAt[1] },
    [
      { heading: 22, length: 11 },
      { heading: -70, length: 10 },
      { heading: 20, length: 9 },
      { heading: 75, length: 8.5 },
    ],
    6.5,
    'gym-mirror',
  );
  return [
    el('emitter', 'gym-melody-emitter', 3, 3, 62, { pulse: 'drone' }),
    el('prism', 'gym-melody-prism', ...M.place(7, 0), 70 + 62, { size: 4 }),
    el('loom', 'gym-melody-loom', ...M.alongFan(4), M.fan, { length: 3, subdivision: '1/4', title: 'Gymnopédie — melody', depth: 0.9, ...gymMelody }),
    el('lens', 'gym-lens', ...lensAt, M.fan, { focal: 9, aperture: 5 }),
    ...ribbon.mirrors,
    // A little past the ribbon's end: the melody's light arrives clearly on the bar line, not
    // halfway between two sixteenths (where laying out the score could snap it either way).
    el('receptor', 'gym-melody-receptor', ribbon.end.x + Math.cos(rad(ribbon.heading)) * 0.4, ribbon.end.y + Math.sin(rad(ribbon.heading)) * 0.4, ribbon.heading + 180, { aperture: 6.5, instrument: 'bell', octave: 4, span: 2, voices: 2, gain: 0.85 }),
    ...chain({
      id: 'gym-accomp',
      origin: { x: 3, y: 22 },
      heading: 30,
      loom: { at: 4.5, length: 3.2, subdivision: '1/4', title: 'Gymnopédie — accompaniment', ...gymAccomp },
      receptor: { at: 12, tilt: 12, aperture: 7, instrument: 'pad', octave: 2, span: 3, voices: 4, gain: 0.7 },
    }),
  ];
}

/* ------------------------------------------------------------- Afterglow */

/*
 * An original four-bar loop (Am–F–C–G, 100 BPM, sixteenth steps), played twice: the second
 * time the bells come in. Four spectrometers in a diamond: drums, bass, chords, melody.
 */
const kit = (rows: Record<number, string>, bars: number): LoomNote[] =>
  Array.from({ length: bars }, (_, b) =>
    Object.entries(rows).flatMap(([deg, pattern]) =>
      [...pattern].flatMap((ch, at) => (ch === 'x' ? [{ at: b * 16 + at, deg: Number(deg), len: 1 }] : [])),
    ),
  ).flat();

const AG_GROOVE_A = { 0: 'x.......x.x.....', 3: '....x.......x...', 4: 'x.x.x.x.x.x.x.x.' };
const AG_GROOVE_B = { 0: 'x.......x.x...x.', 2: '....x.......x...', 4: 'x.xxx.x.x.xxx.x.', 5: '..............x.' };
const agDrums = [...kit(AG_GROOVE_A, 4), ...kit(AG_GROOVE_B, 4).map((n) => ({ ...n, at: n.at + 64 }))];
const agBassBar = (a: string, b: string): string => `${a}:3 ${a}:3 ${b}:2 ${a}:3 ${a}:3 ${b}:2 |`;
const AG_BASS = (agBassBar('A2', 'A2') + agBassBar('F2', 'F2') + agBassBar('C3', 'C3') + agBassBar('G2', 'B2')).repeat(2);
const AG_CHORDS = '[A3 C4 E4]:16 | [F3 A3 C4]:16 | [G3 C4 E4]:16 | [G3 B3 D4]:16 |'.repeat(2);
const AG_MELODY =
  '-:64 | E5:4 D5:2 C5:2 -:2 A4:4 -:2 | C5:4 A4:2 G4:2 -:2 A4:6 | G4:2 A4:2 C5:4 D5:2 E5:6 | D5:6 C5:2 B4:4 -:4 |';

function afterglow(): SceneElement[] {
  return [
    ...chain({
      id: 'ag-drums',
      origin: { x: 2, y: 12 },
      heading: 0,
      loom: { at: 4.5, length: 3.2, subdivision: '1/16', title: 'Afterglow — drums', steps: 128, notes: agDrums },
      receptor: { at: 12, aperture: 7, instrument: 'drums', octave: 3, span: 1, voices: 4, gain: 0.9 },
    }),
    ...chain({
      id: 'ag-bass',
      origin: { x: 2, y: 26 },
      heading: 0,
      loom: { at: 4.5, length: 3.2, subdivision: '1/16', title: 'Afterglow — bass', ...card('major', 0, 2, AG_BASS) },
      receptor: { at: 12, aperture: 7, instrument: 'pluck', octave: 2, span: 2, voices: 1, gain: 0.95 },
    }),
    ...chain({
      id: 'ag-chords',
      origin: { x: 46, y: 2 },
      heading: 180,
      loom: { at: 4.5, length: 3.2, subdivision: '1/16', title: 'Afterglow — chords', ...card('major', 0, 3, AG_CHORDS) },
      receptor: { at: 12, tilt: 12, aperture: 7, instrument: 'pad', octave: 3, span: 2, voices: 3, gain: 0.6 },
    }),
    ...chain({
      id: 'ag-melody',
      origin: { x: 46, y: 16 },
      heading: 180,
      loom: { at: 4.5, length: 3.2, subdivision: '1/16', title: 'Afterglow — bells', ...card('major', 0, 4, AG_MELODY) },
      receptor: { at: 12, aperture: 7, instrument: 'bell', octave: 4, span: 2, voices: 2, gain: 0.8 },
    }),
  ];
}

/* ------------------------------------------------------------- Euclid kit */

function euclidKit(): SceneElement[] {
  // Three coloured beams, each re-timed by its own Euclidean ring, land on one drum
  // receptor. On a drum receptor colour picks the drum: red kick, green snare, blue hat.
  const beams: [string, number, number, Partial<ElementOf<'modulator'>>][] = [
    ['kick', 9, 665, { steps: 16, hits: 4, rotate: 0, subdivision: '1/16', depth: 0.9 }],
    ['snare', 14, 530, { steps: 8, hits: 2, rotate: 2, subdivision: '1/8', depth: 0.9 }],
    ['hat', 19, 455, { steps: 16, hits: 11, rotate: 1, subdivision: '1/16', depth: 0.7 }],
  ];
  const out: SceneElement[] = [];
  for (const [name, y, nm, mod] of beams) {
    out.push(el('emitter', `ek-${name}`, 3, y, 0, { pulse: 'drone', spectrum: { kind: 'band', minNm: nm - 12, maxNm: nm + 12 } }));
    out.push(el('modulator', `ek-${name}-mod`, 10, y, 0, mod));
  }
  out.push(el('receptor', 'ek-kit', 30, 14, 180, { aperture: 13, instrument: 'drums', octave: 3, span: 1, voices: 3, gain: 0.95 }));
  // A white drone split into a soft chord for colour behind the groove.
  out.push(
    ...chain({
      id: 'ek-pad',
      origin: { x: 3, y: 26.5 },
      heading: 0,
      loom: { at: 4.5, length: 3.2, subdivision: '1/4', title: 'Euclid kit — pad', ...card('minorPent', 9, 2, '[A2 E3 A3]:8 | [C3 G3 C4]:8 |') },
      receptor: { at: 12, tilt: 18, aperture: 7, instrument: 'pad', octave: 2, span: 2, voices: 3, gain: 0.45 },
    }),
  );
  return out;
}

/* ------------------------------------------------------------- Dub corridor */

/** The stab's colour: E5, the fifth of A minor, on the floor receptor (octave 4, one octave span). */
const DUB_STAB_NM = degreeToWavelength(4, { scale: 'minor', span: 1 });

const DUB_BASS =
  'A1:3 -:1 A1:1 -:1 C2:2 | A1:3 -:1 E2:2 A1:2 | D2:3 -:1 D2:1 -:1 F2:2 | D2:3 -:1 A2:2 E2:2 |';

/**
 * Dub techno: a drum kit of three coloured beams (as in Euclid kit), a pad chord glass, a
 * bass card, and the echo corridor of mirrors that turns syncopated stabs into dub delays.
 */
function dubCorridor(): SceneElement[] {
  const out: SceneElement[] = [];
  // Drums, top left: kick on every beat, clap on 2 and 4, hats on the off-beats.
  const kit: [string, number, number, Partial<ElementOf<'modulator'>>][] = [
    ['kick', 2.5, 665, { steps: 16, hits: 4, rotate: 0, subdivision: '1/16', depth: 0.95 }],
    ['clap', 4.5, 560, { steps: 8, hits: 2, rotate: 2, subdivision: '1/8', depth: 0.6 }],
    ['hat', 6.5, 455, { steps: 16, hits: 4, rotate: 2, subdivision: '1/16', depth: 0.55 }],
  ];
  for (const [name, y, nm, mod] of kit) {
    out.push(el('emitter', `dub-${name}`, 2, y, 0, { pulse: 'drone', spectrum: { kind: 'band', minNm: nm - 12, maxNm: nm + 12 } }));
    out.push(el('modulator', `dub-${name}-mod`, 5, y, 0, mod));
  }
    // Eight cells from the rings: two beats of light, so the kick lands on the beat.
  out.push(el('receptor', 'dub-kit', 13, 4.5, 180, { aperture: 6, instrument: 'drums', octave: 3, span: 1, voices: 3, gain: 0.9 }));
  // Bass: a card across its own rainbow.
  out.push(
    ...chain({
      id: 'dub-bass',
      origin: { x: 2, y: 12 },
      heading: 0,
      loom: { at: 4.5, length: 3.2, subdivision: '1/8', title: 'Dub corridor — bass', ...card('minor', 9, 1, DUB_BASS) },
      // Eight cells behind the card, like the drums: two beats late, on the grid.
      receptor: { at: 12.5, aperture: 7, instrument: 'pluck', octave: 1, span: 2, voices: 1, gain: 0.85 },
    }),
  );
  // Pad chords: a white drone split by a prism, a chord glass holding Am, then Dm.
  const pad = chainPoints({ x: 20, y: 13 }, 0);
  out.push(
    el('emitter', 'dub-pad-lamp', 20, 13, 0, { pulse: 'drone', intensity: 0.9 }),
    el('prism', 'dub-pad-prism', ...pad.place(7, 0), 70, { size: 4 }),
    el('chord', 'dub-pad-glass', ...pad.alongFan(5), pad.fan, { length: 4.5, progression: 'drift', beatsPerChord: 8, rhythm: 'hold' }),
    el('receptor', 'dub-pad', ...pad.alongFan(13), pad.fan + 180, { aperture: 7, instrument: 'pad', octave: 3, span: 1, voices: 3, gain: 0.5 }),
  );
  // The echo corridor along the bottom: syncopated teal stabs, each bounce leaking to the floor.
  out.push(
    el('emitter', 'dub-stab', 2.5, 19.5, 58, { pulse: '1/16', spectrum: { kind: 'band', minNm: DUB_STAB_NM - 8, maxNm: DUB_STAB_NM + 8 } }),
    el('modulator', 'dub-stab-mod', 4, 22, 0, { steps: 16, hits: 3, rotate: 3, subdivision: '1/16', depth: 0.85 }),
    el('mirror', 'dub-top', 24, 17, 90, { length: 44, reflectance: 0.96 }),
    el('mirror', 'dub-splitter', 24, 23.5, -90, { length: 44, reflectance: 0.62, splitter: true }),
    el('receptor', 'dub-floor', 24, 27, -90, { aperture: 44, instrument: 'bell', octave: 4, span: 1, voices: 2, gain: 0.75 }),
  );
  return out;
}

export interface DemoScene {
  id: string;
  title: string;
  subtitle: string;
  blurb: string;
  /** The scene to play: cards cut into slots where their colours cross them (built on first use). */
  readonly scene: SceneModel;
  /** As written: cards hold pitches, not cut yet (how the scores are easiest to author). */
  authored: SceneModel;
}

/** A demo as written, played as the light plays it: cards are cut once, on first use. */
function demo(d: Omit<DemoScene, 'scene'>): DemoScene {
  let cut: SceneModel | null = null;
  return {
    ...d,
    get scene(): SceneModel {
      cut ??= layOutScore(d.authored);
      return cut;
    },
  };
}

function scene(name: string, elements: SceneElement[], settings: Partial<SceneModel['settings']> = {}): SceneModel {
  return { version: 1, name, table: { ...DEFAULT_TABLE }, settings: { ...DEFAULT_SETTINGS, ...settings }, elements };
}

/* ------------------------------------------------------------------ Ode to Joy */

const ODE_A = 'F#4:2 F#4:2 G4:2 A4:2 | A4:2 G4:2 F#4:2 E4:2 | D4:2 D4:2 E4:2 F#4:2 | F#4:3 E4:1 E4:4 |';
const ODE_A2 = 'F#4:2 F#4:2 G4:2 A4:2 | A4:2 G4:2 F#4:2 E4:2 | D4:2 D4:2 E4:2 F#4:2 | E4:3 D4:1 D4:4 |';
const ODE_B = 'E4:2 E4:2 F#4:2 D4:2 | E4:2 F#4:1 G4:1 F#4:2 D4:2 | E4:2 F#4:1 G4:1 F#4:2 E4:2 | D4:2 E4:2 A3:4 |';
const I = '[D2 A2 F#3 A3]';
const V = '[A2 E3 A3 C#4]';
const ODE_CHORDS_A = `${I}:8 | ${V}:8 | ${I}:8 | ${V}:8 |`;
const ODE_CHORDS_A2 = `${I}:8 | ${V}:8 | ${I}:8 | ${V}:4 ${I}:4 |`;
const ODE_CHORDS_B = `${V}:8 | ${V}:4 ${I}:4 | ${V}:8 | ${I}:4 ${V}:4 |`;

const odeMelody = card('major', D, 3, ODE_A + ODE_A2 + ODE_B + ODE_A2);
const odeChords = card('major', D, 2, ODE_CHORDS_A + ODE_CHORDS_A2 + ODE_CHORDS_B + ODE_CHORDS_A2);

/* ------------------------------------------------------------- Canon in D */

const CANON_CHORDS = '[D2 A2 F#3 A3]:4 [A2 E3 A3 C#4]:4 [B2 D3 F#3 B3]:4 [F#2 C#3 F#3 A3]:4 | [G2 D3 G3 B3]:4 [D2 A2 F#3 A3]:4 [G2 D3 G3 B3]:4 [A2 E3 A3 C#4]:4 |';
const CANON_MELODY = [
  '-:32',
  'F#5:4 E5:4 D5:4 C#5:4 | B4:4 A4:4 B4:4 C#5:4 |',
  'D5:4 C#5:4 B4:4 A4:4 | G4:4 F#4:4 G4:4 E4:4 |',
  'D5:2 F#5:2 A5:2 G5:2 F#5:2 D5:2 F#5:2 E5:2 | D5:2 B4:2 D5:2 A5:2 G5:2 B5:2 A5:2 G5:2 |',
  'F#5:2 D5:2 E5:2 C#6:2 D6:2 F#5:2 A5:2 A5:2 | B5:2 G5:2 A5:2 F#5:2 D5:2 D6:3 C#6:1 D6:4 |',
].join(' ');
const canonChords = card('major', D, 2, CANON_CHORDS.repeat(5));
const canonMelody = card('major', D, 4, CANON_MELODY);

/* ------------------------------------------------------- Prelude in C, BWV 846 */

const bar = (a: string, b: string, c: string, d: string, e: string): string => `${a} ${b} ${c} ${d} ${e} ${c} ${d} ${e} `.repeat(2) + '| ';
const PRELUDE =
  bar('C4', 'E4', 'G4', 'C5', 'E5') +
  bar('C4', 'D4', 'A4', 'D5', 'F5') +
  bar('B3', 'D4', 'G4', 'D5', 'F5') +
  bar('C4', 'E4', 'G4', 'C5', 'E5') +
  bar('C4', 'E4', 'A4', 'E5', 'A5') +
  bar('C4', 'D4', 'F4', 'A4', 'D5') +
  bar('B3', 'D4', 'G4', 'D5', 'G5') +
  bar('C4', 'E4', 'G4', 'C5', 'E5');
const PRELUDE_BASS = '[C2 C3]:16 | [C2 D3]:16 | [B1 D3]:16 | [C2 E3]:16 | [A1 E3]:16 | [D2 A2]:16 | [G1 D3]:16 | [C2 G2]:16 |';
const preludeArp = card('major', 0, 3, PRELUDE);
const preludeBass = card('major', 0, 1, PRELUDE_BASS);

export const DEMO_SCENES: DemoScene[] = (
  [
  {
    id: 'afterglow',
    title: 'Afterglow',
    subtitle: 'original · with drums',
    blurb: 'Four spectrometers in a diamond: a drum kit (colour picks the drum), bass, chords, and bells that join on the second pass. Select a loom card to rewrite any part.',
    authored: scene('Afterglow', afterglow(), { bpm: 100, scale: 'major', root: 0, quantize: 1, raysPerSplit: 28 }),
  },
  {
    id: 'gymnopedie',
    title: 'Gymnopédie No. 1',
    subtitle: 'Erik Satie',
    blurb: 'A lens straightens the melody’s rainbow into a ribbon that folds across the table on four mirrors; the rocking chords strum below.',
    authored: scene('Gymnopédie No. 1', gymnopedie(), { bpm: 76, beatsPerBar: 3, scale: 'major', root: D, quantize: 1, raysPerSplit: 28 }),
  },
  {
    id: 'ode',
    title: 'Ode to Joy',
    subtitle: 'Beethoven · Symphony No. 9',
    blurb: 'Two spectrometers facing each other. Punched loom cards pick which colours swell; each colour is a note.',
    authored: scene(
      'Ode to Joy',
      [
        ...chain({
          id: 'harmony',
          origin: { x: 2, y: 25.5 },
          heading: 0,
          loom: { at: 4.5, length: 3.2, subdivision: '1/8', title: 'Ode — harmony', ...odeChords },
          receptor: { at: 12, tilt: 14, aperture: 7, instrument: 'pad', octave: 2, span: 2, voices: 4, gain: 0.75 },
        }),
        ...chain({
          id: 'melody',
          origin: { x: 46, y: 2.5 },
          heading: 180,
          loom: { at: 4.5, length: 3.2, subdivision: '1/8', title: 'Ode — melody', ...odeMelody },
          receptor: { at: 12, aperture: 7, instrument: 'pluck', octave: 3, span: 2, voices: 2, gain: 0.95 },
        }),
      ],
      { bpm: 104, scale: 'major', root: D, quantize: 1, raysPerSplit: 28 },
    ),
  },
  {
    id: 'canon',
    title: 'Canon in D',
    subtitle: 'Pachelbel',
    blurb: 'The ground bass and its chords strum across a tilted receptor; the violin line rings on a bell.',
    authored: scene(
      'Canon in D',
      [
        ...chain({
          id: 'ground',
          origin: { x: 2, y: 24 },
          heading: 0,
          loom: { at: 4.5, length: 3.2, subdivision: '1/8', title: 'Canon — ground', ...canonChords },
          receptor: { at: 12.5, tilt: 22, aperture: 7.5, instrument: 'pad', octave: 2, span: 2, voices: 4, gain: 0.7 },
        }),
        ...chain({
          id: 'violin',
          origin: { x: 24, y: 24 },
          heading: -20,
          loom: { at: 4.5, length: 3.2, subdivision: '1/8', title: 'Canon — violin', ...canonMelody },
          receptor: { at: 12.5, aperture: 7, instrument: 'bell', octave: 4, span: 3, voices: 2, gain: 0.8 },
        }),
      ],
      { bpm: 68, scale: 'major', root: D, quantize: 1, raysPerSplit: 28 },
    ),
  },
  {
    id: 'prelude',
    title: 'Prelude in C',
    subtitle: 'J. S. Bach · BWV 846',
    blurb: 'Broken chords walk up the spectrum, red to violet, and a lens gathers them into one white point.',
    authored: scene(
      'Prelude in C',
      [
        ...chain({
          id: 'arp',
          origin: { x: 3, y: 14 },
          heading: 12,
          loom: { at: 4, length: 3, subdivision: '1/16', title: 'Prelude — arpeggio', ...preludeArp },
          lens: { at: 8, focal: 2.9, aperture: 4.5 },
          receptor: { at: 12.2, aperture: 2, instrument: 'pluck', octave: 3, span: 3, voices: 1, gain: 0.9 },
        }),
        ...chain({
          id: 'bass',
          origin: { x: 24, y: 26 },
          heading: -8,
          loom: { at: 4.5, length: 3.2, subdivision: '1/16', title: 'Prelude — bass', ...preludeBass },
          receptor: { at: 12, aperture: 7, instrument: 'pad', octave: 1, span: 3, voices: 2, gain: 0.6 },
        }),
      ],
      { bpm: 66, scale: 'major', root: 0, quantize: 1, raysPerSplit: 32 },
    ),
  },
  {
    id: 'strum',
    title: 'Prism strum',
    subtitle: 'generative',
    blurb: 'One white pulse per beat. The receptor is tilted across the rainbow, so red arrives before violet: a strum made of path length. Try moving the receptor or changing the speed of light.',
    authored: scene(
      'Prism strum',
      [
        ...chain({
          id: 'strum',
          origin: { x: 3, y: 22 },
          heading: 0,
          emitter: { pulse: '1/4' },
          modulator: { at: 3.5, steps: 8, hits: 5, rotate: 0, subdivision: '1/8', depth: 0.7 },
          receptor: { at: 14, tilt: 30, aperture: 7, instrument: 'pluck', octave: 3, span: 1, voices: 4, gain: 0.8 },
        }),
        el('emitter', 'drone', 3, 5, 0, { pulse: 'drone', spectrum: { kind: 'band', minNm: 600, maxNm: 680 }, intensity: 0.8 }),
        el('mirror', 'drone-mirror', 30, 5, 135, { length: 3 }),
        el('receptor', 'drone-receptor', 30, 20, -90, { aperture: 2, instrument: 'pad', octave: 2, span: 1, voices: 1, gain: 0.5 }),
      ],
      { bpm: 92, scale: 'majorPent', root: 9, quantize: 0.4 },
    ),
  },
  {
    id: 'echo',
    title: 'Dub corridor',
    subtitle: 'generative · electronic',
    blurb: 'Night-bus dub techno made of light. Three coloured beams, each re-timed by a Euclidean ring, drum four to the floor; a chord glass holds Am and Dm on a pad; a card plays the bass. Below, a mirror and a beam splitter form a corridor: every bounce leaks a little light to the floor, so each stab comes back as a dub echo, quieter and later by exactly the extra path.',
    authored: scene('Dub corridor', dubCorridor(), { bpm: 118, scale: 'minor', root: 9, quantize: 1 }),
  },
  {
    id: 'poly',
    title: 'Three against five',
    subtitle: 'generative',
    blurb: 'Two Euclidean modulators — 3 in 8 and 5 in 16 — share one white beam through a splitter, then each fan plays its own voice.',
    authored: scene(
      'Three against five',
      [
        el('emitter', 'e', 2.5, 14, 0, { pulse: '1/16' }),
        el('mirror', 'split', 9, 14, -135, { length: 2.5, reflectance: 0.5, splitter: true }),
        el('modulator', 'm3', 13, 14, 0, { steps: 8, hits: 3, subdivision: '1/8', depth: 0.8 }),
        el('prism', 'p1', 18, 14, 70, { size: 3.5 }),
        el('receptor', 'r1', 30, 4.5, 140.5 + 25, { aperture: 6, instrument: 'pluck', octave: 4, span: 1, voices: 3 }),
        el('modulator', 'm5', 9, 9, 0, { steps: 16, hits: 5, subdivision: '1/16', depth: 0.8 }),
        el('mirror', 'fold', 9, 4, 135 - 90, { length: 2.5 }),
        el('prism', 'p2', 16, 4, -70, { size: 3.5 }),
        el('receptor', 'r2', 28.2, 14.4, 219.5, { aperture: 6, instrument: 'bell', octave: 5, span: 1, voices: 2 }),
        el('emitter', 'drone', 3, 25, 0, { pulse: 'drone', spectrum: { kind: 'band', minNm: 540, maxNm: 620 }, intensity: 0.7 }),
        el('receptor', 'r3', 45, 25, 180, { aperture: 2, instrument: 'pad', octave: 2, span: 1, voices: 1, gain: 0.5 }),
      ],
      { bpm: 108, scale: 'dorian', root: 2, quantize: 0.6 },
    ),
  },
  {
    id: 'euclid',
    title: 'Euclid kit',
    subtitle: 'generative · drums',
    blurb: 'Red, green and blue beams, each re-timed by a Euclidean ring (4 in 16, 2 in 8, 11 in 16), hit one drum receptor: red is the kick, green the snare, blue the hats. Change a ring’s hits to change the groove.',
    authored: scene('Euclid kit', euclidKit(), { bpm: 96, scale: 'minorPent', root: 9, quantize: 1 }),
  },
  {
    id: 'bench',
    title: 'Optics bench',
    subtitle: 'sandbox · light carousel',
    blurb: 'Two rainbows pour into a lens of very short focal length that spins in the middle of the table, flinging colour all round like a lighthouse. A ring of coloured filters, a comb and bare catchers plays whatever the spray sweeps across: drums, bells, pads. Stop the lens (Motion → Still) and turn it by hand.',
    authored: scene('Optics bench', lightCarousel(), { bpm: 104, scale: 'majorPent', root: 0, quantize: 1, c: 8 }),
  },
  ] as Omit<DemoScene, 'scene'>[]
).map(demo);
