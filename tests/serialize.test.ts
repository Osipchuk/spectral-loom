import { describe, expect, it } from 'vitest';
import { parseScene } from '../src/scene/serialize';

describe('parseScene on a hostile file', () => {
  it('clamps loop sizes and counts that would hang the tab', () => {
    const scene = parseScene({
      version: 1,
      table: { w: 1e9, h: 'x' },
      settings: { bpm: 1e6, raysPerSplit: 1e7, scale: '__proto__' },
      elements: [
        { kind: 'modulator', pos: { x: 1, y: 1 }, steps: 1e9, hits: 1e9, subdivision: 'evil' },
        { kind: 'receptor', pos: { x: 2, y: 2 }, voices: 1e6, instrument: 'constructor', motion: { kind: 'swing', degrees: 10, bars: 0 } },
        { kind: 'loom', pos: { x: 3, y: 3 }, notes: [...Array(5000).fill({ at: 0, len: 1, deg: 0 }), { at: 'x' }], slots: 'no' },
      ],
    });
    expect(scene.table).toEqual({ w: 200, h: 28 });
    expect(scene.settings.bpm).toBe(300);
    expect(scene.settings.raysPerSplit).toBe(128);
    expect(scene.settings.scale).toBe('majorPent');
    const [mod, rec, loom] = scene.elements as unknown as Record<string, unknown>[];
    expect(mod!.steps).toBe(512);
    expect(mod!.subdivision).toBe('1/8');
    expect(rec!.voices).toBe(16);
    expect(rec!.instrument).toBe('pluck');
    expect(rec!.motion).toBeUndefined();
    expect((loom!.notes as unknown[]).length).toBe(2048);
    expect(loom!.slots).toBeUndefined();
  });

  it('caps the number of elements', () => {
    const elements = Array.from({ length: 1000 }, (_, i) => ({ kind: 'blocker', pos: { x: i, y: 0 } }));
    expect(parseScene({ version: 1, elements }).elements.length).toBe(200);
  });
});
