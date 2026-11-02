import { nextFloat, shuffle, type RngState } from '../rng';

/** Tokens rolled most often (5/36 each). Two of them must never touch. */
export const isRedToken = (n: number): boolean => n === 6 || n === 8;

/**
 * Search effort for the strict constraint before giving up on it. Most attempts succeed within
 * ~n nodes; a small per-attempt budget with fresh restarts beats deep backtracking. Worst case is
 * bounded by STRICT_ATTEMPTS * STRICT_NODE_BUDGET nodes.
 */
const STRICT_ATTEMPTS = 50;
const STRICT_NODE_BUDGET = 80;

/**
 * Place a multiset of number tokens onto `neighbors.length` slots (slot adjacency given as index
 * lists). Mutates `rng`; always terminates and returns tokens[slot].
 *
 * 1. Strict: no adjacent 6/8 and no adjacent identical numbers. Randomized backtracking with a node
 *    budget per attempt and a fixed number of attempts.
 * 2. Relaxed (strict failed): only no adjacent 6/8. Exhaustive search for an independent set of
 *    slots for the red tokens; the rest are shuffled onto the remaining slots.
 * 3. If even that is impossible (degenerate layouts only), an unconstrained shuffle.
 */
export function placeRandomTokens(
  neighbors: ReadonlyArray<readonly number[]>,
  tokens: readonly number[],
  rng: RngState,
): number[] {
  if (tokens.length !== neighbors.length) {
    throw new Error(`placeRandomTokens: ${tokens.length} tokens for ${neighbors.length} slots`);
  }
  for (let attempt = 0; attempt < STRICT_ATTEMPTS; attempt++) {
    const placed = searchStrict(neighbors, tokens, rng);
    if (placed) return placed;
  }
  return placeRedsApart(neighbors, tokens, rng) ?? shuffle(rng, tokens);
}

const strictConflict = (a: number, b: number): boolean =>
  a === b || (isRedToken(a) && isRedToken(b));

/**
 * Distinct values with a remaining count, in a random order where each value's chance of coming
 * next is proportional to its remaining count (so the first pick matches a plain shuffle).
 */
function weightedOrder(rng: RngState, counts: Map<number, number>): number[] {
  const pool: Array<[number, number]> = [...counts].filter(([, c]) => c > 0);
  let total = pool.reduce((s, [, c]) => s + c, 0);
  const out: number[] = [];
  while (pool.length > 0) {
    let pick = nextFloat(rng) * total;
    let i = 0;
    while (i < pool.length - 1 && pick >= pool[i]![1]) pick -= pool[i++]![1];
    const [value, count] = pool.splice(i, 1)[0]!;
    out.push(value);
    total -= count;
  }
  return out;
}

/** One randomized backtracking attempt under the strict constraint; null when the budget runs out. */
function searchStrict(
  neighbors: ReadonlyArray<readonly number[]>,
  tokens: readonly number[],
  rng: RngState,
): number[] | null {
  const n = neighbors.length;
  const order = shuffle(
    rng,
    Array.from({ length: n }, (_, i) => i),
  );
  const counts = new Map<number, number>();
  // Sorted keys keep the weighted draw independent of the pool's input order.
  for (const t of [...tokens].sort((a, b) => a - b)) counts.set(t, (counts.get(t) ?? 0) + 1);
  const assigned: Array<number | undefined> = new Array<number | undefined>(n);
  let nodes = 0;

  const place = (k: number): boolean => {
    if (k === n) return true;
    if (++nodes > STRICT_NODE_BUDGET) return false;
    const slot = order[k]!;
    for (const value of weightedOrder(rng, counts)) {
      const clash = neighbors[slot]!.some((j) => {
        const other = assigned[j];
        return other !== undefined && strictConflict(value, other);
      });
      if (clash) continue;
      assigned[slot] = value;
      counts.set(value, counts.get(value)! - 1);
      if (place(k + 1)) return true;
      assigned[slot] = undefined;
      counts.set(value, counts.get(value)! + 1);
      if (nodes > STRICT_NODE_BUDGET) return false;
    }
    return false;
  };

  return place(0) ? (assigned as number[]) : null;
}

/**
 * Relaxed placement: put the red tokens on pairwise non-adjacent slots (exhaustive search over a
 * random slot order, so it terminates and finds a solution whenever one exists), shuffle the rest.
 */
function placeRedsApart(
  neighbors: ReadonlyArray<readonly number[]>,
  tokens: readonly number[],
  rng: RngState,
): number[] | null {
  const n = neighbors.length;
  const reds = shuffle(rng, tokens.filter(isRedToken));
  const others = shuffle(
    rng,
    tokens.filter((t) => !isRedToken(t)),
  );
  const order = shuffle(
    rng,
    Array.from({ length: n }, (_, i) => i),
  );
  const chosen: number[] = [];
  const blocked = new Array<number>(n).fill(0);

  const pick = (from: number): boolean => {
    if (chosen.length === reds.length) return true;
    for (let i = from; i <= n - (reds.length - chosen.length); i++) {
      const slot = order[i]!;
      if (blocked[slot]! > 0) continue;
      chosen.push(slot);
      blocked[slot]!++;
      for (const j of neighbors[slot]!) blocked[j]!++;
      if (pick(i + 1)) return true;
      chosen.pop();
      blocked[slot]!--;
      for (const j of neighbors[slot]!) blocked[j]!--;
    }
    return false;
  };
  if (!pick(0)) return null;

  const out = new Array<number>(n);
  chosen.forEach((slot, i) => (out[slot] = reds[i]!));
  let o = 0;
  for (let slot = 0; slot < n; slot++) if (!chosen.includes(slot)) out[slot] = others[o++]!;
  return out;
}
