import type { Seat } from '@hexhaven/engine';

/**
 * Where each player sits around the virtual table. The viewer always sits at the bottom-left
 * corner (spectators see seat 0 there); everyone else follows clockwise, as they would around a
 * real table seen from above: up the left side, across the top, down the right side.
 */
export type TableSlot = 'bl' | 'ml' | 'tl' | 'tr' | 'mr' | 'br';

/** Slots for the other players, in clockwise order, by how many others there are. */
const OTHERS: Record<number, readonly TableSlot[]> = {
  0: [],
  1: ['tr'],
  2: ['tl', 'tr'],
  3: ['tl', 'tr', 'br'],
  4: ['ml', 'tl', 'tr', 'mr'],
  5: ['ml', 'tl', 'tr', 'mr', 'br'],
};

export function tableSlots(players: number, viewer: Seat | null): Map<Seat, TableSlot> {
  const base = viewer ?? 0;
  const others = OTHERS[players - 1] ?? OTHERS[5]!;
  const out = new Map<Seat, TableSlot>();
  for (let rel = 0; rel < players; rel++) {
    const seat = (base + rel) % players;
    out.set(seat, rel === 0 ? 'bl' : (others[rel - 1] ?? 'br'));
  }
  return out;
}
