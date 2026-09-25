import { describe, expect, it } from 'vitest';
import { moodWeather, weatherName } from '../src/music/mood';

const notes = (count: number, instrument: 'pad' | 'pluck' | 'bell', midi = 64) =>
  Array.from({ length: count }, () => ({ instrument, midi, velocity: 0.8 }));

describe('weather follows the music', () => {
  it('lively major music brings the aurora', () => {
    const w = moodWeather({ scale: 'major', bpm: 120, notes: notes(24, 'pluck', 67), windowS: 6 });
    expect(weatherName(w)).toBe('aurora');
    expect(w.rain).toBe(0);
  });
  it('minor music rains, harder when it is busy', () => {
    const calm = moodWeather({ scale: 'minor', bpm: 70, notes: notes(4, 'pad', 55), windowS: 6 });
    const busy = moodWeather({ scale: 'minor', bpm: 130, notes: notes(30, 'pluck', 55), windowS: 6 });
    expect(weatherName(calm)).toBe('rain');
    expect(busy.rain).toBeGreaterThan(calm.rain);
    expect(calm.aurora).toBe(0);
  });
  it('slow bells bring snow', () => {
    const w = moodWeather({ scale: 'major', bpm: 66, notes: notes(5, 'bell', 72), windowS: 6 });
    expect(w.snow).toBeGreaterThan(0.4);
  });
  it('silence is a calm night', () => {
    expect(weatherName(moodWeather({ scale: 'minor', bpm: 100, notes: [], windowS: 6 }))).toBe('mist');
  });
});
