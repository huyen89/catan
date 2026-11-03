import { err, type Ctx, type Handler, type HandlerMap } from '../context';
import { addResources, emptyResources } from '../resources';
import { TERRAIN_RESOURCE } from '../types';
import { seatsCutAt, updateLongestRoad } from './awards';
import { expectSeat, hexById, startTurn, withVictoryCheck } from './flow';
import { canPlaceSetupRoad, canPlaceSetupSettlement } from './placement';
import { setupGold } from './sea';

/**
 * RULES.md#setup — snake draft: settlement then a road (or, in Open Seas, a ship) touching it.
 * Open Seas: setup settlements go on home islands only; gold next to the second one is chosen
 * (goldChoice) before the road.
 */
const placeSettlement: Handler<'PLACE_SETTLEMENT'> = (ctx, a) => {
  const s = ctx.state;
  const ph = s.phase;
  if (ph.kind !== 'setup' || ph.step !== 'settlement') {
    return err('WRONG_PHASE', 'Not placing a setup settlement now');
  }
  const notYours = expectSeat(ctx, s.setupOrder[ph.index]!);
  if (notYours) return notYours;
  if (!canPlaceSetupSettlement(s, ctx.graph, a.vertex)) {
    return err(
      'ILLEGAL_LOCATION',
      'Settlement must be on a home island and respect the distance rule',
    );
  }
  const p = s.players[ctx.seat]!;
  if (p.settlementsLeft <= 0) return err('NO_PIECES_LEFT', 'No settlements left');

  s.buildings[a.vertex] = { owner: ctx.seat, kind: 'settlement' };
  p.settlementsLeft--;
  ctx.events.push({ type: 'setupPlaced', seat: ctx.seat, kind: 'settlement', at: a.vertex });

  const road = { kind: 'setup', index: ph.index, step: 'road', lastSettlement: a.vertex } as const;
  s.phase = road;
  // Second round: one resource per adjacent producing hex, one gold choice per gold hex.
  if (ph.index >= s.players.length) {
    const got = emptyResources();
    for (const id of ctx.graph.vertexHexes[a.vertex]!) {
      const res = TERRAIN_RESOURCE[hexById(s, id)?.terrain ?? 'desert'];
      if (res && s.bank[res] > got[res]) got[res]++;
    }
    addResources(p.resources, got);
    for (const r of Object.keys(got) as Array<keyof typeof got>) s.bank[r] -= got[r];
    const gold = setupGold(ctx, a.vertex);
    if (gold > 0) {
      ctx.events.push({ type: 'setupResources', seat: ctx.seat, resources: got, gold });
      // Chosen before the road; the road step resumes afterwards.
      s.phase = { kind: 'goldChoice', pending: { [String(ctx.seat)]: gold }, resume: { ...road } };
    } else {
      ctx.events.push({ type: 'setupResources', seat: ctx.seat, resources: got });
    }
  }

  updateLongestRoad(ctx, seatsCutAt(ctx, a.vertex, ctx.seat));
};

const placeRoad: Handler<'PLACE_ROAD'> = (ctx, a) => {
  const s = ctx.state;
  const ph = s.phase;
  if (ph.kind !== 'setup' || ph.step !== 'road') {
    return err('WRONG_PHASE', 'Not placing a setup road now');
  }
  const notYours = expectSeat(ctx, s.setupOrder[ph.index]!);
  if (notYours) return notYours;
  if (!canPlaceSetupRoad(s, ctx.graph, ph.lastSettlement, a.edge)) {
    return err('ILLEGAL_LOCATION', 'Road must be free and touch the settlement just placed');
  }
  const p = s.players[ctx.seat]!;
  if (p.roadsLeft <= 0) return err('NO_PIECES_LEFT', 'No roads left');

  s.roads[a.edge] = ctx.seat;
  p.roadsLeft--;
  ctx.events.push({ type: 'setupPlaced', seat: ctx.seat, kind: 'road', at: a.edge });
  updateLongestRoad(ctx, [ctx.seat]);
  advanceSetup(ctx, ph.index);
};

/** After the setup road (or ship) of step `index`: next placement, or the first turn. */
export function advanceSetup(ctx: Ctx, index: number): void {
  const s = ctx.state;
  const next = index + 1;
  if (next >= s.setupOrder.length) {
    startTurn(ctx, s.setupOrder[0]!);
  } else {
    s.phase = { kind: 'setup', index: next, step: 'settlement', lastSettlement: null };
    s.turn.current = s.setupOrder[next]!;
  }
}

/** PLACE_SETTLEMENT, PLACE_ROAD during the snake-draft setup. */
export const setupHandlers: HandlerMap = withVictoryCheck({
  PLACE_SETTLEMENT: placeSettlement,
  PLACE_ROAD: placeRoad,
});
