import { parseVoice } from '../../music/notation';
import { DEFAULT_SETTINGS, DEFAULT_TABLE, PARAMS } from '../defaults';
import type { ElementKind, ElementOf, LoomNote, ScaleName, SceneElement, SceneModel, Subdivision, Vec2 } from '../types';

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Deterministic element builder for hand-authored demo scenes. */
function el<K extends ElementKind>(kind: K, id: string, x: number, y: number, rotDeg: number, params: Partial<ElementOf<K>> = {}): ElementOf<K> {
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

function chain(o: ChainOptions): SceneElement[] {
  const c = Math.cos(rad(o.heading));
  const s = Math.sin(rad(o.heading));
  const place = (lx: number, ly: number): [number, number] => [o.origin.x + lx * c - ly * s, o.origin.y + lx * s + ly * c];
  const alongFan = (L: number): [number, number] => place(FAN_EXIT.x + L * Math.cos(rad(FAN_DIR)), FAN_EXIT.y + L * Math.sin(rad(FAN_DIR)));
  const fan = FAN_DIR + o.heading;
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

/** Parse several voices into one card, all in the same scale-degree space. */
function card(scale: ScaleName, root: number, octave: number, ...voices: string[]): { notes: LoomNote[]; steps: number } {
  let steps = 0;
  const notes: LoomNote[] = [];
  for (const v of voices) {
    const p = parseVoice(v, scale, root, octave);
    notes.push(...p.notes);
    steps = Math.max(steps, p.length);
  }
  return { notes, steps };
}

export interface DemoScene {
  id: string;
  title: string;
  subtitle: string;
  blurb: string;
  scene: SceneModel;
}

function scene(name: string, elements: SceneElement[], settings: Partial<SceneModel['settings']> = {}): SceneModel {
  return { version: 1, name, table: { ...DEFAULT_TABLE }, settings: { ...DEFAULT_SETTINGS, ...settings }, elements };
}

/* ------------------------------------------------------------------ Ode to Joy */

const D = 2;
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

export const DEMO_SCENES: DemoScene[] = [
  {
    id: 'ode',
    title: 'Ode to Joy',
    subtitle: 'Beethoven · Symphony No. 9',
    blurb: 'Two spectrometers facing each other. Punched loom cards pick which colours swell; each colour is a note.',
    scene: scene(
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
    scene: scene(
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
    scene: scene(
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
    scene: scene(
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
    title: 'Echo corridor',
    subtitle: 'generative',
    blurb: 'A mirror and a beam splitter form a corridor. Every bounce leaks a little light to the receptor below: echoes, each quieter, each later by exactly the extra path.',
    scene: scene(
      'Echo corridor',
      [
        el('emitter', 'e', 2.5, 12.5, 58, { pulse: '1/4', spectrum: { kind: 'band', minNm: 440, maxNm: 520 } }),
        el('modulator', 'mod', 4, 15, 0, { steps: 8, hits: 3, subdivision: '1/8', depth: 0.8 }),
        el('mirror', 'top', 24, 10, 90, { length: 44, reflectance: 0.96 }),
        el('mirror', 'bottom', 24, 16.5, -90, { length: 44, reflectance: 0.62, splitter: true }),
        el('receptor', 'floor', 24, 23, -90, { aperture: 44, instrument: 'bell', octave: 4, span: 1, voices: 2, gain: 0.9 }),
      ],
      { bpm: 84, scale: 'minorPent', root: 4, quantize: 0.85 },
    ),
  },
  {
    id: 'poly',
    title: 'Three against five',
    subtitle: 'generative',
    blurb: 'Two Euclidean modulators — 3 in 8 and 5 in 16 — share one white beam through a splitter, then each fan plays its own voice.',
    scene: scene(
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
    id: 'bench',
    title: 'Optics bench',
    subtitle: 'sandbox',
    blurb: 'No music yet: a prism fans white light into a rainbow, a lens folds it back to white, and a second prism turns light around by total internal reflection.',
    scene: scene('Optics bench', [
      el('emitter', 'e1', 3, 20, 0),
      el('prism', 'p1', 10, 20, 70, { size: 4 }),
      el('lens', 'l1', 22, 11, -39.5, { aperture: 6, focal: 5 }),
      el('emitter', 'e2', 20, 25, 0, { spectrum: { kind: 'band', minNm: 560, maxNm: 640 } }),
      el('prism', 'p2', 30, 25, 120, { size: 3.5 }),
    ]),
  },
];
