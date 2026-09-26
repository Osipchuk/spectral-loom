import type { LoomNote } from '../scene/types';

/** Scale-degree patterns that work in any scale (degree 0 = the root). */
export const MELODY_PRESETS: { id: string; label: string; steps: number; notes: LoomNote[] }[] = [
  {
    id: 'twinkle',
    label: 'Twinkle, Twinkle',
    steps: 16,
    notes: [0, 0, 4, 4, 5, 5, 4, -1, 3, 3, 2, 2, 1, 1, 0, -1].flatMap((deg, at) =>
      deg < 0 ? [] : [{ at, deg, len: [6, 14].includes(at) ? 2 : 1 }],
    ),
  },
  {
    id: 'arp',
    label: 'Rising arpeggio',
    steps: 16,
    notes: [0, 2, 4, 7, 4, 2, 0, 2, 4, 7, 9, 7, 4, 2, 4, 7].map((deg, at) => ({ at, deg, len: 1 })),
  },
  {
    id: 'ode',
    label: 'Ode to Joy (opening)',
    steps: 16,
    notes: [2, 2, 3, 4, 4, 3, 2, 1, 0, 0, 1, 2, 2, 1, 1, -1].flatMap((deg, at) => (deg < 0 ? [] : [{ at, deg, len: 1 }])),
  },
  {
    id: 'chords',
    label: 'Slow chords',
    steps: 16,
    notes: [
      [0, 2, 4],
      [3, 5, 7],
      [4, 6, 8],
      [0, 2, 4],
    ].flatMap((chord, i) => chord.map((deg) => ({ at: i * 4, deg, len: 4 }))),
  },
];

/** Kit piece indices: 0 kick, 1 tom, 2 snare, 3 clap, 4 hat, 5 open hat. */
const beat = (rows: Record<number, string>): LoomNote[] =>
  Object.entries(rows).flatMap(([deg, pattern]) =>
    [...pattern].flatMap((ch, at) => (ch === 'x' ? [{ at, deg: Number(deg), len: 1 }] : [])),
  );

export const BEAT_PRESETS: { id: string; label: string; steps: number; notes: LoomNote[] }[] = [
  {
    id: 'four',
    label: 'Four on the floor',
    steps: 16,
    notes: beat({ 0: 'x...x...x...x...', 2: '....x.......x...', 4: '..x...x...x...x.', 5: '..............x.' }),
  },
  {
    id: 'boombap',
    label: 'Boom bap',
    steps: 16,
    notes: beat({ 0: 'x.......x.x.....', 2: '....x.......x...', 4: 'x.x.x.x.x.x.x.x.' }),
  },
  {
    id: 'bossa',
    label: 'Bossa',
    steps: 16,
    notes: beat({ 0: 'x..x..x.x..x..x.', 1: '...x......x.....', 3: '..x..x....x..x..', 4: 'xxxxxxxxxxxxxxxx' }),
  },
];

/** Deterministic-when-seeded PRNG. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * A short melody that sounds intentional: a two-phrase question/answer built on a rhythm
 * cell, moving mostly by step, leaning on chord tones (0, 2, 4 of the scale) and landing
 * on the root. `available` restricts it to degrees the receptor can actually play.
 */
export function composeMelody(steps: number, available: number[], seed = Date.now()): LoomNote[] {
  const rand = rng(seed);
  const degs = [...available].sort((a, b) => a - b);
  if (degs.length === 0) return [];
  const perScale = 7;
  const root = degs.find((d) => d % perScale === 0 && d >= degs[0]! + 2) ?? degs[Math.floor(degs.length / 3)]!;
  const cells = [
    [2, 2, 2, 2],
    [2, 1, 1, 2, 2],
    [3, 1, 2, 2],
    [1, 1, 2, 4],
    [2, 2, 4],
  ];
  const cell = cells[Math.floor(rand() * cells.length)]!;
  const idx = (d: number): number => degs.reduce((best, x, i) => (Math.abs(x - d) < Math.abs(degs[best]! - d) ? i : best), 0);
  const notes: LoomNote[] = [];
  let i = idx(root);
  let at = 0;
  let k = 0;
  while (at < steps) {
    const len = Math.min(cell[k % cell.length]!, steps - at);
    const phraseEnd = at + len >= steps || (at + len) % 8 === 0;
    if (phraseEnd && at + len >= steps) {
      i = idx(root);
    } else {
      const r = rand();
      const move = r < 0.35 ? 1 : r < 0.7 ? -1 : r < 0.85 ? 2 : r < 0.95 ? -2 : 0;
      i = Math.max(0, Math.min(degs.length - 1, i + move));
      // On strong beats, prefer a chord tone.
      if (at % 4 === 0 && ![0, 2, 4].includes(((degs[i]! % perScale) + perScale) % perScale)) {
        i = Math.max(0, Math.min(degs.length - 1, i + (rand() < 0.5 ? 1 : -1)));
      }
    }
    notes.push({ at, deg: degs[i]!, len });
    at += len;
    k += 1;
  }
  return notes;
}

/** A groove: kick on one with a variation, backbeat snare, hats with the odd open one. */
export function composeBeat(steps: number, seed = Date.now()): LoomNote[] {
  const rand = rng(seed);
  const out: LoomNote[] = [];
  for (let bar = 0; bar < steps; bar += 16) {
    const kicks = [0, ...[6, 8, 10, 11].filter(() => rand() < 0.45)];
    for (const k of kicks) if (bar + k < steps) out.push({ at: bar + k, deg: 0, len: 1 });
    for (const s of [4, 12]) if (bar + s < steps) out.push({ at: bar + s, deg: rand() < 0.2 ? 3 : 2, len: 1 });
    const sixteenths = rand() < 0.4;
    for (let h = 0; h < 16; h += sixteenths ? 1 : 2) {
      if (bar + h >= steps) break;
      const open = h === 14 && rand() < 0.5;
      out.push({ at: bar + h, deg: open ? 5 : 4, len: 1 });
    }
    if (rand() < 0.35 && bar + 15 < steps) out.push({ at: bar + 15, deg: 1, len: 1 });
  }
  return out;
}
