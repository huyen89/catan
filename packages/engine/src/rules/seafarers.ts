/**
 * Open Seas ('seafarers') actions: ships, ship moves, the pirate and gold choices.
 * docs/SEAFARERS.md has the rules; shared helpers live in rules/sea.ts.
 */
import { err, type Handler, type HandlerMap } from '../context';
import { hasResources, isValidCounts, subtractResources, totalResources } from '../resources';
import { RESOURCES } from '../types';
import { updateLongestRoad } from './awards';
import { continueRoadBuilding } from './devcards';
import { builderSeat, counts, expectSeat, pay, withVictoryCheck } from './flow';
import { canBuildShipAt, canPlaceSetupShip, isEdge, shipMoveTargets } from './placement';
import { stealRandom } from './robber';
import { pirateStealCandidates, pirateTargets } from './sea';
import { advanceSetup } from './setup';

/** PLACE_SHIP: the setup piece after a settlement may be a ship instead of a road. */
const placeShip: Handler<'PLACE_SHIP'> = (ctx, a) => {
  const s = ctx.state;
  const ph = s.phase;
  if (ph.kind !== 'setup' || ph.step !== 'road') {
    return err('WRONG_PHASE', 'Not placing a setup road or ship now');
  }
  const notYours = expectSeat(ctx, s.setupOrder[ph.index]!);
  if (notYours) return notYours;
  if (!canPlaceSetupShip(s, ctx.graph, ph.lastSettlement, a.edge)) {
    return err(
      'ILLEGAL_LOCATION',
      'Ship must be on a free sea edge, away from the pirate, touching the settlement just placed',
    );
  }
  const p = s.players[ctx.seat]!;
  if (p.shipsLeft <= 0) return err('NO_PIECES_LEFT', 'No ships left');

  s.ships[a.edge] = ctx.seat;
  p.shipsLeft--;
  ctx.events.push({ type: 'setupPlaced', seat: ctx.seat, kind: 'ship', at: a.edge });
  updateLongestRoad(ctx, [ctx.seat]);
  advanceSetup(ctx, ph.index);
};

/** BUILD_SHIP: paid in main/specialBuild, free during road building. */
const buildShip: Handler<'BUILD_SHIP'> = (ctx, a) => {
  const s = ctx.state;
  const ph = s.phase;
  const free = ph.kind === 'roadBuilding';
  const builder = free ? s.turn.current : builderSeat(s);
  if (builder === null) return err('WRONG_PHASE', 'You cannot build now');
  const notYours = expectSeat(ctx, builder);
  if (notYours) return notYours;
  const p = s.players[ctx.seat]!;
  if (p.shipsLeft <= 0) return err('NO_PIECES_LEFT', 'No ships left');
  if (!canBuildShipAt(s, ctx.graph, ctx.seat, a.edge)) {
    return err(
      'ILLEGAL_LOCATION',
      'Ship must be on a free sea edge, away from the pirate, connected to your building or ship',
    );
  }
  if (!free) {
    const poor = pay(ctx, ctx.seat, 'ship');
    if (poor) return poor;
  }
  s.ships[a.edge] = ctx.seat;
  p.shipsLeft--;
  s.turn.newShips.push(a.edge);
  ctx.events.push({ type: 'built', seat: ctx.seat, kind: 'ship', at: a.edge });
  updateLongestRoad(ctx, [ctx.seat]);
  if (ph.kind === 'roadBuilding') continueRoadBuilding(ctx, ph.remaining - 1);
};

/** MOVE_SHIP: once per turn after rolling, an open-ended ship not placed this turn. */
const moveShip: Handler<'MOVE_SHIP'> = (ctx, a) => {
  const s = ctx.state;
  if (s.phase.kind !== 'main') return err('WRONG_PHASE', 'Ships move only in your main phase');
  const notYours = expectSeat(ctx, s.turn.current);
  if (notYours) return notYours;
  if (s.turn.shipMoved) return err('INVALID_ACTION', 'You already moved a ship this turn');
  if (!isEdge(ctx.graph, a.from) || !isEdge(ctx.graph, a.to)) {
    return err('ILLEGAL_LOCATION', 'Unknown edge');
  }
  const moves = shipMoveTargets(s, ctx.graph, ctx.seat, s.turn.newShips);
  if (!Object.hasOwn(moves, a.from)) {
    return err(
      'ILLEGAL_LOCATION',
      'Only your open-ended ship, not placed this turn nor next to the pirate, can move',
    );
  }
  if (!moves[a.from]!.includes(a.to)) {
    return err('ILLEGAL_LOCATION', 'The ship cannot move there');
  }
  delete s.ships[a.from];
  s.ships[a.to] = ctx.seat;
  s.turn.shipMoved = true;
  ctx.events.push({ type: 'shipMoved', seat: ctx.seat, from: a.from, to: a.to });
  updateLongestRoad(ctx, [ctx.seat]);
};

/** MOVE_PIRATE: on a 7 or a knight, move the pirate to another sea hex instead of the robber. */
const movePirate: Handler<'MOVE_PIRATE'> = (ctx, a) => {
  const s = ctx.state;
  const ph = s.phase;
  if (ph.kind !== 'moveRobber' || !ph.allowPirate) {
    return err('WRONG_PHASE', 'Not moving the pirate now');
  }
  const notYours = expectSeat(ctx, s.turn.current);
  if (notYours) return notYours;
  if (typeof a.hex !== 'string' || !pirateTargets(s).includes(a.hex)) {
    return err('ILLEGAL_LOCATION', 'The pirate must move to a different sea hex');
  }
  s.pirate = a.hex;
  ctx.events.push({ type: 'pirateMoved', seat: ctx.seat, hex: a.hex });
  const candidates = pirateStealCandidates(s, ctx.graph, ctx.seat, a.hex);
  if (candidates.length > 1) {
    s.phase = { kind: 'steal', candidates, returnTo: ph.returnTo, via: 'pirate' };
    return;
  }
  if (candidates.length === 1) stealRandom(ctx, ctx.seat, candidates[0]!);
  s.phase = { kind: ph.returnTo };
};

/** CHOOSE_GOLD: every seat owed gold picks exactly that many resources from the bank. */
const chooseGold: Handler<'CHOOSE_GOLD'> = (ctx, a) => {
  const s = ctx.state;
  const ph = s.phase;
  if (ph.kind !== 'goldChoice') return err('WRONG_PHASE', 'No gold to choose');
  const owed = ph.pending[String(ctx.seat)] ?? 0;
  if (owed <= 0) return err('NOT_YOUR_TURN', 'You have no gold to choose');
  if (!isValidCounts(a.resources) || totalResources(a.resources) !== owed) {
    return err('INVALID_ACTION', `Choose exactly ${owed} resources`);
  }
  const picked = counts(a.resources);
  if (!hasResources(s.bank, picked)) {
    return err('BANK_EMPTY', 'The bank cannot pay those resources');
  }
  subtractResources(s.bank, picked);
  const hand = s.players[ctx.seat]!.resources;
  for (const r of RESOURCES) hand[r] += picked[r];
  delete ph.pending[String(ctx.seat)];
  ctx.events.push({ type: 'goldChosen', seat: ctx.seat, resources: picked });
  if (Object.keys(ph.pending).length === 0) s.phase = ph.resume;
};

/** PLACE_SHIP, BUILD_SHIP, MOVE_SHIP, MOVE_PIRATE, CHOOSE_GOLD. */
export const seafarersHandlers: HandlerMap = withVictoryCheck({
  PLACE_SHIP: placeShip,
  BUILD_SHIP: buildShip,
  MOVE_SHIP: moveShip,
  MOVE_PIRATE: movePirate,
  CHOOSE_GOLD: chooseGold,
});
