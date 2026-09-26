import type { Loom, LoomSlot, Vec2 } from '../scene/types';
import { dot, fromAngle, perp, sub } from './vec2';

/** Slots on an engine-2 card that has none of its own. */
export const DEFAULT_SLOT_COUNT = 12;
/** Card left standing between two default slots, as a fraction of one slot pitch. */
const DEFAULT_SLOT_GAP = 0.12;

/** Position of a point along a card, −0.5 (one end) … 0.5 (the other). */
export function cardU(loom: Pick<Loom, 'pos' | 'rotation' | 'length'>, p: Vec2): number {
  return dot(sub(p, loom.pos), perp(fromAngle(loom.rotation))) / loom.length;
}

export function defaultSlots(count = DEFAULT_SLOT_COUNT): LoomSlot[] {
  const pitch = 1 / count;
  return Array.from({ length: count }, (_, i) => ({
    u0: -0.5 + (i + DEFAULT_SLOT_GAP / 2) * pitch,
    u1: -0.5 + (i + 1 - DEFAULT_SLOT_GAP / 2) * pitch,
  }));
}

export function loomSlots(loom: Pick<Loom, 'slots'>): LoomSlot[] {
  return loom.slots && loom.slots.length > 0 ? loom.slots : defaultSlots();
}

/** Index of the slot that position u falls through, or −1 where the card is solid. */
export function slotAt(slots: readonly LoomSlot[], u: number): number {
  for (let i = 0; i < slots.length; i++) if (u >= slots[i]!.u0 && u < slots[i]!.u1) return i;
  return -1;
}
