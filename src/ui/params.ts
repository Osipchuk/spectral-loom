import type { ElementKind, GlobalSettings, SceneElement } from '../scene/types';

export type FieldValue = number | string | boolean;

interface FieldBase<T> {
  key: string;
  label: string;
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
    num('focal', 'Focal length', -12, 16, 0.5, (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} u`),
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
    ]),
    num('octave', 'Octave', 2, 6, 1),
  ],
  blocker: [rotation, num('length', 'Length', 0.5, 10, 0.5, cells)],
};

export const GLOBAL_FIELDS: Field<GlobalSettings>[] = [
  {
    key: 'dispersion',
    label: 'Dispersion',
    kind: 'range',
    min: 1,
    max: 5,
    step: 0.1,
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
};
