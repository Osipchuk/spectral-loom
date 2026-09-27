import { CALM_NIGHT, type Weather } from '../music/mood';
import { cutNewCards } from '../scene/cards';
import { card, chainPoints, el, lightCarousel } from '../scene/demos';
import { DEFAULT_SETTINGS, DEFAULT_TABLE } from '../scene/defaults';
import type { Loom, SceneElement, SceneModel } from '../scene/types';
import type { Timeline } from './timeline';

/** A caption over the film: what the viewer should notice right now. */
export interface Caption {
  text: string;
  /** Smaller second line. */
  sub?: string;
  /** 0…1 fade. */
  opacity: number;
}

export interface FilmTimeline extends Timeline {
  caption(t: number): Caption | null;
}

const smooth = (a: number, b: number, t: number): number => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};
/** 0 outside [a, b], 1 inside, with `f`-second fades. */
const window = (a: number, b: number, t: number, f = 0.4): number => smooth(a, a + f, t) * (1 - smooth(b - f, b, t));

const BPM = 100;
const beatAt = (t: number): number => (t * BPM) / 60;

const ORIGIN = { x: 6, y: 16 };
const P = chainPoints(ORIGIN, 0);
const PRISM_ROT = 70;

const CARD_IN = 12;
const TUNE = (() => {
  const c = card('majorPent', 0, 3, 'C4:2 C4:2 G4:2 G4:2 A4:2 A4:2 G4:4 | E4:2 E4:2 D4:2 D4:2 C4:2 D4:2 C4:4 |');
  // Rotate the loop so the tune starts from its first note the moment the card lands.
  const shift = Math.round((beatAt(CARD_IN) / 0.5) % c.steps);
  return { ...c, notes: c.notes.map((n) => ({ ...n, at: (n.at + shift) % c.steps })) };
})();

/** The card as it is cut where it lands: holes at fixed places, the glass picks the notes. */
let cutCard: Pick<Loom, 'slots' | 'notes'> | null = null;
function cardCut(scene: SceneModel): Pick<Loom, 'slots' | 'notes'> {
  if (cutCard) return cutCard;
  const s = structuredClone(scene);
  const loom = s.elements.find((e): e is Loom => e.id === 'f-card')!;
  loom.enabled = true;
  loom.slots = undefined;
  cutNewCards(s);
  cutCard = { slots: loom.slots, notes: loom.notes };
  return cutCard;
}

/** The prism: still, then a wide sweep (4–9 s), then turned a little under the card (17–21 s). */
function prismAngle(t: number): number {
  const sweep = Math.sin((t - 4) * 1.25) * 10 * window(4, 9, t, 0.8);
  // Four degrees: every hole now catches a lower colour, the same tune's shape a step down.
  const turn = -4 * smooth(17.5, 19, t);
  // Clockwork once the beat is in: a slow swing, so the tune keeps bending.
  const swing = Math.sin((t - 21) * 0.8) * 2.5 * smooth(21, 22.5, t);
  return PRISM_ROT + sweep + turn + swing;
}

function spectrometer(t: number): SceneElement[] {
  const [fx, fy] = P.alongFan(8);
  // The filter glides in from the right edge, rests, and leaves again.
  const filterX = 47 - (47 - fx) * window(9, 12, t, 0.9);
  // The card drops onto the rainbow from above the table's far edge.
  const [cx, cy] = P.alongFan(4.5);
  const drop = 1 - smooth(11.7, 12.2, t);
  const beatOn = t >= 21;
  const out: SceneElement[] = [
    el('emitter', 'f-lamp', ORIGIN.x, ORIGIN.y, 0, { pulse: '1/4' }),
    el('prism', 'f-prism', ...P.place(7, 0), prismAngle(t), { size: 4 }),
    el('loom', 'f-card', cx, cy - drop * 14, P.fan, { length: 3.4, subdivision: '1/8', title: 'Twinkle', depth: 0.9, ...TUNE, enabled: t >= CARD_IN }),
    el('filter', 'f-filter', filterX, fy, P.fan, { length: 5, minNm: 470, maxNm: 560, enabled: t >= 9 && t < 12.2 }),
    el('receptor', 'f-receptor', ...P.alongFan(12.5), P.fan + 180, { aperture: 8, instrument: 'pluck', octave: 3, span: 2, voices: 4, gain: 0.9 }),
    // The beat: a red beam and a blue one, each through its own Euclidean ring, on one drum receptor.
    el('emitter', 'f-kick', 6, 3, 0, { pulse: 'drone', spectrum: { kind: 'band', minNm: 650, maxNm: 690 }, enabled: beatOn }),
    el('modulator', 'f-kick-ring', 13, 3, 0, { steps: 16, hits: 4, subdivision: '1/16', depth: 0.95 }),
    el('emitter', 'f-hat', 6, 5.5, 0, { pulse: 'drone', spectrum: { kind: 'band', minNm: 440, maxNm: 470 }, intensity: 0.9, enabled: beatOn }),
    el('modulator', 'f-hat-ring', 13, 5.5, 0, { steps: 16, hits: 4, rotate: 2, subdivision: '1/16', depth: 0.7 }),
    el('receptor', 'f-drums', 21, 4.25, 180, { aperture: 5, instrument: 'drums', octave: 3, span: 1, voices: 3, gain: 0.85, enabled: beatOn }),
  ];
  return out;
}

/** The finale: the light carousel, its lens turned by the clock (30° a bar). */
function carousel(t: number): SceneElement[] {
  const elements = structuredClone(lightCarousel());
  const bars = beatAt(t - FINALE) / 4;
  for (const e of elements) {
    if (e.id === 'bench-lens') {
      e.rotation += (bars * 30 * Math.PI) / 180;
      delete e.motion;
    }
  }
  return elements;
}

const FINALE = 26;

const settings = { ...DEFAULT_SETTINGS, bpm: BPM, scale: 'majorPent' as const, root: 0, quantize: 1 };

/**
 * "Light plays music", cut for social media: about half a minute, one idea every few
 * seconds, each named on screen as it happens, the camera close to where it happens.
 */
export const LIGHT_PLAYS: FilmTimeline = {
  duration: 32,
  at(t) {
    if (t >= FINALE) {
      return { version: 1, name: 'Light carousel', table: { ...DEFAULT_TABLE }, settings: { ...settings, c: 8 }, elements: carousel(t) };
    }
    const scene: SceneModel = { version: 1, name: 'Light plays', table: { ...DEFAULT_TABLE }, settings: { ...settings }, elements: spectrometer(t) };
    // From the moment it lands the card is cut where it sits: turning the prism then changes the tune.
    const loom = scene.elements.find((e): e is Loom => e.id === 'f-card')!;
    // Cut where it lies once the filter has gone, so every colour of the tune has its hole.
    if (t >= CARD_IN) Object.assign(loom, cardCut({ ...scene, elements: spectrometer(12.5) }), { enabled: true });
    return scene;
  },
  camera(t) {
    if (t >= FINALE) {
      const k = smooth(FINALE, 32, t);
      return { zoom: 1.35 - 0.3 * k, panX: 0, panZ: 0.5, azimuth: 0.12 - 0.2 * k, polar: 0.62 - 0.06 * k };
    }
    // Close on the prism, pull back as the story grows, drift over to the drums.
    const open = smooth(0, 4, t);
    const drums = smooth(20.5, 23, t);
    return {
      zoom: 1.9 - 0.55 * open + 0.1 * smooth(12, 14, t) - 0.25 * drums,
      panX: -9 + 4 * open + 2 * drums,
      panZ: 1.5 - 1 * open - 2.5 * drums,
      azimuth: -0.12 + 0.08 * open + 0.1 * smooth(12, 26, t),
      polar: 0.56 + 0.06 * open,
    };
  },
  weather(t): Weather {
    const melody = smooth(12, 15, t);
    const beat = smooth(21, 23, t);
    const finale = smooth(FINALE, FINALE + 1.5, t);
    return {
      ...CALM_NIGHT,
      // Moonlit night; the melody brings a golden sunset, the beat stirs wind and lake;
      // the carousel turns under an aurora.
      aurora: 0.1 + 0.25 * melody + 0.6 * finale,
      mist: 0.4 - 0.3 * beat,
      clouds: 0.1 + 0.15 * beat * (1 - finale),
      wind: 0.12 + 0.45 * beat * (1 - finale) + 0.2 * finale,
      fireflies: 0.3 + 0.5 * melody - 0.5 * beat,
      warmth: 0.45 + 0.4 * melody - 0.3 * finale,
      dusk: 0.85 * melody * (1 - finale),
      waves: 0.35 * beat * (1 - finale) + 0.2 * finale,
    };
  },
  caption(t) {
    const cues: [number, number, string, string?][] = [
      [0.3, 4, 'Every colour is a note', 'white light through a prism'],
      [4.2, 9, 'Turn the glass', 'the rainbow slides: a new chord'],
      [9.2, 12, 'Filter the light', 'fewer colours, fewer notes'],
      [12.3, 17.2, 'A punched card says when', 'each hole lets one colour through'],
      [17.4, 21, 'Same holes, new colours', 'turn the prism: a new tune'],
      [21.2, 25.8, 'Beams through rings', 'Euclidean rhythms play the drums'],
      [26.3, 32, 'Spectral Loom', 'light is the score'],
    ];
    for (const [a, b, text, sub] of cues) {
      const o = window(a, b, t, 0.35);
      if (o > 0) return { text, sub, opacity: o };
    }
    return null;
  },
};
