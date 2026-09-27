import { isSingleChord, PROGRESSIONS } from '../music/chords';
import { NOTE_NAMES } from '../music/scales';
import type { ElementKind, GlobalSettings, SceneElement } from '../scene/types';

export type FieldValue = number | string | boolean;

interface FieldBase<T> {
  key: string;
  label: string;
  /** Plain-language explanation shown behind the "?" next to the label. */
  help?: string;
  get(target: T): FieldValue;
  set(target: T, v: FieldValue): void;
  /** Hide the field for this target (e.g. band limits on a white emitter). */
  hidden?(target: T): boolean;
}

export type Field<T> = FieldBase<T> &
  (
    | { kind: 'range'; min: number; max: number; step: number; format?: (v: number) => string }
    | { kind: 'select'; options: [string, string][] }
    | { kind: 'toggle' }
  );

const deg = (rad: number): number => Math.round(((rad * 180) / Math.PI + 360) % 360);

/** Simple numeric property field on an element of kind K. */
function num(
  key: string,
  label: string,
  min: number,
  max: number,
  step: number,
  format?: (v: number) => string,
): Field<SceneElement> {
  return {
    key,
    label,
    kind: 'range',
    min,
    max,
    step,
    format,
    get: (el) => (el as unknown as Record<string, number>)[key]!,
    set: (el, v) => ((el as unknown as Record<string, number>)[key] = Number(v)),
  };
}

function sel(key: string, label: string, options: [string, string][]): Field<SceneElement> {
  return {
    key,
    label,
    kind: 'select',
    options,
    get: (el) => String((el as unknown as Record<string, unknown>)[key]),
    set: (el, v) => ((el as unknown as Record<string, unknown>)[key] = v),
  };
}

const rotation: Field<SceneElement> = {
  key: 'rotation',
  label: 'Rotation',
  kind: 'range',
  min: 0,
  max: 359,
  step: 1,
  format: (v) => `${v}°`,
  get: (el) => deg(el.rotation),
  set: (el, v) => (el.rotation = (Number(v) * Math.PI) / 180),
};

/** Clockwork fields: any element that has a direction can turn or swing by itself. */
const motionFields: Field<SceneElement>[] = [
  {
    key: 'motion',
    label: 'Motion',
    kind: 'select',
    options: [
      ['none', 'Still'],
      ['swing', 'Swing'],
      ['turn', 'Turn'],
    ],
    get: (el) => el.motion?.kind ?? 'none',
    set: (el, v) => {
      if (v === 'turn') el.motion = { kind: 'turn', degPerBar: 6 };
      else if (v === 'swing') el.motion = { kind: 'swing', degrees: 6, bars: 4 };
      else delete el.motion;
    },
  },
  {
    key: 'motionSwing',
    label: 'Swing',
    kind: 'range',
    min: 1,
    max: 45,
    step: 0.5,
    format: (v) => `±${v}°`,
    hidden: (el) => el.motion?.kind !== 'swing',
    get: (el) => (el.motion?.kind === 'swing' ? el.motion.degrees : 6),
    set: (el, v) => {
      if (el.motion?.kind === 'swing') el.motion.degrees = Number(v);
    },
  },
  {
    key: 'motionBars',
    label: 'Swing period',
    kind: 'range',
    min: 1,
    max: 32,
    step: 1,
    format: (v) => `${v} bar${v === 1 ? '' : 's'}`,
    hidden: (el) => el.motion?.kind !== 'swing',
    get: (el) => (el.motion?.kind === 'swing' ? el.motion.bars : 4),
    set: (el, v) => {
      if (el.motion?.kind === 'swing') el.motion.bars = Number(v);
    },
  },
  {
    key: 'motionSpeed',
    label: 'Turn speed',
    kind: 'range',
    min: -45,
    max: 45,
    step: 0.5,
    format: (v) => `${v > 0 ? '+' : ''}${v}°/bar`,
    hidden: (el) => el.motion?.kind !== 'turn',
    get: (el) => (el.motion?.kind === 'turn' ? el.motion.degPerBar : 6),
    set: (el, v) => {
      if (el.motion?.kind === 'turn') el.motion.degPerBar = Number(v);
    },
  },
];

const nm = (v: number): string => `${Math.round(v)} nm`;
const pct = (v: number): string => `${Math.round(v * 100)}%`;
const cells = (v: number): string => `${v.toFixed(1)} u`;

export const ELEMENT_FIELDS: Record<ElementKind, Field<SceneElement>[]> = {
  emitter: [
    rotation,
    {
      key: 'spectrum',
      label: 'Spectrum',
      kind: 'select',
      options: [
        ['white', 'White'],
        ['band', 'Band'],
      ],
      get: (el) => (el.kind === 'emitter' ? el.spectrum.kind : 'white'),
      set: (el, v) => {
        if (el.kind !== 'emitter') return;
        el.spectrum = v === 'white' ? { kind: 'white' } : { kind: 'band', minNm: 520, maxNm: 620 };
      },
    },
    {
      key: 'bandMin',
      label: 'Band from',
      kind: 'range',
      min: 400,
      max: 690,
      step: 5,
      format: nm,
      hidden: (el) => el.kind !== 'emitter' || el.spectrum.kind === 'white',
      get: (el) => (el.kind === 'emitter' && el.spectrum.kind === 'band' ? el.spectrum.minNm : 400),
      set: (el, v) => {
        if (el.kind === 'emitter' && el.spectrum.kind === 'band') {
          el.spectrum.minNm = Math.min(Number(v), el.spectrum.maxNm - 10);
        }
      },
    },
    {
      key: 'bandMax',
      label: 'Band to',
      kind: 'range',
      min: 410,
      max: 700,
      step: 5,
      format: nm,
      hidden: (el) => el.kind !== 'emitter' || el.spectrum.kind === 'white',
      get: (el) => (el.kind === 'emitter' && el.spectrum.kind === 'band' ? el.spectrum.maxNm : 700),
      set: (el, v) => {
        if (el.kind === 'emitter' && el.spectrum.kind === 'band') {
          el.spectrum.maxNm = Math.max(Number(v), el.spectrum.minNm + 10);
        }
      },
    },
    num('intensity', 'Intensity', 0.1, 1, 0.05, pct),
    sel('pulse', 'Pulse', [
      ['drone', 'Drone'],
      ['1/4', '1/4'],
      ['1/8', '1/8'],
      ['1/16', '1/16'],
    ]),
  ],
  prism: [rotation, num('size', 'Size', 1.5, 6, 0.5, cells), num('dispersion', 'Dispersion', 0.5, 2, 0.05, (v) => `${v.toFixed(2)}×`)],
  mirror: [
    rotation,
    num('length', 'Length', 1, 12, 0.5, cells),
    num('reflectance', 'Reflectance', 0.3, 0.99, 0.01, pct),
    {
      key: 'splitter',
      label: 'Beam splitter',
      kind: 'toggle',
      get: (el) => el.kind === 'mirror' && el.splitter,
      set: (el, v) => {
        if (el.kind === 'mirror') el.splitter = Boolean(v);
      },
    },
  ],
  lens: [
    rotation,
    num('aperture', 'Aperture', 1.5, 10, 0.5, cells),
    {
      // No 0: a lens of zero focal length would bend light infinitely. The slider skips it.
      ...num('focal', 'Focal length', -12, 16, 0.5, (v) => `${v === 0 ? '±0.5' : `${v > 0 ? '+' : ''}${v.toFixed(1)}`} u`),
      set: (el, v) => {
        if (el.kind === 'lens') el.focal = Number(v) === 0 ? (el.focal < 0 ? 0.5 : -0.5) : Number(v);
      },
    },
  ],
  filter: [rotation, num('length', 'Length', 1, 8, 0.5, cells), num('minNm', 'Pass from', 400, 690, 5, nm), num('maxNm', 'Pass to', 410, 700, 5, nm)],
  modulator: [
    num('steps', 'Steps', 2, 16, 1),
    num('hits', 'Hits', 1, 16, 1),
    num('rotate', 'Rotate', 0, 15, 1),
    sel('subdivision', 'Step', [
      ['1/4', '1/4'],
      ['1/8', '1/8'],
      ['1/16', '1/16'],
    ]),
    num('depth', 'Swell depth', 0.1, 1, 0.05, pct),
  ],
  receptor: [
    rotation,
    num('aperture', 'Aperture', 0.5, 12, 0.5, cells),
    sel('instrument', 'Voice', [
      ['pad', 'Pad'],
      ['pluck', 'Pluck'],
      ['bell', 'Bell'],
      ['drums', 'Drums'],
    ]),
    num('octave', 'Octave', 1, 6, 1),
    num('span', 'Octave span', 1, 3, 1),
    num('voices', 'Voices', 1, 8, 1),
    num('gain', 'Level', 0.1, 1, 0.05, pct),
  ],
  blocker: [rotation, num('length', 'Length', 0.5, 10, 0.5, cells)],
  chord: [
    rotation,
    num('length', 'Length', 1, 12, 0.5, cells),
    {
      key: 'progression',
      label: 'Chords',
      kind: 'select',
      options: [
        ...PROGRESSIONS.filter((p) => !p.single).map((p) => [p.id, p.label.startsWith('Canon') ? 'Canon' : p.label.replace(/ /g, '')] as [string, string]),
        ['one', 'One chord'],
      ],
      get: (el) => (el.kind === 'chord' && isSingleChord(el.progression) ? 'one' : String((el as { progression?: string }).progression)),
      set: (el, v) => {
        if (el.kind !== 'chord') return;
        if (v !== 'one') el.progression = String(v);
        else if (!isSingleChord(el.progression)) el.progression = 'I';
      },
    },
    {
      key: 'singleChord',
      label: 'Chord',
      kind: 'select',
      options: PROGRESSIONS.filter((p) => p.single).map((p) => [p.id, p.label] as [string, string]),
      hidden: (el) => el.kind !== 'chord' || !isSingleChord(el.progression),
      get: (el) => (el.kind === 'chord' ? el.progression : 'I'),
      set: (el, v) => {
        if (el.kind === 'chord') el.progression = String(v);
      },
    },
    sel('beatsPerChord', 'Each chord', [
      ['2', '½ bar'],
      ['4', '1 bar'],
      ['8', '2 bars'],
    ]),
    sel('rhythm', 'Strike', [
      ['hold', 'Hold'],
      ['1/4', '1/4'],
      ['1/8', '1/8'],
    ]),
  ],
  comb: [
    rotation,
    num('length', 'Length', 1, 10, 0.5, cells),
    num('fringes', 'Fringes', 2, 14, 1),
    num('phase', 'Phase', 0, 0.95, 0.05, (v) => `${Math.round(v * 100)}%`),
  ],
  loom: [
    rotation,
    num('length', 'Length', 1, 14, 0.5, cells),
    sel('subdivision', 'Step', [
      ['1/4', '1/4'],
      ['1/8', '1/8'],
      ['1/16', '1/16'],
    ]),
    num('depth', 'Swell depth', 0.1, 1, 0.05, pct),
  ],
};

export const GLOBAL_FIELDS: Field<GlobalSettings>[] = [
  {
    key: 'bpm',
    label: 'Tempo',
    kind: 'range',
    min: 50,
    max: 170,
    step: 1,
    format: (v) => `${v} bpm`,
    get: (s) => s.bpm,
    set: (s, v) => (s.bpm = Number(v)),
  },
  {
    key: 'scale',
    label: 'Scale',
    kind: 'select',
    options: [
      ['majorPent', 'M pent'],
      ['minorPent', 'm pent'],
      ['dorian', 'Dor'],
      ['major', 'Maj'],
      ['minor', 'Min'],
    ],
    get: (s) => s.scale,
    set: (s, v) => (s.scale = v as GlobalSettings['scale']),
  },
  {
    key: 'root',
    label: 'Root',
    kind: 'range',
    min: 0,
    max: 11,
    step: 1,
    format: (v) => NOTE_NAMES[v] ?? '',
    get: (s) => s.root,
    set: (s, v) => (s.root = Number(v)),
  },
  {
    key: 'c',
    label: 'Speed of light',
    kind: 'range',
    min: 1,
    max: 16,
    step: 0.5,
    format: (v) => `${v} u/beat`,
    get: (s) => s.c,
    set: (s, v) => (s.c = Number(v)),
  },
  {
    key: 'quantize',
    label: 'Quantize',
    kind: 'range',
    min: 0,
    max: 1,
    step: 0.05,
    format: (v) => `${Math.round(v * 100)}%`,
    get: (s) => s.quantize,
    set: (s, v) => (s.quantize = Number(v)),
  },
  {
    key: 'dispersion',
    label: 'Dispersion',
    kind: 'range',
    min: 1,
    max: 15,
    step: 0.5,
    format: (v) => `${v.toFixed(1)}×`,
    get: (s) => s.dispersion,
    set: (s, v) => (s.dispersion = Number(v)),
  },
  {
    key: 'raysPerSplit',
    label: 'Rays per split',
    kind: 'range',
    min: 6,
    max: 48,
    step: 1,
    get: (s) => s.raysPerSplit,
    set: (s, v) => (s.raysPerSplit = Number(v)),
  },
  {
    key: 'gridSnap',
    label: 'Grid snap',
    kind: 'toggle',
    get: (s) => s.gridSnap,
    set: (s, v) => (s.gridSnap = Boolean(v)),
  },
];

export const KIND_LABELS: Record<ElementKind, string> = {
  emitter: 'Emitter',
  prism: 'Prism',
  mirror: 'Mirror',
  lens: 'Lens',
  filter: 'Filter',
  modulator: 'Modulator',
  receptor: 'Receptor',
  blocker: 'Blocker',
  loom: 'Loom card',
  comb: 'Interference comb',
  chord: 'Chord glass',
};

const HELP: Record<string, string> = {
  "motion": "Clockwork: let this piece move by itself as the music plays. Swing rocks it to and fro around its angle; Turn keeps rotating. The light follows, so the notes change over time — a swinging prism sweeps the rainbow across a card and the same holes play a rising and falling line.",
  "motionSwing": "How far it rocks each way from its set angle. A few degrees already moves colours across a card's slots.",
  "motionBars": "How many bars one full swing (there and back) takes.",
  "motionSpeed": "Degrees per bar; negative turns the other way.",
  "rotation": "Which way the element faces. Hold Shift while rotating for 1° steps.",
  "emitter.spectrum": "White light holds every colour, so every note. A band emits only a slice of the rainbow, so only those notes.",
  "emitter.bandMin": "Where the band starts: 400 nm is violet (high notes), 700 nm is red (low notes).",
  "emitter.bandMax": "Where the band ends: 400 nm is violet (high notes), 700 nm is red (low notes).",
  "emitter.intensity": "How bright the beam is. Dimmer light plays quieter notes.",
  "emitter.pulse": "The metronome: how often a swell of light, and so a note, is sent. Drone breathes once a bar.",
  "prism.size": "Bigger glass catches a wider beam.",
  "prism.dispersion": "How far this prism spreads the colours. A wider rainbow spreads the notes further apart.",
  "mirror.length": "How long the mirror is.",
  "mirror.reflectance": "How much light bounces back. Each bounce loses a little, so echoes fade.",
  "mirror.splitter": "A beam splitter lets the rest of the light through: one beam becomes two, and two splitters facing each other make echoes.",
  "lens.aperture": "How wide the lens is.",
  "lens.focal": "Where it focuses light. Positive gathers light to a point: louder, brighter sound. Negative spreads it: softer, duller.",
  "filter.length": "How wide the filter glass is.",
  "filter.minNm": "Only colours between these two wavelengths pass; every other note is removed.",
  "filter.maxNm": "Only colours between these two wavelengths pass; every other note is removed.",
  "modulator.steps": "Length of the rhythmic cycle, in steps.",
  "modulator.hits": "How many of those steps send a note, spread as evenly as possible (a Euclidean rhythm: 3 in 8 is a tresillo).",
  "modulator.rotate": "Starts the pattern on a different step.",
  "modulator.subdivision": "How long one step is.",
  "modulator.depth": "How strongly each hit brightens the beam.",
  "receptor.aperture": "How wide the slit is. Wide catches many colours, so chords; narrow catches one, so single notes.",
  "receptor.instrument": "The sound: a soft pad, a plucked string, a bell, or drums (then colour picks the drum: red kick … violet hi-hat).",
  "receptor.octave": "How low or high the reddest light sounds.",
  "receptor.span": "How many octaves the rainbow is stretched over. More octaves, bigger jumps between neighbouring colours.",
  "receptor.voices": "The most notes this receptor plays at once. When it catches more colours than that, the brightest win and the rest stay silent (their labels stay grey) — the violet end, spread widest by a prism, is usually the first to drop out.",
  "receptor.gain": "Volume of this receptor.",
  "blocker.length": "How long the blocker is. Light that hits it stops, and so do its notes.",
  "loom.length": "How wide the card is across the rainbow.",
  "loom.subdivision": "How long one step of the card is.",
  "loom.depth": "How strongly the card's swells brighten the light.",
  "chord.length": "How wide the glass is across the rainbow.",
  "chord.progression": "The chord sequence, or One chord to hold a single chord. Roman numerals count steps of the scale: I is home, IV and V lead away, vi is the sad relative. The glass lets through only the colours of the current chord; they glow on the glass, and the chip above it names the notes.",
  "chord.singleChord": "Which chord the glass holds. Upper case is major, lower case minor (in a major key).",
  "chord.beatsPerChord": "How long each chord lasts before the glass moves to the next one.",
  "chord.rhythm": "Hold plays each chord once and lets it ring; 1/4 and 1/8 strike it on every beat or half-beat.",
  "comb.length": "How wide the comb is across the light; a white beam's strands always fill its whole length.",
  "comb.fringes": "How many bright fringes span the rainbow. Each fringe lets one thin colour through: more fringes, more notes in the chord. A white beam is split into this many parallel strands across the comb.",
  "comb.phase": "Slides the fringes along the spectrum, so a different set of colours (notes) gets through.",
  "global.bpm": "Tempo: how fast emitters pulse and cards advance.",
  "global.scale": "Which notes the colours map to. Pentatonic never clashes; major and minor give full melodies.",
  "global.root": "The key: the note the scale starts on.",
  "global.c": "How fast light travels on this table. Slower light means longer delays from prism to receptor and wider strums.",
  "global.quantize": "How strongly notes snap to the 1/16 grid. At 0% you hear the raw timing of the light.",
  "global.dispersion": "How widely every prism spreads colour. Wider rainbows spread the notes apart.",
  "global.raysPerSplit": "How many rays make up a rainbow. More rays, more distinct notes to catch.",
  "global.gridSnap": "Snap positions to half-cells while dragging."
};

// Everything that points somewhere can move by itself (a modulator is a round wheel).
for (const [kind, fields] of Object.entries(ELEMENT_FIELDS)) {
  if (kind !== 'modulator') fields.push(...motionFields);
}

/** Attach help texts: `kind.key` for elements, `global.key` for table settings. */
for (const [kind, fields] of Object.entries(ELEMENT_FIELDS)) {
  for (const f of fields) f.help ??= HELP[`${kind}.${f.key}`] ?? HELP[f.key];
}
for (const f of GLOBAL_FIELDS) f.help ??= HELP[`global.${f.key}`];
