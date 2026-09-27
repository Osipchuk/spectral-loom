/** One measuring window of the frame loop. */
export interface FrameWindow {
  /** Wall-clock length of the window. */
  seconds: number;
  /** requestAnimationFrame callbacks in the window (the display's pace, when not overloaded). */
  ticks: number;
  /** Frames actually drawn (the frame cap skips some ticks on purpose). */
  frames: number;
  /** The quality level's frame cap. */
  capFps: number;
}

export type ResolutionStep = -1 | 0 | 1;

/** Below this share of the expected frame rate the machine is behind. */
const BEHIND = 0.85;
/** At or above this share a window counts as comfortable. */
const COMFORTABLE = 0.95;
/** Comfortable windows before the first try at a higher resolution, and the longest wait. */
const FIRST_WAIT = 6;
const LONGEST_WAIT = 60;

/**
 * Decides when to step the render resolution down or up. It compares the frames drawn with
 * the frames the frame cap asked for — not the raw frame interval, which also contains the
 * cap itself (Eco draws at 30 fps on purpose). The display rate is taken as the fastest tick
 * rate seen, at least 60 Hz, so a machine that is behind from the start is still noticed.
 * Going up is a probe: a step that cannot be held is undone and the next probe waits longer.
 */
export class ResolutionGovernor {
  private displayHz = 60;
  private comfortable = 0;
  private wait = FIRST_WAIT;
  private sinceUp = Infinity;
  /** Windows still to ignore (start-up, shader compiles, a resize settling). */
  private skip = 4;

  /** Ignore the next `windows` windows: the frame rate there says nothing about the load. */
  hold(windows = 4): void {
    this.skip = Math.max(this.skip, windows);
    this.comfortable = 0;
  }

  feed(w: FrameWindow, canDown: boolean, canUp: boolean): ResolutionStep {
    if (w.seconds <= 0) return 0;
    this.displayHz = Math.max(this.displayHz, w.ticks / w.seconds);
    if (this.skip > 0) {
      this.skip -= 1;
      return 0;
    }
    this.sinceUp += 1;
    const expected = Math.min(w.capFps, this.displayHz);
    const fps = w.frames / w.seconds;
    if (fps < expected * BEHIND) {
      this.comfortable = 0;
      if (!canDown) return 0;
      if (this.sinceUp <= 2) this.wait = Math.min(LONGEST_WAIT, this.wait * 2);
      this.skip = 2;
      return -1;
    }
    this.comfortable = fps >= expected * COMFORTABLE ? this.comfortable + 1 : 0;
    if (canUp && this.comfortable >= this.wait) {
      this.comfortable = 0;
      this.sinceUp = 0;
      this.skip = 1;
      return 1;
    }
    return 0;
  }
}
