import * as Tone from 'tone';

/** Kit pieces, low to high — the order colours map onto, red to violet. */
export const DRUM_PIECES = ['Kick', 'Tom', 'Snare', 'Clap', 'Hat', 'Open hat'] as const;
export const DRUM_BASE_MIDI = 36;

/**
 * A small synthesized drum kit. Every piece is its own monophonic voice, so a kick and a
 * hat can land on the same step; all pieces share one output.
 */
export class DrumKit {
  readonly output: Tone.Gain;
  private kick: Tone.MembraneSynth;
  private tom: Tone.MembraneSynth;
  private snare: Tone.NoiseSynth;
  private snareBody: Tone.MembraneSynth;
  private clap: Tone.NoiseSynth;
  private hat: Tone.MetalSynth;
  private openHat: Tone.MetalSynth;
  private nodes: Tone.ToneAudioNode[] = [];

  constructor(context: Tone.BaseContext) {
    this.output = new Tone.Gain({ gain: 1, context });
    const to = <T extends Tone.ToneAudioNode>(n: T, gain: number, filter?: Tone.Filter): T => {
      const g = new Tone.Gain({ gain, context });
      if (filter) {
        n.chain(filter, g, this.output);
        this.nodes.push(filter);
      } else {
        n.chain(g, this.output);
      }
      this.nodes.push(g);
      return n;
    };
    this.kick = to(
      new Tone.MembraneSynth({ context, pitchDecay: 0.045, octaves: 7, envelope: { attack: 0.001, decay: 0.42, sustain: 0, release: 0.1 } }),
      0.95,
    );
    this.tom = to(
      new Tone.MembraneSynth({ context, pitchDecay: 0.06, octaves: 3, envelope: { attack: 0.001, decay: 0.32, sustain: 0, release: 0.1 } }),
      0.55,
    );
    this.snare = to(
      new Tone.NoiseSynth({ context, noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.17, sustain: 0, release: 0.05 } }),
      0.4,
      new Tone.Filter({ type: 'bandpass', frequency: 2200, Q: 0.7, context }),
    );
    this.snareBody = to(
      new Tone.MembraneSynth({ context, pitchDecay: 0.02, octaves: 2, envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.05 } }),
      0.35,
    );
    this.clap = to(
      new Tone.NoiseSynth({ context, noise: { type: 'pink' }, envelope: { attack: 0.004, decay: 0.12, sustain: 0, release: 0.08 } }),
      0.45,
      new Tone.Filter({ type: 'bandpass', frequency: 1300, Q: 1.2, context }),
    );
    this.hat = to(
      new Tone.MetalSynth({
        context,
        harmonicity: 5.1,
        modulationIndex: 32,
        resonance: 7000,
        octaves: 1.5,
        envelope: { attack: 0.001, decay: 0.045, release: 0.02 },
      }),
      0.16,
      new Tone.Filter({ type: 'highpass', frequency: 6500, context }),
    );
    this.openHat = to(
      new Tone.MetalSynth({
        context,
        harmonicity: 5.1,
        modulationIndex: 32,
        resonance: 6000,
        octaves: 1.5,
        envelope: { attack: 0.001, decay: 0.32, release: 0.1 },
      }),
      0.12,
      new Tone.Filter({ type: 'highpass', frequency: 5500, context }),
    );
  }

  /** Last scheduled start per piece: Tone's noise sources refuse starts that are not later. */
  private lastHit = new Map<number, number>();

  hit(piece: number, time: number, velocity: number): void {
    const last = this.lastHit.get(piece) ?? -Infinity;
    // Two beams striking the same drum on the same step are one hit, not an error.
    if (time <= last + 0.001) return;
    this.lastHit.set(piece, time + (piece === 3 ? 0.012 : 0));
    const v = Math.max(0.05, Math.min(1, velocity));
    switch (piece) {
      case 0:
        this.kick.triggerAttackRelease('C1', 0.2, time, v);
        break;
      case 1:
        this.tom.triggerAttackRelease('G1', 0.2, time, v);
        break;
      case 2:
        this.snare.triggerAttackRelease(0.1, time, v);
        this.snareBody.triggerAttackRelease('D2', 0.06, time, v * 0.8);
        break;
      case 3:
        // A clap is a few quick bursts.
        this.clap.triggerAttackRelease(0.02, time, v * 0.7);
        this.clap.triggerAttackRelease(0.08, time + 0.012, v);
        break;
      case 4:
        this.hat.triggerAttackRelease(300, 0.03, time, v);
        break;
      default:
        this.openHat.triggerAttackRelease(300, 0.2, time, v);
    }
  }

  dispose(): void {
    for (const s of [this.kick, this.tom, this.snare, this.snareBody, this.clap, this.hat, this.openHat]) s.dispose();
    for (const n of this.nodes) n.dispose();
    this.output.dispose();
  }
}
