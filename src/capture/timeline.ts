import { card, chainPoints, el } from '../scene/demos';
import { DEFAULT_SETTINGS, DEFAULT_TABLE } from '../scene/defaults';
import type { SceneModel } from '../scene/types';

/**
 * A scripted short film: the same table changes over time and the music follows.
 * `at(t)` returns the full scene at time t (seconds), deterministically, so video frames
 * and the offline audio render see exactly the same light.
 */
export interface Timeline {
  duration: number;
  at(t: number): SceneModel;
  /** Camera for time t: zoom factor, pan (world units) and orbit angles. */
  camera(t: number): { zoom: number; panX: number; panZ: number; azimuth: number; polar: number };
}

const smooth = (a: number, b: number, t: number): number => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

const ORIGIN = { x: 6, y: 20 };
const P = chainPoints(ORIGIN, 0);

const TWINKLE = card(
  'majorPent',
  0,
  3,
  'C4:2 C4:2 G4:2 G4:2 A4:2 A4:2 G4:4 | E4:2 E4:2 D4:2 D4:2 C4:2 D4:2 C4:4 |',
);

/** "Light changes music": sweep a prism, slide a filter through, punch a melody, add a beat. */
export const LIGHT_CHANGES_MUSIC: Timeline = {
  duration: 26,
  at(t) {
    // 1. A white beam, a prism, a receptor: one strummed chord per beat.
    // 2. (4–10 s) The prism turns; the rainbow sweeps across the receptor and the chord changes.
    const prismRot = 70 + Math.sin(Math.max(0, t - 4) * 0.9) * 7 * (smooth(4, 5, t) - smooth(9, 10, t));
    // 3. (10–14 s) A blue-green filter slides through the fan: only those notes are left.
    const [fx, fy] = P.alongFan(8);
    const filterX = 47 - (47 - fx) * (smooth(10, 11.5, t) - smooth(13.2, 14.4, t));
    // 4. (14 s) A loom card drops in: the chord becomes a melody.
    const loomOn = t >= 14;
    // 5. (19 s) A red beam through a Euclidean ring hits a drum receptor: the beat comes in.
    const beatOn = t >= 19;
    const elements: SceneModel['elements'] = [
      el('emitter', 'v-emitter', ORIGIN.x, ORIGIN.y, 0, { pulse: '1/4' }),
      el('prism', 'v-prism', ...P.place(7, 0), prismRot, { size: 4 }),
      el('loom', 'v-loom', ...P.alongFan(4.5), P.fan, { length: 3.4, subdivision: '1/8', title: 'Twinkle', depth: 0.9, ...TWINKLE, enabled: loomOn }),
      el('filter', 'v-filter', filterX, fy, P.fan, { length: 5, minNm: 470, maxNm: 560 }),
      el('receptor', 'v-receptor', ...P.alongFan(13), P.fan + 180 + 16, { aperture: 8, instrument: 'pluck', octave: 3, span: 2, voices: 4, gain: 0.9 }),
      el('emitter', 'v-red', 6, 3, 0, { pulse: 'drone', spectrum: { kind: 'band', minNm: 650, maxNm: 690 }, intensity: beatOn ? 1 : 0.0001, enabled: beatOn }),
      el('modulator', 'v-ring', 13, 3, 0, { steps: 8, hits: 3, subdivision: '1/8', depth: 0.9 }),
      el('emitter', 'v-hat', 6, 5.5, 0, { pulse: 'drone', spectrum: { kind: 'band', minNm: 440, maxNm: 470 }, intensity: beatOn ? 0.9 : 0.0001, enabled: beatOn }),
      el('modulator', 'v-ring2', 13, 5.5, 0, { steps: 8, hits: 4, rotate: 1, subdivision: '1/8', depth: 0.7 }),
      el('receptor', 'v-drums', 34, 4.25, 180, { aperture: 5, instrument: 'drums', octave: 3, span: 1, voices: 3, gain: 0.85 }),
    ];
    return {
      version: 1,
      name: 'Light changes music',
      table: { ...DEFAULT_TABLE },
      settings: { ...DEFAULT_SETTINGS, bpm: 100, scale: 'majorPent', root: 0, quantize: 1 },
      elements,
    };
  },
  camera(t) {
    const k = smooth(0, 26, t);
    return { zoom: 1.05 + 0.2 * k, panX: -3 - 1.5 * k, panZ: 0.5, azimuth: -0.05 + 0.1 * k, polar: 0.6 };
  },
};

