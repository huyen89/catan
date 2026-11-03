import {
  RESOURCES,
  totalResources,
  type PlayerView,
  type ResourceCounts,
  type Seat,
} from '@hexhaven/engine';

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
  /** Seats we already traded with during `turn` (their hands have changed since they answered). */
  partners: Seat[];
  /** We decided to end the turn and are withdrawing our offers: make no new ones. */
  closing: boolean;
  /** Easy bots' once-per-turn roll for whether to try a player trade at all. */
  easyRoll: number | null;
}

export const newMemo = (): BotMemo => ({
  turn: '',
  offered: [],
  partners: [],
  closing: false,
  easyRoll: null,
});

export const turnKey = (view: PlayerView): string => `${view.turn.number}:${view.turn.current}`;

/** Reset `memo` in place if it belongs to another turn. */
export function syncMemo(memo: BotMemo, view: PlayerView): BotMemo {
  const key = turnKey(view);
  if (memo.turn !== key) {
    memo.turn = key;
    memo.offered = [];
    memo.partners = [];
    memo.closing = false;
    memo.easyRoll = null;
  }
  return memo;
}

/**
 * True while `seat` has an open offer of its own that someone has not answered yet. The active
 * bot should not be scheduled then (callers hold it, with a timeout) so responders get a say
 * before it moves on or ends its turn. Works on a PlayerView or the full GameState.
 */
export const awaitingResponses = (view: Pick<PlayerView, 'trades'>, seat: Seat): boolean =>
  view.trades.some(
    (t) =>
      t.from === seat && t.counterTo === null && Object.values(t.responses).includes('pending'),
  );

/**
 * Deterministic stand-in for a per-turn random roll when no memo is kept: a hash of the turn
 * and seat mapped to [0,1).
 */
export function turnRoll(view: PlayerView, seat: Seat): number {
  let h = 2166136261;
  for (const c of `${view.turn.number}:${seat}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0) / 2 ** 32;
}

const countsKey = (c: ResourceCounts): string => RESOURCES.map((r) => c[r]).join(',');

/** Identity of a trade for "never re-offer the same thing" checks (recipients ignored). */
export const offerKey = (give: ResourceCounts, want: ResourceCounts): string =>
  `${countsKey(give)}>${countsKey(want)}`;

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
  if (totalResources(give) === 0 || totalResources(want) === 0) return false;
  return RESOURCES.every((r) => !(give[r] > 0 && want[r] > 0) && hand[r] >= give[r]);
}

/** True if `seat` is close enough to winning that helping them is a mistake. */
export const nearVictory = (view: PlayerView, seat: Seat): boolean =>
  (view.players[seat]?.publicVP ?? 0) >= view.config.vpToWin - 2;
