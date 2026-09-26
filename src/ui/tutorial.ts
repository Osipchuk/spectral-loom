import { card, chainPoints, el } from '../scene/demos';
import type { SceneStore } from '../scene/store';
import type { ElementKind, SceneElement, SceneModel } from '../scene/types';
import { dist } from '../optics/vec2';
import { h } from './dom';

export interface TutorialHost {
  store: SceneStore;
  setGhost(el: SceneElement | null): void;
  highlight(kind: ElementKind | null): void;
  /** Start audio (we are inside a user gesture when this is called). */
  ensureAudio(): void;
  openDemo(id: string): void;
  finish(): void;
  /** Called when the card moves between the bottom and the top of the screen. */
  relayout(): void;
}

/** Drops within this distance of the outline click into place. */
const SNAP_RADIUS = 7;

/** "Ah vous dirai-je, maman" — Twinkle, Twinkle, Little Star (18th-century French tune). */
const TWINKLE =
  'C4 C4 G4 G4 A4 A4 G4:2 | F4 F4 E4 E4 D4 D4 C4:2 | G4 G4 F4 F4 E4 E4 D4:2 | G4 G4 F4 F4 E4 E4 D4:2 | C4 C4 G4 G4 A4 A4 G4:2 | F4 F4 E4 E4 D4 D4 C4:2';

const ORIGIN = { x: 7, y: 16 };
const P = chainPoints(ORIGIN, 0);
const rad = (d: number): number => (d * Math.PI) / 180;

/** Where each tutorial element goes. */
const TARGETS = {
  emitter: el('emitter', 'tut-emitter', ORIGIN.x, ORIGIN.y, 0, { pulse: '1/4' }),
  prism: el('prism', 'tut-prism', ...P.place(7, 0), 70, { size: 4 }),
  receptor: el('receptor', 'tut-receptor', ...P.alongFan(12), P.fan + 180 + 16, {
    aperture: 7,
    instrument: 'pluck',
    octave: 4,
    span: 1,
    voices: 3,
    gain: 0.85,
  }),
  loom: el('loom', 'tut-loom', ...P.alongFan(4.5), P.fan, {
    length: 3.4,
    subdivision: '1/4',
    title: 'Twinkle, Twinkle',
    depth: 0.9,
    ...card('major', 0, 4, TWINKLE),
  }),
};
type TargetKey = keyof typeof TARGETS;

interface Step {
  title: string;
  /** What to do, and how. */
  task: string;
  /** Shown once the task is done: what just happened and why it sounds like that. */
  result: string;
  place?: TargetKey;
  done?: (scene: SceneModel, t: Tutorial) => boolean;
  /** "Do it for me" for tasks that are not placements. */
  auto?: (store: SceneStore, t: Tutorial) => void;
  after?: (host: TutorialHost) => void;
  /** Offer "Put it back" on the result card (restores the target positions). */
  restore?: boolean;
}

const find = (scene: SceneModel, id: string): SceneElement | undefined => scene.elements.find((e) => e.id === id);

function angleDiff(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

const STEPS: Step[] = [
  {
    title: 'A lamp',
    task: 'Drag the Emitter from the panel on the left onto the glowing outline on the table — or simply click the outline.',
    result:
      'The lamp is on. Its beam never switches off; instead, every beat it sends a swell of brightness down the beam. Watch the swells travel: they are the pulse of the music.',
    place: 'emitter',
  },
  {
    title: 'Split the light',
    task: 'Now put a Prism into the beam: drag it from the left onto the new outline (or click the outline).',
    result:
      'A rainbow. White light holds every colour, and glass bends violet more than red, so the colours fan apart. Here every colour is a pitch: red is low, violet is high.',
    place: 'prism',
  },
  {
    title: 'Catch it',
    task: 'Place a Receptor where the rainbow lands (drag it onto the outline, or click the outline). Sound will switch on.',
    result:
      'Hear the chord? Every colour the receptor catches is one note — the labels beside it name them. It is tilted, so red lands a moment before violet: a strum.',
    place: 'receptor',
    after: (host) => host.ensureAudio(),
  },
  {
    title: 'Turn the prism',
    task:
      'Click the prism to select it, then turn it about 10°: scroll the mouse wheel over it, press Q or E, or drag the small round handle on the ring around it. Listen while you turn.',
    result:
      'The rainbow swung across the receptor, so different colours land on it — and the chord changed. Rotating glass chooses which notes play.',
    done: (s, t) => {
      const p = find(s, t.idOf('prism'));
      return !!p && Math.abs(angleDiff(p.rotation, TARGETS.prism.rotation)) >= rad(8);
    },
    auto: (store, t) => store.updateElement(t.idOf('prism'), (e) => (e.rotation += rad(12))),
    restore: true,
  },
  {
    title: 'Move the receptor',
    task: 'Drag the receptor two or three cells towards the prism, along the rainbow. Keep listening.',
    result:
      'Closer to the prism the rainbow is narrower, so fewer colours fit on the slit: fewer notes. They also arrive sooner — light is slow on this table, so distance is time.',
    done: (s, t) => {
      const r = find(s, t.idOf('receptor'));
      return !!r && dist(r.pos, TARGETS.receptor.pos) >= 2;
    },
    auto: (store, t) =>
      store.updateElement(t.idOf('receptor'), (e) => {
        e.pos = { x: e.pos.x - 2.2, y: e.pos.y + 1.8 };
      }),
    restore: true,
  },
  {
    title: 'Write a melody',
    task: 'Drop a Loom card across the rainbow, on the outline near the prism (or click the outline).',
    result:
      'Now a tune: the card is punched with “Twinkle, Twinkle”. At each step its holes let a swell through on one colour only, so one note plays instead of the whole chord.',
    place: 'loom',
    after: (host) => host.store.updateSettings({ scale: 'major', root: 0, bpm: 100 }),
  },
  {
    title: 'Punch your own note',
    task:
      'Click the card to open its editor at the bottom. Each row is a colour that reaches the receptor. Click an empty cell to punch a hole — drag right to hold it longer — or click a hole to remove it.',
    result: 'That note is now part of the melody: the card plays whatever you punch. Try Compose ✦ in the editor for a fresh tune.',
    done: (s, t) => {
      const l = find(s, t.idOf('loom'));
      return !!l && l.kind === 'loom' && JSON.stringify(l.notes) !== JSON.stringify(TARGETS.loom.notes);
    },
    auto: (store, t) =>
      store.updateElement(t.idOf('loom'), (e) => {
        if (e.kind === 'loom') e.notes = [...e.notes, { at: 14, deg: 7, len: 2 }];
      }),
  },
  {
    title: 'Change the voice',
    task: 'Click the receptor and, in the panel on the right, switch its Voice to Bell.',
    result: 'Same light, new instrument. Every “?” in the panels explains what a setting does to the sound.',
    done: (s, t) => {
      const r = find(s, t.idOf('receptor'));
      return !!r && r.kind === 'receptor' && r.instrument !== 'pluck';
    },
    auto: (store, t) =>
      store.updateElement(t.idOf('receptor'), (e) => {
        if (e.kind === 'receptor') e.instrument = 'bell';
      }),
  },
];

/**
 * Guided first run. Each step says what to do and how; once done, a short explanation
 * says what changed in the music and why, and waits for Next.
 */
export class Tutorial {
  readonly el: HTMLElement;
  private index = 0;
  private phase: 'task' | 'result' = 'task';
  private placed = new Map<string, string>();
  private unsubscribe: () => void;
  private title: HTMLElement;
  private text: HTMLElement;
  private counter: HTMLElement;
  private actions: HTMLElement;
  private hint: HTMLElement;

  constructor(private host: TutorialHost) {
    this.counter = h('span.sl-coach-count');
    this.title = h('h3.sl-coach-title');
    this.text = h('p.sl-coach-text');
    this.hint = h('p.sl-coach-hint');
    this.actions = h('div.sl-coach-actions');
    this.el = h('section.sl-panel.sl-coach', { 'aria-live': 'polite', 'aria-label': 'Tutorial' }, this.counter, this.title, this.text, this.hint, this.actions);
    this.unsubscribe = host.store.subscribe((kinds) => {
      if (kinds.has('load')) return;
      if (kinds.has('drop') || kinds.has('geometry') || kinds.has('settings') || kinds.has('selection')) this.check(kinds.has('drop'));
    });
    this.show();
  }

  /** Id of the element placed for a target (snapped elements keep the user's id). */
  idOf(key: TargetKey): string {
    return this.placed.get(key) ?? TARGETS[key].id;
  }

  /** Dock the card at the top while the loom editor occupies the bottom. */
  setDockTop(top: boolean): void {
    if (this.el.classList.contains('sl-coach-top') === top) return;
    this.el.classList.toggle('sl-coach-top', top);
    this.host.relayout();
  }

  snapNow(): void {
    this.check(true);
  }

  /** Place the current step's element on its outline; returns its id (for the ghost click). */
  placeFromGhost(): string | null {
    const step = this.step;
    if (!step?.place || this.phase !== 'task') return null;
    const t = structuredClone(TARGETS[step.place]);
    this.host.store.add(t);
    this.placed.set(step.place, t.id);
    this.complete();
    return t.id;
  }

  private get step(): Step | undefined {
    return STEPS[this.index];
  }

  private button(text: string, fn: () => void, variant: '' | 'primary' | 'quiet' = ''): HTMLButtonElement {
    const b = h('button.sl-btn', { type: 'button', text });
    if (variant) b.classList.add(`sl-btn-${variant}`);
    b.addEventListener('click', fn);
    return b;
  }

  private show(): void {
    const step = this.step;
    this.hint.textContent = '';
    this.actions.replaceChildren();
    if (!step) {
      this.host.setGhost(null);
      this.host.highlight(null);
      this.counter.textContent = 'Done';
      this.title.textContent = 'You built an instrument.';
      this.text.textContent =
        'Everything you hear comes from where the light goes. Keep playing with this table, or open a finished one to see what else light can do.';
      this.actions.append(
        this.button('Afterglow', () => this.host.openDemo('afterglow'), 'primary'),
        this.button('Gymnopédie', () => this.host.openDemo('gymnopedie')),
        this.button('Keep playing', () => this.close()),
      );
      return;
    }
    this.counter.textContent = `${this.index + 1} / ${STEPS.length}`;
    this.title.textContent = step.title;
    if (this.phase === 'result') {
      this.el.classList.add('sl-coach-done');
      this.title.textContent = `✓ ${step.title}`;
      this.text.textContent = step.result;
      this.host.setGhost(null);
      this.host.highlight(null);
      if (step.restore) this.actions.append(this.button('Put it back & continue', () => this.restoreAndNext(), 'primary'));
      else this.actions.append(this.button('Next', () => this.next(), 'primary'));
      this.actions.append(this.button('Skip tutorial', () => this.close(), 'quiet'));
      return;
    }
    this.el.classList.remove('sl-coach-done');
    this.text.textContent = step.task;
    const target = step.place ? TARGETS[step.place] : null;
    this.host.setGhost(target);
    this.host.highlight(target ? target.kind : null);
    this.actions.append(this.button('Do it for me', () => this.doIt()));
    this.actions.append(this.button('Skip tutorial', () => this.close(), 'quiet'));
  }

  private doIt(): void {
    const step = this.step;
    if (!step || this.phase !== 'task') return;
    if (step.place) {
      this.placeFromGhost();
    } else if (step.auto) {
      step.auto(this.host.store, this);
      this.check(true);
    }
  }

  private check(dropped: boolean): void {
    const step = this.step;
    if (!step || this.phase !== 'task') return;
    const scene = this.host.store.scene;
    if (step.place) {
      const target = TARGETS[step.place];
      const claimed = new Set(this.placed.values());
      const candidates = scene.elements.filter((e) => e.kind === target.kind && !claimed.has(e.id));
      if (candidates.length === 0 || !dropped) return;
      const nearest = candidates.reduce((a, b) => (dist(a.pos, target.pos) <= dist(b.pos, target.pos) ? a : b));
      // The first element of the kind always goes to its spot; later ones must be close.
      if (candidates.length > 1 && dist(nearest.pos, target.pos) > SNAP_RADIUS) {
        this.hint.textContent = 'Drop it on the glowing outline and it will click into place.';
        return;
      }
      const { id: _id, ...params } = structuredClone(target);
      this.host.store.updateElement(nearest.id, (e) => Object.assign(e, params));
      this.placed.set(step.place, nearest.id);
      this.complete();
    } else if (step.done?.(scene, this)) {
      this.complete();
    }
  }

  private complete(): void {
    this.step?.after?.(this.host);
    this.phase = 'result';
    this.show();
  }

  private restoreAndNext(): void {
    for (const key of ['prism', 'receptor'] as TargetKey[]) {
      const t = TARGETS[key];
      this.host.store.updateElement(this.idOf(key), (e) => {
        e.pos = { ...t.pos };
        e.rotation = t.rotation;
      });
    }
    this.next();
  }

  private next(): void {
    this.index += 1;
    this.phase = 'task';
    this.show();
  }

  close(): void {
    this.host.setGhost(null);
    this.host.highlight(null);
    this.unsubscribe();
    this.el.remove();
    this.host.finish();
  }
}
