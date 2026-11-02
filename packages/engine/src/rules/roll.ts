import type { Ctx, Handler, HandlerMap } from '../context';
import { emptyResources, totalResources } from '../resources';
import { nextInt } from '../rng';
import { RESOURCES, TERRAIN_RESOURCE, type ResourceCounts } from '../types';
import { expectPhase, expectSeat, withVictoryCheck } from './flow';

/**
 * RULES.md#turn — production for `total`. Robber blocks its hex. Bank shortage: if the bank can't
 * pay everyone owed a resource, nobody gets it, unless exactly one player is owed it.
 */
export function produce(ctx: Ctx, total: number): Record<string, ResourceCounts> {
  const s = ctx.state;
  const owed = s.players.map(() => emptyResources());
  for (const hex of s.board.hexes) {
    if (hex.token !== total || hex.id === s.robber) continue;
    const res = TERRAIN_RESOURCE[hex.terrain];
    if (!res) continue;
    for (const v of ctx.graph.hexVertices[hex.id]!) {
      const b = s.buildings[v];
      if (b) owed[b.owner]![res] += b.kind === 'city' ? 2 : 1;
    }
  }
  const gains: Record<string, ResourceCounts> = {};
  for (const res of RESOURCES) {
    const sum = owed.reduce((n, o) => n + o[res], 0);
    if (sum === 0) continue;
    const owedSeats = owed.flatMap((o, seat) => (o[res] > 0 ? [seat] : []));
    if (sum > s.bank[res] && owedSeats.length > 1) continue;
    for (const seat of owedSeats) {
      const n = Math.min(owed[seat]![res], s.bank[res]);
      if (n === 0) continue;
      s.bank[res] -= n;
      s.players[seat]!.resources[res] += n;
      (gains[String(seat)] ??= emptyResources())[res] += n;
    }
  }
  return gains;
}

const roll: Handler<'ROLL'> = (ctx) => {
  const s = ctx.state;
  const bad = expectPhase(ctx, 'preRoll') ?? expectSeat(ctx, s.turn.current);
  if (bad) return bad;
  const dice: [number, number] = [nextInt(s.rng, 1, 6), nextInt(s.rng, 1, 6)];
  const total = dice[0] + dice[1];
  s.turn.dice = dice;
  ctx.events.push({ type: 'rolled', seat: ctx.seat, dice, total });

  if (total !== 7) {
    ctx.events.push({ type: 'produced', gains: produce(ctx, total) });
    s.phase = { kind: 'main' };
    return;
  }
  const pending: Record<string, number> = {};
  for (const p of s.players) {
    const n = totalResources(p.resources);
    if (n > s.config.discardLimit) pending[String(p.seat)] = Math.floor(n / 2);
  }
  if (Object.keys(pending).length > 0) {
    s.phase = { kind: 'discard', pending };
    ctx.events.push({ type: 'discardRequired', pending: { ...pending } });
  } else {
    s.phase = { kind: 'moveRobber', returnTo: 'main' };
  }
};

/** ROLL: dice, production (with bank shortage rule), or 7 → discard/robber. */
export const rollHandlers: HandlerMap = withVictoryCheck({ ROLL: roll });
