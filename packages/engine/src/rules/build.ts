import { err, type Handler, type HandlerMap } from '../context';
import { updateLongestRoad } from './awards';
import { builderSeat, expectSeat, pay, withVictoryCheck } from './flow';
import { buildableRoadEdges, canBuildRoadAt, canBuildSettlementAt } from './placement';

const wrongPhase = () => err('WRONG_PHASE', 'You cannot build now');

/** BUILD_ROAD: paid in main/specialBuild, free during road building. RULES.md#building. */
const buildRoad: Handler<'BUILD_ROAD'> = (ctx, a) => {
  const s = ctx.state;
  const ph = s.phase;
  const free = ph.kind === 'roadBuilding';
  const builder = free ? s.turn.current : builderSeat(s);
  if (builder === null) return wrongPhase();
  const notYours = expectSeat(ctx, builder);
  if (notYours) return notYours;
  const p = s.players[ctx.seat]!;
  if (p.roadsLeft <= 0) return err('NO_PIECES_LEFT', 'No roads left');
  if (!canBuildRoadAt(s, ctx.graph, ctx.seat, a.edge)) {
    return err('ILLEGAL_LOCATION', 'Road must be free and connect to your network');
  }
  if (!free) {
    const poor = pay(ctx, ctx.seat, 'road');
    if (poor) return poor;
  }
  s.roads[a.edge] = ctx.seat;
  p.roadsLeft--;
  ctx.events.push({ type: 'built', seat: ctx.seat, kind: 'road', at: a.edge });
  updateLongestRoad(ctx);

  if (ph.kind === 'roadBuilding') {
    const remaining = ph.remaining - 1;
    const more =
      remaining > 0 && p.roadsLeft > 0 && buildableRoadEdges(s, ctx.graph, ctx.seat).length > 0;
    s.phase = more ? { kind: 'roadBuilding', remaining } : { kind: 'main' };
  }
};

const buildSettlement: Handler<'BUILD_SETTLEMENT'> = (ctx, a) => {
  const s = ctx.state;
  const builder = builderSeat(s);
  if (builder === null) return wrongPhase();
  const notYours = expectSeat(ctx, builder);
  if (notYours) return notYours;
  const p = s.players[ctx.seat]!;
  if (p.settlementsLeft <= 0) return err('NO_PIECES_LEFT', 'No settlements left');
  if (!canBuildSettlementAt(s, ctx.graph, ctx.seat, a.vertex)) {
    return err('ILLEGAL_LOCATION', 'Settlement must touch your road and respect the distance rule');
  }
  const poor = pay(ctx, ctx.seat, 'settlement');
  if (poor) return poor;
  s.buildings[a.vertex] = { owner: ctx.seat, kind: 'settlement' };
  p.settlementsLeft--;
  ctx.events.push({ type: 'built', seat: ctx.seat, kind: 'settlement', at: a.vertex });
  // A new settlement can cut an opponent's road.
  updateLongestRoad(ctx);
};

const buildCity: Handler<'BUILD_CITY'> = (ctx, a) => {
  const s = ctx.state;
  const builder = builderSeat(s);
  if (builder === null) return wrongPhase();
  const notYours = expectSeat(ctx, builder);
  if (notYours) return notYours;
  const p = s.players[ctx.seat]!;
  if (p.citiesLeft <= 0) return err('NO_PIECES_LEFT', 'No cities left');
  const b =
    typeof a.vertex === 'string' && Object.hasOwn(s.buildings, a.vertex)
      ? s.buildings[a.vertex]
      : undefined;
  if (!b || b.owner !== ctx.seat || b.kind !== 'settlement') {
    return err('ILLEGAL_LOCATION', 'You can only upgrade your own settlement');
  }
  const poor = pay(ctx, ctx.seat, 'city');
  if (poor) return poor;
  b.kind = 'city';
  p.citiesLeft--;
  p.settlementsLeft++;
  ctx.events.push({ type: 'built', seat: ctx.seat, kind: 'city', at: a.vertex });
};

const buyDev: Handler<'BUY_DEV'> = (ctx) => {
  const s = ctx.state;
  const builder = builderSeat(s);
  if (builder === null) return wrongPhase();
  const notYours = expectSeat(ctx, builder);
  if (notYours) return notYours;
  if (s.devDeck.length === 0) return err('DECK_EMPTY', 'No development cards left');
  const poor = pay(ctx, ctx.seat, 'devCard');
  if (poor) return poor;
  const card = s.devDeck.pop()!;
  s.players[ctx.seat]!.newDevCards.push(card);
  ctx.events.push({ type: 'boughtDev', seat: ctx.seat, card });
};

/** BUILD_ROAD, BUILD_SETTLEMENT, BUILD_CITY, BUY_DEV (main phase, road-building, special build). */
export const buildHandlers: HandlerMap = withVictoryCheck({
  BUILD_ROAD: buildRoad,
  BUILD_SETTLEMENT: buildSettlement,
  BUILD_CITY: buildCity,
  BUY_DEV: buyDev,
});
