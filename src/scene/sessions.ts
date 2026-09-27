import { parseScene, serializeScene } from './serialize';
import type { SceneModel } from './types';

/** Undo steps kept per table. */
const HISTORY_LIMIT = 100;

/**
 * Undo and redo over whole-table snapshots (serialized scenes). A snapshot is taken when an
 * edit settles, so one drag or one slider move is one step.
 */
export class History {
  private past: string[] = [];
  private future: string[] = [];

  constructor(private current: string) {}

  /** A different table: forget everything. */
  reset(json: string): void {
    this.current = json;
    this.past = [];
    this.future = [];
  }

  /** The table changed; returns false if it is the same as the last snapshot. */
  record(json: string): boolean {
    if (json === this.current) return false;
    this.past.push(this.current);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.current = json;
    this.future = [];
    return true;
  }

  undo(): string | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(this.current);
    this.current = prev;
    return prev;
  }

  redo(): string | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(this.current);
    this.current = next;
    return next;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get snapshot(): string {
    return this.current;
  }
}

const SESSIONS_KEY = 'spectral-loom:sessions';
const LAST_KEY = 'spectral-loom:last';

/**
 * The user's tables, kept in this browser: one per demo (their edited version of it), one for
 * their own canvas, one for the tutorial table. Nothing leaves the browser; if storage is
 * unavailable (private mode, quota) everything still works, it is just not remembered.
 */
export class Sessions {
  private all: Record<string, { scene: string; savedAt: number }> = {};

  constructor() {
    try {
      const raw = localStorage.getItem(SESSIONS_KEY);
      if (raw) this.all = JSON.parse(raw) as typeof this.all;
    } catch {
      this.all = {};
    }
  }

  has(key: string): boolean {
    return key in this.all;
  }

  load(key: string): SceneModel | null {
    const s = this.all[key];
    if (!s) return null;
    try {
      return parseScene(s.scene);
    } catch {
      this.remove(key);
      return null;
    }
  }

  save(key: string, scene: SceneModel | string): void {
    this.all[key] = { scene: typeof scene === 'string' ? scene : serializeScene(scene), savedAt: Date.now() };
    this.setLast(key);
    this.flush();
  }

  remove(key: string): void {
    delete this.all[key];
    this.flush();
  }

  /** The table the user worked on last, if it is still saved. */
  last(): string | null {
    try {
      const k = localStorage.getItem(LAST_KEY);
      return k && k in this.all ? k : null;
    } catch {
      return null;
    }
  }

  setLast(key: string): void {
    try {
      localStorage.setItem(LAST_KEY, key);
    } catch {
      /* not remembered */
    }
  }

  private flush(): void {
    try {
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(this.all));
    } catch {
      /* quota or private mode: keep working without saving */
    }
  }
}
