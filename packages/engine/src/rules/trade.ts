import { err, type Ctx, type Handler, type HandlerMap } from '../context';
import {
  addResources,
  hasResources,
  isValidCounts,
  subtractResources,
  totalResources,
} from '../resources';
import { RESOURCES, type EngineError, type GameState, type Seat, type TradeOffer } from '../types';
import { counts, expectPhase, expectSeat, withVictoryCheck } from './flow';

/** Most open offers the active player may have at once (counter-offers are capped separately). */
export const MAX_OPEN_OFFERS = 3;

/** Open (non-counter) offers made by `seat`. */
export const openOffersBy = (state: GameState, seat: Seat): TradeOffer[] =>
  state.trades.filter((t) => t.from === seat && t.counterTo === null);

/** Both hands still cover their side of the offer if `partner` takes it. */
export function tradeExecutable(state: GameState, offer: TradeOffer, partner: Seat): boolean {
  return (
    hasResources(state.players[offer.from]!.resources, offer.give) &&
    hasResources(state.players[partner]!.resources, offer.want)
  );
}

/** Seats the creator of a (non-counter) offer could confirm with right now. */
export function confirmablePartners(state: GameState, offer: TradeOffer): Seat[] {
  if (offer.counterTo !== null) return [];
  return Object.entries(offer.responses)
    .filter(([, r]) => r === 'accept')
    .map(([s]) => Number(s))
    .filter((s) => tradeExecutable(state, offer, s));
}

/** Seats `seat` may address an offer to (everyone else). */
const others = (state: GameState, seat: Seat): Seat[] =>
  state.players.map((p) => p.seat).filter((s) => s !== seat);

function findOffer(ctx: Ctx, id: unknown): TradeOffer | undefined {
  return ctx.state.trades.find((t) => t.id === id);
}

/** Move the goods, close the offer and emit `traded`. */
function execute(ctx: Ctx, offer: TradeOffer, partner: Seat): EngineError | undefined {
  const s = ctx.state;
  if (!tradeExecutable(s, offer, partner)) {
    return err('INSUFFICIENT_RESOURCES', 'A player can no longer afford this trade');
  }
  const a = s.players[offer.from]!.resources;
  const b = s.players[partner]!.resources;
  subtractResources(a, offer.give);
  addResources(b, offer.give);
  subtractResources(b, offer.want);
  addResources(a, offer.want);
  s.trades = s.trades.filter((t) => t.id !== offer.id);
  ctx.events.push({
    type: 'traded',
    offerId: offer.id,
    a: offer.from,
    b: partner,
    aGave: { ...offer.give },
    bGave: { ...offer.want },
  });
  return undefined;
}

/** RULES.md#trading — domestic offers by the active player, counter-offers back to them. */
const offerTrade: Handler<'OFFER_TRADE'> = (ctx, a) => {
  const s = ctx.state;
  const bad = expectPhase(ctx, 'main');
  if (bad) return bad;
  if (!isValidCounts(a.give) || !isValidCounts(a.want)) {
    return err('INVALID_TRADE', 'Malformed resources');
  }
  const give = counts(a.give);
  const want = counts(a.want);
  if (totalResources(give) === 0 || totalResources(want) === 0) {
    return err('INVALID_TRADE', 'Both sides of a trade must be non-empty');
  }
  if (RESOURCES.some((r) => give[r] > 0 && want[r] > 0)) {
    return err('INVALID_TRADE', 'A resource cannot be on both sides of a trade');
  }

  let to: Seat[] | null;
  if (a.counterTo === null) {
    const notYours = expectSeat(ctx, s.turn.current);
    if (notYours) return notYours;
    if (openOffersBy(s, ctx.seat).length >= MAX_OPEN_OFFERS) {
      return err('INVALID_TRADE', `At most ${MAX_OPEN_OFFERS} open offers; cancel one first`);
    }
    if (a.to === null) to = null;
    else {
      const valid = others(s, ctx.seat);
      if (
        !Array.isArray(a.to) ||
        a.to.length === 0 ||
        new Set(a.to).size !== a.to.length ||
        !a.to.every((t) => valid.includes(t))
      ) {
        return err('INVALID_TRADE', 'Invalid recipients');
      }
      to = [...a.to].sort((x, y) => x - y);
    }
  } else {
    const orig = findOffer(ctx, a.counterTo);
    if (
      ctx.seat === s.turn.current ||
      !orig ||
      orig.from !== s.turn.current ||
      orig.counterTo !== null ||
      !Object.hasOwn(orig.responses, String(ctx.seat))
    ) {
      return err('INVALID_TRADE', 'You can only counter an offer the active player made to you');
    }
    if (
      a.to !== null &&
      !(Array.isArray(a.to) && a.to.length === 1 && a.to[0] === s.turn.current)
    ) {
      return err('INVALID_TRADE', 'A counter-offer goes to the active player only');
    }
    to = [s.turn.current];
  }
  if (!hasResources(s.players[ctx.seat]!.resources, give)) {
    return err('INSUFFICIENT_RESOURCES', 'You do not hold what you offer');
  }

  // One counter per seat per original offer: a new counter replaces the previous one.
  if (a.counterTo !== null) {
    for (const old of s.trades.filter((t) => t.from === ctx.seat && t.counterTo === a.counterTo)) {
      ctx.events.push({ type: 'tradeCancelled', offerId: old.id });
    }
    s.trades = s.trades.filter((t) => !(t.from === ctx.seat && t.counterTo === a.counterTo));
  }

  const recipients = to ?? others(s, ctx.seat);
  const offer: TradeOffer = {
    id: s.nextTradeId++,
    from: ctx.seat,
    give,
    want,
    to,
    responses: Object.fromEntries(recipients.map((r) => [String(r), 'pending' as const])),
    counterTo: a.counterTo,
  };
  s.trades.push(offer);
  ctx.events.push({ type: 'tradeOffered', offer: structuredClone(offer) });
};

const respondTrade: Handler<'RESPOND_TRADE'> = (ctx, a) => {
  const s = ctx.state;
  const bad = expectPhase(ctx, 'main');
  if (bad) return bad;
  const offer = findOffer(ctx, a.offerId);
  if (!offer) return err('INVALID_TRADE', 'No such offer');
  if (!Object.hasOwn(offer.responses, String(ctx.seat))) {
    return err('NOT_YOUR_TURN', 'This offer is not addressed to you');
  }
  if (a.response !== 'accept' && a.response !== 'reject') {
    return err('INVALID_ACTION', 'Response must be accept or reject');
  }
  if (a.response === 'accept') {
    if (!hasResources(s.players[ctx.seat]!.resources, offer.want)) {
      return err('INSUFFICIENT_RESOURCES', 'You cannot afford this trade');
    }
  }
  offer.responses[String(ctx.seat)] = a.response;
  ctx.events.push({
    type: 'tradeResponded',
    offerId: offer.id,
    seat: ctx.seat,
    response: a.response,
  });
  // The active player accepting a counter-offer executes it immediately.
  if (a.response === 'accept' && offer.counterTo !== null) return execute(ctx, offer, ctx.seat);
};

const confirmTrade: Handler<'CONFIRM_TRADE'> = (ctx, a) => {
  const bad = expectPhase(ctx, 'main');
  if (bad) return bad;
  const offer = findOffer(ctx, a.offerId);
  if (!offer) return err('INVALID_TRADE', 'No such offer');
  const notYours = expectSeat(ctx, offer.from);
  if (notYours) return notYours;
  // `with` must be a real seat number: "1" would otherwise match the "1" response key.
  if (
    !Number.isInteger(a.with) ||
    offer.counterTo !== null ||
    offer.responses[String(a.with)] !== 'accept'
  ) {
    return err('INVALID_TRADE', 'That player has not accepted this offer');
  }
  return execute(ctx, offer, a.with);
};

const cancelTrade: Handler<'CANCEL_TRADE'> = (ctx, a) => {
  const s = ctx.state;
  const bad = expectPhase(ctx, 'main');
  if (bad) return bad;
  const offer = findOffer(ctx, a.offerId);
  if (!offer) return err('INVALID_TRADE', 'No such offer');
  const notYours = expectSeat(ctx, offer.from);
  if (notYours) return notYours;
  s.trades = s.trades.filter((t) => t.id !== offer.id);
  ctx.events.push({ type: 'tradeCancelled', offerId: offer.id });
};

/** OFFER_TRADE, RESPOND_TRADE, CONFIRM_TRADE, CANCEL_TRADE. */
export const tradeHandlers: HandlerMap = withVictoryCheck({
  OFFER_TRADE: offerTrade,
  RESPOND_TRADE: respondTrade,
  CONFIRM_TRADE: confirmTrade,
  CANCEL_TRADE: cancelTrade,
});
