import { RESOURCES, type PlayerView, type ResourceCounts, type Seat } from '@hexhaven/engine';
import { sumCounts } from './eval';

/**
 * Per-seat memory a long-lived bot keeps across `decide` calls within one turn. `decide` is
 * stateless by default; passing a memo only tightens trade behaviour (exact per-turn offer cap,
 * no re-offering a closed trade, explicit cancels before END_TURN).
 */
export interface BotMemo {
  /** Turn the memo belongs to (see `turnKey`); a different turn resets it. */
  turn: string;
  /** `offerKey`s of every offer this bot made during `turn`. */
  offered: string[];
  /** We decided to end the turn and are withdrawing our offers: make no new ones. */
  closing: boolean;
}

export const newMemo = (): BotMemo => ({ turn: '', offered: [], closing: false });

export const turnKey = (view: PlayerView): string => `${view.turn.number}:${view.turn.current}`;

/** Reset `memo` in place if it belongs to another turn. */
export function syncMemo(memo: BotMemo, view: PlayerView): BotMemo {
  const key = turnKey(view);
  if (memo.turn !== key) {
    memo.turn = key;
    memo.offered = [];
    memo.closing = false;
  }
  return memo;
}

const countsKey = (c: ResourceCounts): string => RESOURCES.map((r) => c[r]).join(',');

/** Identity of a trade for "never re-offer the same thing" checks (recipients ignored). */
export const offerKey = (give: ResourceCounts, want: ResourceCounts): string =>
  `${countsKey(give)}>${countsKey(want)}`;

export const counts = (part: Partial<ResourceCounts>): ResourceCounts => ({
  brick: 0,
  lumber: 0,
  wool: 0,
  grain: 0,
  ore: 0,
  ...part,
});

/**
 * Value of a hand toward a build cost: cards the cost still needs are worth a lot, surplus
 * cards little.
 */
export function handValue(hand: ResourceCounts, cost: ResourceCounts): number {
  let v = 0;
  for (const r of RESOURCES)
    v += Math.min(hand[r], cost[r]) * 2 + Math.max(0, hand[r] - cost[r]) * 0.6;
  return v;
}

/** Change in `handValue` if we give `give` and receive `get`. */
export function tradeGain(
  hand: ResourceCounts,
  cost: ResourceCounts,
  give: ResourceCounts,
  get: ResourceCounts,
): number {
  const after = { ...hand };
  for (const r of RESOURCES) after[r] += get[r] - give[r];
  return handValue(after, cost) - handValue(hand, cost);
}

/** Structurally valid trade we can pay for: both sides non-empty, disjoint, covered by `hand`. */
export function validTrade(
  hand: ResourceCounts,
  give: ResourceCounts,
  want: ResourceCounts,
): boolean {
  if (sumCounts(give) === 0 || sumCounts(want) === 0) return false;
  return RESOURCES.every((r) => !(give[r] > 0 && want[r] > 0) && hand[r] >= give[r]);
}

/** True if `seat` is close enough to winning that helping them is a mistake. */
export const nearVictory = (view: PlayerView, seat: Seat): boolean =>
  (view.players[seat]?.publicVP ?? 0) >= view.config.vpToWin - 2;
