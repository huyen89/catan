import { nextInt, shuffle, type RngState } from '../rng';

/** Ports in 'random' mode keep at least this many coastline steps apart (2 = one free edge between). */
export const RANDOM_PORT_GAP = 2;

/**
 * Pick `count` distinct positions on a cyclic coastline of `coastLen` edges such that consecutive
 * positions are at least `RANDOM_PORT_GAP` apart (so no two ports share a vertex and at least one
 * coastal edge separates them). Returns positions in coastline walk order, starting from a random
 * offset. Mutates `rng`.
 *
 * Exact and rejection-free: the free edges ("slack") beyond the minimum gaps are split into a
 * uniformly random composition and the whole pattern is rotated by a uniform offset. Every valid
 * set arises from exactly `count` (offset, composition) pairs, so the sets are uniformly distributed.
 * If the coastline is too short for the gap, the gap shrinks to what fits (never below 1).
 */
export function randomPortPositions(coastLen: number, count: number, rng: RngState): number[] {
  if (count === 0) return [];
  if (count > coastLen) {
    throw new Error(`randomPortPositions: ${count} ports do not fit on ${coastLen} coastal edges`);
  }
  const gap = Math.max(1, Math.min(RANDOM_PORT_GAP, Math.floor(coastLen / count)));
  const slack = coastLen - gap * count;

  // Stars and bars: choose count-1 bar positions among slack+count-1 cells.
  const cells = Array.from({ length: slack + count - 1 }, (_, i) => i);
  const bars = shuffle(rng, cells)
    .slice(0, count - 1)
    .sort((a, b) => a - b);
  const extra: number[] = [];
  let prev = -1;
  for (const b of bars) {
    extra.push(b - prev - 1);
    prev = b;
  }
  extra.push(cells.length - prev - 1);

  const offset = nextInt(rng, 0, coastLen - 1);
  const out: number[] = [];
  let pos = offset;
  for (let i = 0; i < count; i++) {
    out.push(pos % coastLen);
    pos += gap + extra[i]!;
  }
  return out;
}
