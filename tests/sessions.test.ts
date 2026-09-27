import { beforeEach, describe, expect, it } from 'vitest';
import { emptyScene, makeElement } from '../src/scene/defaults';
import { serializeScene } from '../src/scene/serialize';
import { History, Sessions } from '../src/scene/sessions';

describe('history', () => {
  it('undoes and redoes whole-table snapshots, and a new edit drops the redo branch', () => {
    const h = new History('a');
    expect(h.record('a')).toBe(false);
    h.record('b');
    h.record('c');
    expect(h.undo()).toBe('b');
    expect(h.undo()).toBe('a');
    expect(h.undo()).toBeNull();
    expect(h.redo()).toBe('b');
    h.record('d');
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toBe('b');
  });

  it('keeps at most a hundred steps', () => {
    const h = new History('0');
    for (let i = 1; i <= 150; i++) h.record(String(i));
    let n = 0;
    while (h.undo() !== null) n++;
    expect(n).toBe(100);
  });
});

describe('sessions', () => {
  beforeEach(() => {
    const mem = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    };
  });

  it('remembers each table across page loads, and which one was open last', () => {
    const s = emptyScene('mine');
    s.elements.push(makeElement('prism', { x: 5, y: 5 }));
    new Sessions().save('canon', s);
    new Sessions().save('canvas', emptyScene('canvas'));
    const again = new Sessions();
    expect(serializeScene(again.load('canon')!)).toBe(serializeScene(s));
    expect(again.last()).toBe('canvas');
    again.remove('canon');
    expect(new Sessions().has('canon')).toBe(false);
  });

  it('works, without remembering, when storage is unavailable', () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    const s = new Sessions();
    s.save('canvas', emptyScene());
    expect(s.last()).toBeNull();
  });
});
