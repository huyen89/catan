/**
 * Open Seas helpers shared by several rule modules: gold yields, pirate targets and island
 * bonuses. Kept apart from rules/seafarers.ts (the action handlers) so roll/setup/build can use
 * them without import cycles. See docs/SEAFARERS.md.
 */
import type { Ctx } from '../context';
import type { BoardGraph } from '../hex/topology';
import { totalResources } from '../resources';
import type { GameState, HexId, Seat, VertexId } from '../types';
import { islandOfVertex } from './placement';

/** May a 7 or a knight move the pirate instead of the robber? Only on boards with a pirate. */
export const pirateAllowed = (state: GameState): boolean => state.pirate !== null;

/** Sea hexes the pirate may move to (every sea hex except its current one). */
export function pirateTargets(state: GameState): HexId[] {
  if (state.pirate === null) return [];
  return state.board.hexes
    .filter((h) => h.terrain === 'sea' && h.id !== state.pirate)
    .map((h) => h.id);
}

/** Opponents of `thief` with a ship on an edge of `hex` who hold at least one card. */
export function pirateStealCandidates(
  state: GameState,
  graph: BoardGraph,
  thief: Seat,
  hex: HexId,
): Seat[] {
  const out = new Set<Seat>();
  for (const e of graph.hexEdges[hex] ?? []) {
    const owner = Object.hasOwn(state.ships, e) ? state.ships[e] : undefined;
    if (owner === undefined || owner === thief) continue;
    if (totalResources(state.players[owner]!.resources) > 0) out.add(owner);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Cap gold yields by what the bank holds. Gold is "any resource", so it runs short only when
 * the bank's total is below the total owed. Mirroring the per-resource shortage rule: then
 * nobody gets gold, unless exactly one seat is owed some (it gets what the bank has left).
 * This guarantees every seat in goldChoice can always complete its choice.
 */
function capGold(state: GameState, owed: Record<string, number>): Record<string, number> {
  const bankTotal = totalResources(state.bank);
  const seats = Object.keys(owed).filter((k) => owed[k]! > 0);
  const sum = seats.reduce((n, k) => n + owed[k]!, 0);
  if (sum <= bankTotal) return Object.fromEntries(seats.map((k) => [k, owed[k]!]));
  if (seats.length === 1 && bankTotal > 0) return { [seats[0]!]: bankTotal };
  return {};
}

/**
 * Gold to choose per seat (seat as string key) for a production roll of `total`: 1 per
 * settlement and 2 per city on each gold hex with that token, unless the robber sits on it.
 * Call after regular production (the shortage cap looks at the bank as it is then).
 */
export function goldYield(ctx: Ctx, total: number): Record<string, number> {
  const s = ctx.state;
  const owed: Record<string, number> = {};
  for (const hex of s.board.hexes) {
    if (hex.terrain !== 'gold' || hex.token !== total || hex.id === s.robber) continue;
    for (const v of ctx.graph.hexVertices[hex.id]!) {
      const b = Object.hasOwn(s.buildings, v) ? s.buildings[v] : undefined;
      if (b) owed[String(b.owner)] = (owed[String(b.owner)] ?? 0) + (b.kind === 'city' ? 2 : 1);
    }
  }
  return capGold(s, owed);
}

/** Gold from a second setup settlement: 1 per adjacent gold hex, capped by the bank's total. */
export function setupGold(ctx: Ctx, vertex: VertexId): number {
  let n = 0;
  for (const id of ctx.graph.vertexHexes[vertex] ?? []) {
    if (ctx.state.board.hexes.some((h) => h.id === id && h.terrain === 'gold')) n++;
  }
  return Math.min(n, totalResources(ctx.state.bank));
}

/**
 * After `seat` built a settlement on `vertex`: the first settlement of a seat on a non-home
 * island earns the board's islandBonusVP (once per island per seat).
 */
export function awardIslandBonus(ctx: Ctx, seat: Seat, vertex: VertexId): void {
  const s = ctx.state;
  const vp = s.board.islandBonusVP;
  if (vp <= 0) return;
  const island = islandOfVertex(ctx.graph, vertex);
  if (island === null || s.board.homeIslands.includes(island)) return;
  const key = String(island);
  const got = Object.hasOwn(s.islandBonus, key) ? s.islandBonus[key]! : [];
  if (got.includes(seat)) return;
  s.islandBonus[key] = [...got, seat];
  s.players[seat]!.bonusVP += vp;
  ctx.events.push({ type: 'islandBonus', seat, island, vp });
}
