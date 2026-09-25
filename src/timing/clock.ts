/**
 * Beat ↔ audio-time mapping. The anchor moves on tempo changes so that the beat position is
 * continuous. Pure: audio time is always passed in, never read from a global.
 */
export class BeatClock {
  private t0 = 0;
  private beat0 = 0;

  constructor(public bpm: number) {}

  /** Start counting from `beat` at audio time `t`. */
  anchor(t: number, beat = 0): void {
    this.t0 = t;
    this.beat0 = beat;
  }

  beatAt(t: number): number {
    return this.beat0 + ((t - this.t0) * this.bpm) / 60;
  }

  timeAt(beat: number): number {
    return this.t0 + ((beat - this.beat0) * 60) / this.bpm;
  }

  setBpm(bpm: number, now: number): void {
    const b = this.beatAt(now);
    this.bpm = bpm;
    this.anchor(now, b);
  }

  get secondsPerBeat(): number {
    return 60 / this.bpm;
  }
}
