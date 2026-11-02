import {
  RESOURCES,
  emptyResources,
  hasResources,
  totalResources,
  type Action,
  type Resource,
  type ResourceCounts,
  type Seat,
  type TradeOffer,
} from '@hexhaven/engine';

/** Local state of the player-trade composer. */
export interface TradeDraft {
  give: ResourceCounts;
  want: ResourceCounts;
  /** null = everyone else. */
  to: Seat[] | null;
  counterTo: number | null;
}

export const emptyDraft = (): TradeDraft => ({
  give: emptyResources(),
  want: emptyResources(),
  to: null,
  counterTo: null,
});

/** Return a copy of `counts` with `res` changed by `delta`, clamped to [0, max]. */
export function adjustCount(
  counts: ResourceCounts,
  res: Resource,
  delta: number,
  max = 99,
): ResourceCounts {
  const next = Math.max(0, Math.min(max, counts[res] + delta));
  return { ...counts, [res]: next };
}

/** Why the draft can't be sent (null when it can). */
export function draftProblem(draft: TradeDraft, hand: ResourceCounts | undefined): string | null {
  if (totalResources(draft.give) === 0) return 'Choose what you give';
  if (totalResources(draft.want) === 0) return 'Choose what you want';
  if (RESOURCES.some((r) => draft.give[r] > 0 && draft.want[r] > 0))
    return 'A resource cannot be on both sides';
  if (!hand || !hasResources(hand, draft.give)) return "You don't have those cards";
  if (draft.to !== null && draft.to.length === 0) return 'Choose at least one player';
  return null;
}

export function draftToAction(draft: TradeDraft): Extract<Action, { type: 'OFFER_TRADE' }> {
  return {
    type: 'OFFER_TRADE',
    give: { ...draft.give },
    want: { ...draft.want },
    to: draft.to && draft.to.length ? [...draft.to].sort((a, b) => a - b) : null,
    counterTo: draft.counterTo,
  };
}

/** Pre-filled counter-offer: swap the sides and address it back to the offerer. */
export function counterDraft(offer: TradeOffer): TradeDraft {
  return {
    give: { ...offer.want },
    want: { ...offer.give },
    to: [offer.from],
    counterTo: offer.id,
  };
}

export type OfferRole = 'mine' | 'toMe' | 'other';

export function offerRole(offer: TradeOffer, me: Seat | null): OfferRole {
  if (me === null) return 'other';
  if (offer.from === me) return 'mine';
  return String(me) in offer.responses ? 'toMe' : 'other';
}

export function myResponse(offer: TradeOffer, me: Seat | null) {
  return me === null ? undefined : offer.responses[String(me)];
}

export function acceptedSeats(offer: TradeOffer): Seat[] {
  return Object.entries(offer.responses)
    .filter(([, r]) => r === 'accept')
    .map(([s]) => Number(s))
    .sort((a, b) => a - b);
}

/**
 * Toggle a recipient. From "everyone" (null) a click selects just that seat; an empty selection,
 * or one that names every other seat, collapses back to "everyone" (null).
 */
export function toggleRecipient(to: Seat[] | null, seat: Seat, others: Seat[]): Seat[] | null {
  if (to === null) return [seat];
  const next = to.includes(seat) ? to.filter((s) => s !== seat) : [...to, seat];
  if (next.length === 0) return null;
  if (others.every((s) => next.includes(s))) return null;
  return next.sort((a, b) => a - b);
}

/** Identifies the turn a draft was composed in; drafts do not carry over to another turn. */
export const turnKey = (turn: { number: number; current: Seat }): string =>
  `${turn.number}:${turn.current}`;

/**
 * The draft to show: an empty one when the turn has changed since it was composed, or when the
 * offer it counters is no longer open.
 */
export function liveDraft(
  draft: TradeDraft,
  composedIn: string,
  turn: { number: number; current: Seat },
  trades: ReadonlyArray<{ id: number }>,
): TradeDraft {
  if (composedIn !== turnKey(turn)) return emptyDraft();
  if (draft.counterTo !== null && !trades.some((t) => t.id === draft.counterTo))
    return emptyDraft();
  return draft;
}

/** Resources the player can hand to the bank (have at least the ratio). */
export function maritimeGiveOptions(
  hand: ResourceCounts | undefined,
  ratios: ResourceCounts,
): Resource[] {
  if (!hand) return [];
  return RESOURCES.filter((r) => hand[r] >= ratios[r]);
}

/** Per-resource upper bounds while picking discards: the hand, and no more than `count` total. */
export function discardLimits(
  selection: ResourceCounts,
  count: number,
  hand: ResourceCounts | undefined,
): ResourceCounts {
  const left = Math.max(0, count - totalResources(selection));
  const out = emptyResources();
  for (const r of RESOURCES) out[r] = Math.min(hand?.[r] ?? 0, selection[r] + left);
  return out;
}

/** A discard selection is complete when it has exactly `count` cards, all from the hand. */
export function discardReady(
  selection: ResourceCounts,
  count: number,
  hand: ResourceCounts | undefined,
): boolean {
  return (
    count > 0 && totalResources(selection) === count && !!hand && hasResources(hand, selection)
  );
}
