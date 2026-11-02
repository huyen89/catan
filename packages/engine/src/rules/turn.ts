import { err, type Ctx, type Handler, type HandlerMap } from '../context';
import type { BoardGraph } from '../hex/topology';
import { COSTS, hasResources } from '../resources';
import type { GameState, Seat } from '../types';
import { expectPhase, expectSeat, startTurn, withVictoryCheck } from './flow';
import { buildableRoadEdges, buildableSettlementVertices, ownSettlements } from './placement';

/** Could `seat` build or buy anything right now (resources, pieces, a legal spot)? */
export function canBuildAnything(state: GameState, graph: BoardGraph, seat: Seat): boolean {
  const p = state.players[seat]!;
  const afford = (item: keyof typeof COSTS) => hasResources(p.resources, COSTS[item]);
  return (
    (afford('devCard') && state.devDeck.length > 0) ||
    (afford('city') && p.citiesLeft > 0 && ownSettlements(state, seat).length > 0) ||
    (afford('road') && p.roadsLeft > 0 && buildableRoadEdges(state, graph, seat).length > 0) ||
    (afford('settlement') &&
      p.settlementsLeft > 0 &&
      buildableSettlementVertices(state, graph, seat).length > 0)
  );
}

const nextSeat = (state: GameState, seat: Seat): Seat => (seat + 1) % state.players.length;

/** Hand the Special Building Phase to the first seat in `queue` that can build, else start the next turn. */
function advanceSpecialBuild(ctx: Ctx, queue: Seat[]): void {
  const s = ctx.state;
  const rest = [...queue];
  while (rest.length > 0) {
    const seat = rest.shift()!;
    if (!canBuildAnything(s, ctx.graph, seat)) continue;
    s.phase = { kind: 'specialBuild', seat, queue: rest };
    ctx.events.push({ type: 'specialBuildTurn', seat });
    return;
  }
  startTurn(ctx, nextSeat(s, s.turn.current));
}

/** RULES.md#turn / #five-or-six-players — END_TURN closes offers and passes play on. */
const endTurn: Handler<'END_TURN'> = (ctx) => {
  const s = ctx.state;
  const bad = expectPhase(ctx, 'main') ?? expectSeat(ctx, s.turn.current);
  if (bad) return bad;
  for (const t of s.trades) ctx.events.push({ type: 'tradeCancelled', offerId: t.id });
  s.trades = [];
  // Dev cards bought this turn ripen at the start of the owner's next turn (startTurn).
  s.turn.devPlayed = false;
  s.turn.dice = null;
  if (!ctx.variant.specialBuildPhase) {
    startTurn(ctx, nextSeat(s, ctx.seat));
    return;
  }
  const order: Seat[] = [];
  for (let seat = nextSeat(s, ctx.seat); seat !== ctx.seat; seat = nextSeat(s, seat)) {
    order.push(seat);
  }
  advanceSpecialBuild(ctx, order);
};

const passSpecialBuild: Handler<'PASS_SPECIAL_BUILD'> = (ctx) => {
  const ph = ctx.state.phase;
  if (ph.kind !== 'specialBuild') return err('WRONG_PHASE', 'No special building phase');
  const notYours = expectSeat(ctx, ph.seat);
  if (notYours) return notYours;
  advanceSpecialBuild(ctx, ph.queue);
};

/** END_TURN, PASS_SPECIAL_BUILD and the 5-6 player Special Building Phase. */
export const turnHandlers: HandlerMap = withVictoryCheck({
  END_TURN: endTurn,
  PASS_SPECIAL_BUILD: passSpecialBuild,
});
