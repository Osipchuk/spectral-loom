import * as Tone from 'tone';
import type { NoteTemplate } from '../timing/arrivals';
import type { PulseSource } from '../timing/sources';
import { trace } from '../optics/tracer';
import { planNotes } from '../timing/arrivals';
import { pulseSources } from '../timing/sources';
import type { Timeline } from '../capture/timeline';
import { AudioEngine } from './engine';

/**
 * Render a scripted film's soundtrack: every 50 ms the scene is re-read from the timeline,
 * re-traced and re-planned, and that window's notes are scheduled — exactly what the live
 * engine would have done while someone moved the glass.
 */
export async function renderTimelineWav(timeline: Timeline, masterDb: number): Promise<Blob> {
  const step = 0.05;
  const bpm = timeline.at(0).settings.bpm;
  const buffer = await Tone.Offline(async () => {
    const engine = new AudioEngine(bpm);
    await engine.buildGraph(masterDb);
    engine.clock.anchor(0, 0);
    for (let w = 0; w < timeline.duration; w += step) {
      const scene = timeline.at(w);
      engine.setPlan(planNotes(scene, trace(scene)), pulseSources(scene));
      engine.scheduleBeats(engine.clock.beatAt(w), engine.clock.beatAt(w + step), w - 1, 0);
    }
  }, timeline.duration + 3, 2);
  return encodeWav(buffer.toArray() as Float32Array[] | Float32Array, buffer.sampleRate);
}

/**
 * Render the instrument offline (faster than real time) with exactly the same graph and
 * note plan as live playback, and return a 16-bit stereo WAV.
 */
export async function renderWav(
  templates: NoteTemplate[],
  sources: Map<string, PulseSource>,
  bpm: number,
  masterDb: number,
  seconds: number,
): Promise<Blob> {
  const tail = 4;
  const buffer = await Tone.Offline(async () => {
    const engine = new AudioEngine(bpm);
    await engine.buildGraph(masterDb);
    engine.setPlan(templates, sources);
    engine.clock.anchor(0.05, 0);
    engine.scheduleBeats(0, engine.clock.beatAt(seconds), 0, 0);
  }, seconds + tail, 2);
  return encodeWav(buffer.toArray() as Float32Array[] | Float32Array, buffer.sampleRate);
}

export function encodeWav(data: Float32Array[] | Float32Array, sampleRate: number): Blob {
  const channels = Array.isArray(data) ? data : [data];
  const n = channels[0]!.length;
  const nch = channels.length;
  const bytes = 44 + n * nch * 2;
  const view = new DataView(new ArrayBuffer(bytes));
  const str = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  view.setUint32(4, bytes - 8, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, nch, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * nch * 2, true);
  view.setUint16(32, nch * 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, n * nch * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nch; c++) {
      const v = Math.max(-1, Math.min(1, channels[c]![i]!));
      view.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([view.buffer], { type: 'audio/wav' });
}
