import { err, type Ctx, type Handler, type HandlerMap } from '../context';
import {
  addResources,
  hasResources,
  isValidCounts,
  subtractResources,
  totalResources,
} from '../resources';
import { nextInt } from '../rng';
import { RESOURCES, type GameState, type HexId, type Seat } from '../types';
import type { BoardGraph } from '../hex/topology';
import { counts, expectSeat, withVictoryCheck } from './flow';

/** Hexes the robber may move to (any land hex except its current one). */
export function robberTargets(state: GameState): HexId[] {
  return state.board.hexes
    .filter((h) => h.id !== state.robber && h.terrain !== 'sea')
    .map((h) => h.id);
}

/** Opponents of `thief` with a building on `hex` who hold at least one card. */
export function stealCandidates(
  state: GameState,
  graph: BoardGraph,
  thief: Seat,
  hex: HexId,
): Seat[] {
  const out = new Set<Seat>();
  for (const v of graph.hexVertices[hex] ?? []) {
    const b = state.buildings[v];
    if (b && b.owner !== thief && totalResources(state.players[b.owner]!.resources) > 0) {
      out.add(b.owner);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** Move one random card from victim to thief. */
function stealRandom(ctx: Ctx, thief: Seat, victim: Seat): void {
  const s = ctx.state;
  const hand = s.players[victim]!.resources;
  let pick = nextInt(s.rng, 0, totalResources(hand) - 1);
  for (const res of RESOURCES) {
    if (pick < hand[res]) {
      hand[res]--;
      s.players[thief]!.resources[res]++;
      ctx.events.push({ type: 'stole', thief, victim, resource: res });
      return;
    }
    pick -= hand[res];
  }
}

const discard: Handler<'DISCARD'> = (ctx, a) => {
  const s = ctx.state;
  const ph = s.phase;
  if (ph.kind !== 'discard') return err('WRONG_PHASE', 'No discard pending');
  const owe = ph.pending[String(ctx.seat)] ?? 0;
  if (owe <= 0) return err('NOT_YOUR_TURN', 'You do not need to discard');
  if (!isValidCounts(a.resources) || totalResources(a.resources) !== owe) {
    return err('INVALID_ACTION', `You must discard exactly ${owe} cards`);
  }
  const p = s.players[ctx.seat]!;
  if (!hasResources(p.resources, a.resources)) {
    return err('INSUFFICIENT_RESOURCES', 'You do not hold those cards');
  }
  const cards = counts(a.resources);
  subtractResources(p.resources, cards);
  addResources(s.bank, cards);
  delete ph.pending[String(ctx.seat)];
  ctx.events.push({ type: 'discarded', seat: ctx.seat, resources: cards });
  if (Object.keys(ph.pending).length === 0) s.phase = { kind: 'moveRobber', returnTo: 'main' };
};

const moveRobber: Handler<'MOVE_ROBBER'> = (ctx, a) => {
  const s = ctx.state;
  const ph = s.phase;
  if (ph.kind !== 'moveRobber') return err('WRONG_PHASE', 'Not moving the robber now');
  const notYours = expectSeat(ctx, s.turn.current);
  if (notYours) return notYours;
  if (!robberTargets(s).includes(a.hex)) {
    return err('ILLEGAL_LOCATION', 'The robber must move to a different land hex');
  }
  s.robber = a.hex;
  ctx.events.push({ type: 'robberMoved', seat: ctx.seat, hex: a.hex });
  const candidates = stealCandidates(s, ctx.graph, ctx.seat, a.hex);
  if (candidates.length > 1) {
    s.phase = { kind: 'steal', candidates, returnTo: ph.returnTo };
    return;
  }
  if (candidates.length === 1) stealRandom(ctx, ctx.seat, candidates[0]!);
  s.phase = { kind: ph.returnTo };
};

const steal: Handler<'STEAL'> = (ctx, a) => {
  const s = ctx.state;
  const ph = s.phase;
  if (ph.kind !== 'steal') return err('WRONG_PHASE', 'Not stealing now');
  const notYours = expectSeat(ctx, s.turn.current);
  if (notYours) return notYours;
  if (!ph.candidates.includes(a.victim)) {
    return err('INVALID_ACTION', 'You cannot steal from that player');
  }
  stealRandom(ctx, ctx.seat, a.victim);
  s.phase = { kind: ph.returnTo };
};

/** DISCARD, MOVE_ROBBER, STEAL. */
export const robberHandlers: HandlerMap = withVictoryCheck({
  DISCARD: discard,
  MOVE_ROBBER: moveRobber,
  STEAL: steal,
});
