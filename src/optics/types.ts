import type { NodeId, Vec2 } from '../scene/types';
import type { RayLight } from './spectrum';

export type EndEvent =
  | { kind: 'bounds' }
  | { kind: 'absorbed'; elementId: NodeId }
  | { kind: 'receptor'; elementId: NodeId }
  | { kind: 'interact'; elementId: NodeId; role: string }
  | { kind: 'cutoff' };

export interface RaySegment {
  id: number;
  parent: number | null;
  start: Vec2;
  end: Vec2;
  dir: Vec2;
  length: number;
  light: RayLight;
  /** Radiant power fraction carried by this ray, 0..1. */
  intensity: number;
  /** Physical beam width at the start and its linear change per unit length (lenses). */
  width: number;
  widthRate: number;
  /** Cumulative optical path length from the emitter at `start`. */
  sStart: number;
  emitterId: NodeId;
  /** Last pulse source upstream (emitter or modulator) and its path position on this branch. */
  pulseSourceId: NodeId;
  pulseOriginS: number;
  endEvent: EndEvent;
  /** Neighbouring rays of one dispersed fan share a group; index orders them by wavelength. */
  group: { id: number; index: number; count: number } | null;
  /** Identifies the chain of surfaces this ray went through, to match fan neighbours. */
  pathKey: string;
  /** Number of mirror bounces on this branch (echo order). */
  bounces: number;
  depth: number;
  audible: boolean;
}

export interface ReceptorHit {
  receptorId: NodeId;
  segmentId: number;
  /** Path length at the receptor. */
  s: number;
  light: RayLight;
  intensity: number;
  width: number;
  pulseSourceId: NodeId;
  pulseOriginS: number;
  bounces: number;
  /** Offset along the receptor aperture, -0.5..0.5. */
  u: number;
}

export interface RayTree {
  segments: RaySegment[];
  receptorHits: ReceptorHit[];
  /** Points where a converging beam passes through its narrowest width. */
  foci: { pos: Vec2; segmentId: number; strength: number }[];
  truncated: boolean;
}

export interface TraceOptions {
  maxDepth: number;
  minIntensity: number;
  audioThreshold: number;
  maxSegments: number;
  minWidth: number;
}

export const DEFAULT_TRACE_OPTIONS: TraceOptions = {
  maxDepth: 12,
  minIntensity: 0.01,
  audioThreshold: 0.08,
  maxSegments: 1600,
  minWidth: 0.05,
};
