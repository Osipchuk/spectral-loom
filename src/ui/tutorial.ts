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
}

/** Drops within this distance of the outline click into place. */
const SNAP_RADIUS = 7;

/** "Ah vous dirai-je, maman" — Twinkle, Twinkle, Little Star (18th-century French tune). */
const TWINKLE =
  'C4 C4 G4 G4 A4 A4 G4:2 | F4 F4 E4 E4 D4 D4 C4:2 | G4 G4 F4 F4 E4 E4 D4:2 | G4 G4 F4 F4 E4 E4 D4:2 | C4 C4 G4 G4 A4 A4 G4:2 | F4 F4 E4 E4 D4 D4 C4:2';

const ORIGIN = { x: 7, y: 16 };
const P = chainPoints(ORIGIN, 0);

/** Where each tutorial element goes (ids are assigned when the user places it). */
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

interface Step {
  title: string;
  text: string;
  /** Element the user must place; the step completes once it is snapped into place. */
  place?: keyof typeof TARGETS;
  /** Custom completion check (for steps without placement). */
  done?: (scene: SceneModel) => boolean;
  /** Called once when the step completes. */
  after?: (host: TutorialHost) => void;
  cta?: string;
}

const STEPS: Step[] = [
  {
    title: 'A lamp',
    text: 'Drag an Emitter from the left onto the glowing outline (or just click the outline). It shines a beam of white light, and every beat it sends a swell of brightness down the beam.',
    place: 'emitter',
  },
  {
    title: 'Split the light',
    text: 'Now put a Prism into the beam. Glass bends violet more than red, so white light fans out into a rainbow. Here, colour is pitch: red is low, violet is high.',
    place: 'prism',
  },
  {
    title: 'Catch it',
    text: 'Place a Receptor where the rainbow lands. Every colour it catches becomes a note, so you hear a chord on each beat. It is tilted, so red arrives just before violet: a strum.',
    place: 'receptor',
    after: (host) => host.ensureAudio(),
  },
  {
    title: 'Distance is time',
    text: 'Light is slow on this table. Watch the swells travel from the prism to the receptor and land exactly on the note. Try dragging the receptor a little: the chord changes as it catches different colours.',
    cta: 'Next',
  },
  {
    title: 'Write a melody',
    text: 'Drop a Loom card across the rainbow, near the prism. It is a punched card: at each step its holes let a swell through on one colour only, so instead of a chord you hear a tune.',
    place: 'loom',
    after: (host) => host.store.updateSettings({ scale: 'major', root: 0, bpm: 100 }),
  },
  {
    title: 'Change the voice',
    text: 'Click the receptor and, in the panel on the right, switch its Voice to Bell. Same light, new instrument.',
    done: (scene) => scene.elements.some((e) => e.kind === 'receptor' && e.instrument !== 'pluck'),
  },
];

/**
 * Guided first run: builds emitter → prism → receptor → loom card with the user, one
 * element at a time. Each target is shown as a ghost on the table; anything dropped near
 * it snaps into place, and "Do it for me" is always available.
 */
export class Tutorial {
  readonly el: HTMLElement;
  private index = 0;
  private placed = new Map<string, string>();
  private unsubscribe: () => void;
  private body: HTMLElement;
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
    this.body = h('div.sl-coach-body', {}, this.counter, this.title, this.text, this.hint, this.actions);
    this.el = h('section.sl-panel.sl-coach', { 'aria-live': 'polite', 'aria-label': 'Tutorial' }, this.body);
    this.unsubscribe = host.store.subscribe((kinds) => {
      if (kinds.has('load')) return;
      if (kinds.has('drop') || kinds.has('geometry') || kinds.has('settings') || kinds.has('selection')) this.check(kinds.has('drop'));
    });
    this.show();
  }

  /** Called by the host when an element was dropped by a click (not a drag). */
  snapNow(): void {
    this.check(true);
  }

  private get step(): Step | undefined {
    return STEPS[this.index];
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
        'Everything you hear comes from where the light goes. Try moving the prism, or open a demo to see what a full table can do.';
      this.actions.append(
        h('button.sl-btn.sl-btn-primary', { type: 'button', text: 'Gymnopédie', onclick: () => this.host.openDemo('gymnopedie') }),
        h('button.sl-btn', { type: 'button', text: 'Canon in D', onclick: () => this.host.openDemo('canon') }),
        h('button.sl-btn', { type: 'button', text: 'Keep playing', onclick: () => this.close() }),
      );
      return;
    }
    this.counter.textContent = `${this.index + 1} / ${STEPS.length}`;
    this.title.textContent = step.title;
    this.text.textContent = step.text;
    const target = step.place ? TARGETS[step.place] : null;
    this.host.setGhost(target);
    this.host.highlight(target ? target.kind : null);
    if (target) {
      this.actions.append(h('button.sl-btn', { type: 'button', text: 'Do it for me', onclick: () => this.doIt() }));
    }
    if (step.cta) {
      this.actions.append(h('button.sl-btn.sl-btn-primary', { type: 'button', text: step.cta, onclick: () => this.advance() }));
    }
    if (step.done && !step.cta) {
      this.actions.append(h('button.sl-btn', { type: 'button', text: 'Do it for me', onclick: () => this.doIt() }));
    }
    this.actions.append(h('button.sl-btn.sl-btn-quiet', { type: 'button', text: 'Skip tutorial', onclick: () => this.close() }));
  }

  /** Place the current step's element on its outline; returns its id (for the ghost click). */
  placeFromGhost(): string | null {
    const step = this.step;
    if (!step?.place) return null;
    const t = structuredClone(TARGETS[step.place]);
    this.host.store.add(t);
    this.placed.set(step.place, t.id);
    this.complete();
    return t.id;
  }

  private doIt(): void {
    const step = this.step;
    if (!step) return;
    if (step.place) {
      const t = structuredClone(TARGETS[step.place]);
      this.host.store.add(t);
      this.placed.set(step.place, t.id);
      this.complete();
    } else if (this.index === 5) {
      const r = this.host.store.scene.elements.find((e) => e.kind === 'receptor');
      if (r) {
        // Re-select after the change so the inspector shows the new voice.
        this.host.store.select(null);
        this.host.store.updateElement(r.id, (e) => {
          if (e.kind === 'receptor') e.instrument = 'bell';
        });
        this.host.store.select(r.id);
      }
    }
  }

  private check(dropped: boolean): void {
    const step = this.step;
    if (!step) return;
    const scene = this.host.store.scene;
    if (step.place) {
      const target = TARGETS[step.place];
      // Snap the nearest unclaimed element of the right kind, once the user lets go.
      const claimed = new Set(this.placed.values());
      const candidates = scene.elements.filter((e) => e.kind === target.kind && !claimed.has(e.id));
      if (candidates.length === 0) return;
      const nearest = candidates.reduce((a, b) => (dist(a.pos, target.pos) <= dist(b.pos, target.pos) ? a : b));
      if (!dropped) return;
      // The first element of the kind always goes to its spot; later ones must be close.
      if (candidates.length > 1 && dist(nearest.pos, target.pos) > SNAP_RADIUS) {
        this.hint.textContent = 'Drop it on the glowing outline and it will click into place.';
        return;
      }
      const { id: _id, ...params } = structuredClone(target);
      this.host.store.updateElement(nearest.id, (e) => Object.assign(e, params));
      this.placed.set(step.place, nearest.id);
      this.complete();
    } else if (step.done?.(scene)) {
      this.complete();
    }
  }

  private complete(): void {
    this.step?.after?.(this.host);
    this.advance();
  }

  private advance(): void {
    this.index += 1;
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
