import { err, type Handler, type HandlerMap } from '../context';
import { RESOURCES, type GameState, type Seat } from '../types';
import { expectPhase, expectSeat, isResource, withVictoryCheck } from './flow';
import { maritimeRatios } from './placement';

/** Is there any maritime trade `seat` could make right now (ignoring phase)? */
export function canTradeMaritime(state: GameState, seat: Seat): boolean {
  const ratios = maritimeRatios(state, seat);
  const hand = state.players[seat]!.resources;
  return RESOURCES.some(
    (give) =>
      hand[give] >= ratios[give] && RESOURCES.some((get) => get !== give && state.bank[get] > 0),
  );
}

/** RULES.md#trading — 4:1, 3:1 with a generic port, 2:1 with a matching port. */
const maritimeTrade: Handler<'MARITIME_TRADE'> = (ctx, a) => {
  const s = ctx.state;
  const bad = expectPhase(ctx, 'main') ?? expectSeat(ctx, s.turn.current);
  if (bad) return bad;
  if (!isResource(a.give) || !isResource(a.get) || a.give === a.get) {
    return err('INVALID_TRADE', 'Give and get must be two different resources');
  }
  const ratio = maritimeRatios(s, ctx.seat)[a.give];
  const hand = s.players[ctx.seat]!.resources;
  if (hand[a.give] < ratio) return err('INSUFFICIENT_RESOURCES', `Need ${ratio} ${a.give}`);
  if (s.bank[a.get] < 1) return err('BANK_EMPTY', `The bank has no ${a.get}`);
  hand[a.give] -= ratio;
  s.bank[a.give] += ratio;
  s.bank[a.get]--;
  hand[a.get]++;
  ctx.events.push({
    type: 'maritimeTrade',
    seat: ctx.seat,
    give: a.give,
    giveCount: ratio,
    get: a.get,
  });
};

/** MARITIME_TRADE with 4:1 / 3:1 / 2:1 port ratios. */
export const maritimeHandlers: HandlerMap = withVictoryCheck({ MARITIME_TRADE: maritimeTrade });
