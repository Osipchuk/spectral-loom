import * as Tone from 'tone';

/** Kit pieces, low to high — the order colours map onto, red to violet. */
export const DRUM_PIECES = ['Kick', 'Tom', 'Snare', 'Clap', 'Hat', 'Open hat'] as const;
export const DRUM_BASE_MIDI = 36;

/** One kit piece: its synths (the snare has two) and the nodes that carry them to the kit's output. */
interface Piece {
  synths: Tone.ToneAudioNode[];
  nodes: Tone.ToneAudioNode[];
  hit(time: number, velocity: number): void;
}

/**
 * A small synthesized drum kit. Every piece is its own monophonic voice, so a kick and a
 * hat can land on the same step; all pieces share one output. A piece is built on its first
 * hit: a Tone synth keeps several audio nodes running even when silent (the two hats alone are
 * a dozen oscillators' worth), and most receptors only ever play a few of the pieces.
 */
export class DrumKit {
  readonly output: Tone.Gain;
  private pieces: (Piece | undefined)[] = [];

  constructor(private context: Tone.BaseContext) {
    this.output = new Tone.Gain({ gain: 1, context });
  }

  private build(piece: number): Piece {
    const context = this.context;
    const nodes: Tone.ToneAudioNode[] = [];
    const to = <T extends Tone.ToneAudioNode>(n: T, gain: number, filter?: Tone.BiquadFilter): T => {
      const g = new Tone.Gain({ gain, context });
      if (filter) {
        n.chain(filter, g, this.output);
        nodes.push(filter);
      } else {
        n.chain(g, this.output);
      }
      nodes.push(g);
      return n;
    };
    // Tone.BiquadFilter is the plain native filter (see toneFilter in engine.ts); Q 1 is what
    // Tone.Filter used when none was given.
    const filter = (type: BiquadFilterType, frequency: number, Q = 1): Tone.BiquadFilter => new Tone.BiquadFilter({ type, frequency, Q, context });
    switch (piece) {
      case 0: {
        const kick = to(
          new Tone.MembraneSynth({ context, pitchDecay: 0.045, octaves: 7, envelope: { attack: 0.001, decay: 0.42, sustain: 0, release: 0.1 } }),
          0.95,
        );
        return { synths: [kick], nodes, hit: (time, v) => kick.triggerAttackRelease('C1', 0.2, time, v) };
      }
      case 1: {
        const tom = to(
          new Tone.MembraneSynth({ context, pitchDecay: 0.06, octaves: 3, envelope: { attack: 0.001, decay: 0.32, sustain: 0, release: 0.1 } }),
          0.55,
        );
        return { synths: [tom], nodes, hit: (time, v) => tom.triggerAttackRelease('G1', 0.2, time, v) };
      }
      case 2: {
        const snare = to(
          new Tone.NoiseSynth({ context, noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.17, sustain: 0, release: 0.05 } }),
          0.4,
          filter('bandpass', 2200, 0.7),
        );
        const body = to(
          new Tone.MembraneSynth({ context, pitchDecay: 0.02, octaves: 2, envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.05 } }),
          0.35,
        );
        return {
          synths: [snare, body],
          nodes,
          hit: (time, v) => {
            snare.triggerAttackRelease(0.1, time, v);
            body.triggerAttackRelease('D2', 0.06, time, v * 0.8);
          },
        };
      }
      case 3: {
        const clap = to(
          new Tone.NoiseSynth({ context, noise: { type: 'pink' }, envelope: { attack: 0.004, decay: 0.12, sustain: 0, release: 0.08 } }),
          0.45,
          filter('bandpass', 1300, 1.2),
        );
        return {
          synths: [clap],
          nodes,
          hit: (time, v) => {
            // A clap is a few quick bursts.
            clap.triggerAttackRelease(0.02, time, v * 0.7);
            clap.triggerAttackRelease(0.08, time + 0.012, v);
          },
        };
      }
      case 4: {
        const hat = to(
          new Tone.MetalSynth({ context, harmonicity: 5.1, modulationIndex: 32, resonance: 7000, octaves: 1.5, envelope: { attack: 0.001, decay: 0.045, release: 0.02 } }),
          0.16,
          filter('highpass', 6500),
        );
        return { synths: [hat], nodes, hit: (time, v) => hat.triggerAttackRelease(300, 0.03, time, v) };
      }
      default: {
        const openHat = to(
          new Tone.MetalSynth({ context, harmonicity: 5.1, modulationIndex: 32, resonance: 6000, octaves: 1.5, envelope: { attack: 0.001, decay: 0.32, release: 0.1 } }),
          0.12,
          filter('highpass', 5500),
        );
        return { synths: [openHat], nodes, hit: (time, v) => openHat.triggerAttackRelease(300, 0.2, time, v) };
      }
    }
  }

  /** Last scheduled start per piece: Tone's noise sources refuse starts that are not later. */
  private lastHit = new Map<number, number>();

  hit(piece: number, time: number, velocity: number): void {
    const last = this.lastHit.get(piece) ?? -Infinity;
    // Two beams striking the same drum on the same step are one hit, not an error.
    if (time <= last + 0.001) return;
    this.lastHit.set(piece, time + (piece === 3 ? 0.012 : 0));
    const v = Math.max(0.05, Math.min(1, velocity));
    // Pieces 0–4 by number; anything else (above or below the kit) is the open hat, as ever.
    const key = piece >= 0 && piece <= 4 ? Math.floor(piece) : 5;
    const p = (this.pieces[key] ??= this.build(key));
    p.hit(time, v);
  }

  dispose(): void {
    for (const p of this.pieces) {
      if (!p) continue;
      for (const s of p.synths) s.dispose();
      for (const n of p.nodes) n.dispose();
    }
    this.pieces = [];
    this.output.dispose();
  }
}
