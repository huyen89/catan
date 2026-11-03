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

/** Extra per-slot constraints for {@link placeRandomTokens}. Omitted = none (base boards). */
export interface SlotRules {
  /**
   * Tokens already on the board next to each slot (hexes outside the placement, e.g. a scenario's
   * fixed gold hex). They count as neighbours for both the 6/8 and the equal-number rule.
   */
  fixedNeighbors?: ReadonlyArray<readonly number[]>;
  /** Slots that should not get a 6/8 when achievable (gold hexes). */
  avoidRed?: readonly boolean[];
}

/**
 * Place a multiset of number tokens onto `neighbors.length` slots (slot adjacency given as index
 * lists). Mutates `rng`; always terminates and returns tokens[slot].
 *
 * 1. Strict: no adjacent 6/8, no adjacent identical numbers and no 6/8 on an `avoidRed` slot.
 *    Randomized backtracking with a node budget per attempt and a fixed number of attempts.
 * 2. Relaxed (strict failed): only no adjacent 6/8 and no 6/8 on an `avoidRed` slot. Exhaustive
 *    search for an independent set of slots for the red tokens; the rest are shuffled onto the
 *    remaining slots.
 * 3. As 2, but 6/8 may go on `avoidRed` slots (only tried when some slot avoids red).
 * 4. If even that is impossible (degenerate layouts only), an unconstrained shuffle.
 *
 * Fixed neighbours count as adjacent in steps 1-3: a slot next to a fixed 6/8 takes no 6/8.
 *
 * The fallbacks are coarse on purpose: each step drops a soft rule outright rather than
 * minimising its violations. Once step 1 fails, equal neighbours (including equal fixed
 * neighbours) are not avoided at all, and in step 3 any number of 6/8 may go on gold. On the
 * shipped layouts step 1 always succeeds (the property tests assert zero equal neighbours and no
 * 6/8 on gold over thousands of seeds), so the fallbacks only guarantee termination on degenerate
 * layouts. Making them finer would change the RNG draws of seeds that reach them.
 * Without rules the RNG draws are exactly those of the rule-less algorithm (base boards unchanged).
 */
export function placeRandomTokens(
  neighbors: ReadonlyArray<readonly number[]>,
  tokens: readonly number[],
  rng: RngState,
  rules: SlotRules = {},
): number[] {
  if (tokens.length !== neighbors.length) {
    throw new Error(`placeRandomTokens: ${tokens.length} tokens for ${neighbors.length} slots`);
  }
  const fixedOf = (slot: number): readonly number[] => rules.fixedNeighbors?.[slot] ?? [];
  const nearFixedRed = neighbors.map((_, slot) => fixedOf(slot).some(isRedToken));
  const noRed = nearFixedRed.map((near, slot) => near || rules.avoidRed?.[slot] === true);

  for (let attempt = 0; attempt < STRICT_ATTEMPTS; attempt++) {
    const placed = searchStrict(neighbors, tokens, rng, fixedOf, noRed);
    if (placed) return placed;
  }
  return (
    placeRedsApart(neighbors, tokens, rng, noRed) ??
    (rules.avoidRed?.some(Boolean) ? placeRedsApart(neighbors, tokens, rng, nearFixedRed) : null) ??
    shuffle(rng, tokens)
  );
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
  fixedOf: (slot: number) => readonly number[],
  noRed: readonly boolean[],
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
      const clash =
        (noRed[slot]! && isRedToken(value)) ||
        fixedOf(slot).some((other) => strictConflict(value, other)) ||
        neighbors[slot]!.some((j) => {
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
 * Relaxed placement: put the red tokens on pairwise non-adjacent slots outside `noRed` (exhaustive
 * search over a random slot order, so it terminates and finds a solution whenever one exists),
 * shuffle the rest.
 */
function placeRedsApart(
  neighbors: ReadonlyArray<readonly number[]>,
  tokens: readonly number[],
  rng: RngState,
  noRed: readonly boolean[],
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
      if (blocked[slot]! > 0 || noRed[slot]) continue;
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
