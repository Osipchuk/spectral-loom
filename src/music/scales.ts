import type { ScaleName } from '../scene/types';

export const SCALES: Record<ScaleName, readonly number[]> = {
  majorPent: [0, 2, 4, 7, 9],
  minorPent: [0, 3, 5, 7, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

export const SCALE_LABELS: Record<ScaleName, string> = {
  majorPent: 'Major pentatonic',
  minorPent: 'Minor pentatonic',
  dorian: 'Dorian',
  major: 'Major',
  minor: 'Natural minor',
};

export const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
