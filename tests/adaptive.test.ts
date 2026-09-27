import { describe, expect, it } from 'vitest';
import { ResolutionGovernor, type FrameWindow } from '../src/render/adaptive';

const win = (fps: number, capFps = 60, displayHz = 60): FrameWindow => ({ seconds: 0.5, ticks: displayHz / 2, frames: fps / 2, capFps });

/** Feed `n` identical windows; return the steps taken. */
function run(g: ResolutionGovernor, w: FrameWindow, n: number, canDown = true, canUp = true): number[] {
  return Array.from({ length: n }, () => g.feed(w, canDown, canUp));
}

describe('ResolutionGovernor', () => {
  it('leaves Eco alone when it draws its capped 30 fps', () => {
    const g = new ResolutionGovernor();
    expect(run(g, win(30, 30), 40, true, false)).not.toContain(-1);
  });

  it('does not count a 144 Hz display against the 60 fps cap', () => {
    const g = new ResolutionGovernor();
    expect(run(g, win(60, 60, 144), 40, true, false)).not.toContain(-1);
  });

  it('steps down when frames fall behind the cap, after the start-up hold', () => {
    const g = new ResolutionGovernor();
    const steps = run(g, win(40), 6);
    expect(steps.slice(0, 4)).toEqual([0, 0, 0, 0]);
    expect(steps[4]).toBe(-1);
  });

  it('notices a machine that is slow from the very first frame (display assumed ≥ 60 Hz)', () => {
    const g = new ResolutionGovernor();
    // Overloaded: rAF itself only ticks 35 times a second.
    expect(run(g, { seconds: 0.5, ticks: 17.5, frames: 17.5, capFps: 60 }, 6)).toContain(-1);
  });

  it('probes back up after steady comfortable windows, and waits longer after a failed probe', () => {
    const g = new ResolutionGovernor();
    const first = run(g, win(60), 10);
    const up = first.indexOf(1);
    expect(up).toBe(9);
    // The probe cannot be held: it is undone.
    const back = run(g, win(40), 3);
    expect(back).toContain(-1);
    // The next probe takes longer than the first one did.
    const again = run(g, win(60), 40);
    expect(again.indexOf(1)).toBeGreaterThan(up);
  });

  it('never steps where it may not', () => {
    const g = new ResolutionGovernor();
    expect(run(g, win(20), 20, false, false).every((s) => s === 0)).toBe(true);
    expect(run(g, win(60), 40, false, false).every((s) => s === 0)).toBe(true);
  });

  it('ignores held windows', () => {
    const g = new ResolutionGovernor();
    run(g, win(60), 10, true, false);
    g.hold(3);
    expect(run(g, win(10), 3)).toEqual([0, 0, 0]);
    expect(g.feed(win(10), true, true)).toBe(-1);
  });
});
