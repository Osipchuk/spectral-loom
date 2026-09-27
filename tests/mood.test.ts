import { describe, expect, it } from 'vitest';
import { moodWeather, SkyDirector, weatherName, type MoodNote } from '../src/music/mood';
import type { Instrument } from '../src/scene/types';

const notes = (count: number, instrument: Instrument, midi = 64, velocity = 0.8): MoodNote[] =>
  Array.from({ length: count }, () => ({ instrument, midi, velocity }));

describe('weather follows the music', () => {
  it('lively major music brings the aurora', () => {
    const w = moodWeather({ scale: 'major', bpm: 120, notes: notes(24, 'pluck', 67), windowS: 6 });
    expect(weatherName(w)).toBe('aurora');
    expect(w.rain).toBe(0);
    expect(w.lightning).toBe(0);
  });
  it('minor music rains, harder when it is busy', () => {
    const calm = moodWeather({ scale: 'minor', bpm: 70, notes: notes(4, 'pad', 55), windowS: 6 });
    const busy = moodWeather({ scale: 'minor', bpm: 130, notes: notes(30, 'pluck', 55), windowS: 6 });
    expect(weatherName(calm)).toBe('rain');
    expect(busy.rain).toBeGreaterThan(calm.rain);
    expect(calm.aurora).toBe(0);
    expect(calm.lightning).toBe(0);
  });
  it('slow bells bring snow', () => {
    const w = moodWeather({ scale: 'major', bpm: 66, notes: notes(5, 'bell', 72), windowS: 6 });
    expect(w.snow).toBeGreaterThan(0.4);
  });
  it('silence is a calm night on a flat lake', () => {
    const w = moodWeather({ scale: 'minor', bpm: 100, notes: [], windowS: 6 });
    expect(weatherName(w)).toBe('mist');
    expect(w.waves).toBe(0);
    expect(w.lightning).toBe(0);
    expect(w.dusk).toBe(0);
  });
  it('minor, fast, loud drums raise a storm: waves, gale, rain, lightning', () => {
    const kit = [...notes(16, 'drums', 36, 1), ...notes(8, 'drums', 38, 0.9), ...notes(12, 'pluck', 50, 0.9)];
    const w = moodWeather({ scale: 'minor', bpm: 140, notes: kit, windowS: 6 });
    expect(weatherName(w)).toBe('storm');
    expect(w.waves).toBeGreaterThan(0.8);
    expect(w.wind).toBeGreaterThan(0.7);
    expect(w.rain).toBeGreaterThan(0.6);
    expect(w.lightning).toBeGreaterThan(0.6);
    expect(w.dusk).toBe(0);
  });
  it('drums stir the lake; calm music leaves it a mirror', () => {
    const calm = moodWeather({ scale: 'major', bpm: 70, notes: notes(4, 'pad', 60), windowS: 6 });
    const beat = moodWeather({ scale: 'major', bpm: 70, notes: [...notes(4, 'pad', 60), ...notes(12, 'drums', 36, 1)], windowS: 6 });
    expect(calm.waves).toBeLessThan(0.1);
    expect(beat.waves).toBeGreaterThan(calm.waves + 0.2);
  });
  it('valence turns the light warm or cold; bright calm music brings golden hour', () => {
    const bright = moodWeather({ scale: 'majorPent', bpm: 72, notes: notes(5, 'pluck', 67), windowS: 6 });
    const dark = moodWeather({ scale: 'minor', bpm: 72, notes: notes(5, 'pluck', 55), windowS: 6 });
    expect(bright.warmth).toBeGreaterThan(0.8);
    expect(dark.warmth).toBeLessThan(0.2);
    expect(bright.dusk).toBeGreaterThan(0.45);
    expect(weatherName(bright)).toMatch(/sunset/);
    expect(dark.dusk).toBeLessThan(0.1);
  });
  it('fast, cold, dark bells make a blizzard', () => {
    const w = moodWeather({ scale: 'minor', bpm: 140, notes: notes(30, 'bell', 76, 0.9), windowS: 6 });
    expect(w.snow).toBeGreaterThan(w.rain);
    expect(weatherName(w)).toMatch(/blizzard|storm/);
  });
});

describe('the sky director', () => {
  it('moves the sun only while music plays, so a long piece passes through dusk and night', () => {
    const sky = new SkyDirector();
    const m = { scale: 'dorian' as const, bpm: 96, notes: notes(12, 'pluck', 62), windowS: 6 };
    const dusks: number[] = [];
    for (let i = 0; i < 600; i++) dusks.push(sky.weather(m, 0.5).dusk);
    expect(Math.max(...dusks) - Math.min(...dusks)).toBeGreaterThan(0.3);
    const day = sky.day;
    sky.weather({ ...m, notes: [] }, 10);
    expect(sky.day).toBe(day);
  });
  it('lightning answers loud kicks only in a charged storm, seconds apart', () => {
    const kick = (time: number): MoodNote => ({ instrument: 'drums', midi: 36, velocity: 1, time });
    const run = (charge: number): number[] => {
      const sky = new SkyDirector();
      const flashes: number[] = [];
      for (let f = 1; f <= 60 * 60; f++) {
        const t = f / 60;
        const beat = Math.floor(t * 2) / 2;
        if (sky.strike([kick(beat)], t, t, charge) > 0) flashes.push(t);
      }
      return flashes;
    };
    expect(run(0)).toHaveLength(0);
    const storm = run(1);
    expect(storm.length).toBeGreaterThan(3);
    for (let i = 1; i < storm.length; i++) expect(storm[i]! - storm[i - 1]!).toBeGreaterThanOrEqual(4);
    // Flashes land on kicks (or are the rare ambient ones).
    expect(storm.filter((t) => Math.abs(t * 2 - Math.round(t * 2)) < 0.05).length).toBeGreaterThan(storm.length / 2);
  });
});
