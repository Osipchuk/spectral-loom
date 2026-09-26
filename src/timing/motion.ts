import { trace } from '../optics/tracer';
import type { Motion, SceneModel } from '../scene/types';
import { planNotes, type NoteTemplate } from './arrivals';

/**
 * Moving optics. An element with a `motion` turns on the beat clock, so the light (and with
 * it every note) changes as the music plays: a swinging prism sweeps the rainbow across a
 * card and the same holes play a melody that rises and falls.
 *
 * Audio takes the pose at each note's launch, sampled every sixteenth: a pulse launched
 * then travels through the glass as it stood at that moment. Light on screen follows the
 * pose continuously.
 */
export const MOTION_STEP = 0.25;
/** Plans kept per scene; a long turn cycles through fresh poses and drops the oldest. */
const CACHE_FRAMES = 512;

/** Angle, radians, that a motion adds to the element's own rotation at `beat`. */
export function motionAngle(m: Motion, beat: number, beatsPerBar: number): number {
  const bars = beat / beatsPerBar;
  const deg = m.kind === 'turn' ? m.degPerBar * bars : m.degrees * Math.sin((2 * Math.PI * bars) / Math.max(0.25, m.bars));
  return (deg * Math.PI) / 180;
}

export function hasMotion(scene: SceneModel): boolean {
  return scene.elements.some((e) => e.enabled && isMoving(e.motion));
}

function isMoving(m: Motion | undefined): m is Motion {
  return !!m && (m.kind === 'turn' ? m.degPerBar !== 0 : m.degrees !== 0);
}

/** The scene as it stands at `beat`. The same object when nothing moves. */
export function poseAt(scene: SceneModel, beat: number): SceneModel {
  if (!hasMotion(scene)) return scene;
  const bpb = scene.settings.beatsPerBar;
  return {
    ...scene,
    elements: scene.elements.map((e) => (e.enabled && isMoving(e.motion) ? { ...e, rotation: e.rotation + motionAngle(e.motion, beat, bpb) } : e)),
  };
}

/** Note templates of a moving scene, by launch beat, traced lazily one sixteenth at a time. */
export class MovingPlan {
  private frames = new Map<number, NoteTemplate[]>();
  private longest = 0;

  constructor(private scene: SceneModel) {
    this.at(0);
  }

  /** Templates for a pulse launched at `beat`. */
  at(beat: number): NoteTemplate[] {
    const f = Math.floor(beat / MOTION_STEP + 1e-9);
    let plan = this.frames.get(f);
    if (!plan) {
      const posed = poseAt(this.scene, f * MOTION_STEP);
      plan = planNotes(posed, trace(posed));
      if (this.frames.size >= CACHE_FRAMES) this.frames.delete(this.frames.keys().next().value!);
      this.frames.set(f, plan);
      for (const t of plan) this.longest = Math.max(this.longest, t.offsetBeats);
    }
    return plan;
  }

  /** How far back a note's launch can lie: the longest light path seen so far, plus slack. */
  get maxOffset(): number {
    return this.longest + 2;
  }
}
