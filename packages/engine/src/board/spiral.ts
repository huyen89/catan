import { HEX_DIRECTIONS, hexId } from '../hex/coords';
import type { HexId } from '../types';

/** Official A..R token sequence for the 19-hex board, laid along the spiral. */
export const SPIRAL_SEQUENCE: readonly number[] = [
  5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11,
];

const hexDistance = (q: number, r: number): number =>
  (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;

/** Radius of `hexes` if they form a complete hexagon centred on (0,0), otherwise null. */
export function hexagonRadius(hexes: ReadonlyArray<{ q: number; r: number }>): number | null {
  const ids = new Set(hexes.map((h) => hexId(h.q, h.r)));
  let radius = 0;
  for (const h of hexes) radius = Math.max(radius, hexDistance(h.q, h.r));
  // Distinct hexes, all within `radius`, and as many as a full hexagon holds => it is the full hexagon.
  return ids.size === hexes.length && hexes.length === 3 * radius * (radius + 1) + 1
    ? radius
    : null;
}

/**
 * Hex ids of a radius-`radius` hexagon in spiral order: start at the outer corner hex in
 * direction `corner` (index into HEX_DIRECTIONS), walk each ring in one rotation direction,
 * step inward to the next ring's hex in the same corner direction, and finish at the centre.
 */
export function spiralWalk(radius: number, corner: number, clockwise: boolean): HexId[] {
  const out: HexId[] = [];
  for (let k = radius; k >= 1; k--) {
    const [cq, cr] = HEX_DIRECTIONS[corner]!;
    let q = cq * k;
    let r = cr * k;
    for (let side = 0; side < 6; side++) {
      // Counter-clockwise (screen) walks E, NE, NW... from the SW corner; i.e. corner + 2 + side.
      const dir = clockwise ? (corner + 4 - side + 12) % 6 : (corner + 2 + side) % 6;
      const [dq, dr] = HEX_DIRECTIONS[dir]!;
      for (let step = 0; step < k; step++) {
        out.push(hexId(q, r));
        q += dq;
        r += dr;
      }
    }
  }
  out.push(hexId(0, 0));
  return out;
}
