/** Longest road (longest trail, broken by opponent buildings) and largest army bookkeeping. */
import type { Ctx } from '../context';
import type { BoardGraph } from '../hex/topology';
import type { EdgeId, Seat, VertexId } from '../types';
import type { Pieces } from './placement';

export const LONGEST_ROAD_MIN = 5;
export const LARGEST_ARMY_MIN = 3;

/**
 * Length of the seat's longest trail: a walk along its own roads that never reuses an edge and
 * does not continue through a vertex holding an opponent's building.
 */
export function longestTrail(pieces: Pieces, graph: BoardGraph, seat: Seat): number {
  const own: EdgeId[] = Object.keys(pieces.roads).filter((e) => pieces.roads[e] === seat);
  if (own.length === 0) return 0;
  const blocked = (v: VertexId): boolean => {
    const b = Object.hasOwn(pieces.buildings, v) ? pieces.buildings[v] : undefined;
    return b !== undefined && b.owner !== seat;
  };
  const used = new Set<EdgeId>();
  const walk = (v: VertexId): number => {
    let best = 0;
    for (const e of graph.vertexEdges[v] ?? []) {
      if (used.has(e) || !Object.hasOwn(pieces.roads, e) || pieces.roads[e] !== seat) continue;
      const [a, b] = graph.edgeVertices[e]!;
      const w = a === v ? b : a;
      used.add(e);
      const len = 1 + (blocked(w) ? 0 : walk(w));
      used.delete(e);
      if (len > best) best = len;
    }
    return best;
  };
  let best = 0;
  const starts = new Set<VertexId>();
  for (const e of own) for (const v of graph.edgeVertices[e] ?? []) starts.add(v);
  for (const v of starts) best = Math.max(best, walk(v));
  return best;
}

/** Opponents of `seat` with a road touching `v`: the only trails a new building at `v` can cut. */
export function seatsCutAt(ctx: Ctx, v: VertexId, seat: Seat): Seat[] {
  const out = new Set<Seat>();
  for (const e of ctx.graph.vertexEdges[v] ?? []) {
    const owner = Object.hasOwn(ctx.state.roads, e) ? ctx.state.roads[e] : undefined;
    if (owner !== undefined && owner !== seat) out.add(owner);
  }
  return [...out];
}

/**
 * Recompute the longest trail of the `affected` seats (default: everyone) and reassign the
 * longest-road award:
 * - nobody below LONGEST_ROAD_MIN holds it;
 * - the holder keeps it while tied for the longest, unless the holder's own road was just broken
 *   (its length dropped): then only a single strictly-longest player gets it, else nobody;
 * - otherwise it goes to the unique longest player, or to nobody on a tie.
 */
export function updateLongestRoad(ctx: Ctx, affected?: readonly Seat[]): void {
  const s = ctx.state;
  const before = s.longestRoad === null ? 0 : s.players[s.longestRoad]!.longestRoadLength;
  // Every other player's cached length is still exact: only `affected` seats' trails can change.
  for (const seat of affected ?? s.players.map((p) => p.seat)) {
    s.players[seat]!.longestRoadLength = longestTrail(s, ctx.graph, seat);
  }
  const max = Math.max(...s.players.map((p) => p.longestRoadLength));
  const leaders = s.players.filter((p) => p.longestRoadLength === max).map((p) => p.seat);
  const holderBroken =
    s.longestRoad !== null && s.players[s.longestRoad]!.longestRoadLength < before;
  let holder: Seat | null;
  if (max < LONGEST_ROAD_MIN) holder = null;
  else if (leaders.length === 1) holder = leaders[0]!;
  else if (s.longestRoad !== null && leaders.includes(s.longestRoad) && !holderBroken) {
    holder = s.longestRoad;
  } else holder = null;
  if (holder !== s.longestRoad) {
    s.longestRoad = holder;
    ctx.events.push({ type: 'awardChanged', award: 'longestRoad', holder });
  }
}

/** After `seat` played a knight: take largest army with >= 3 knights, strictly more than the holder. */
export function updateLargestArmy(ctx: Ctx, seat: Seat): void {
  const s = ctx.state;
  if (s.largestArmy === seat) return;
  const knights = s.players[seat]!.playedKnights;
  if (knights < LARGEST_ARMY_MIN) return;
  if (s.largestArmy !== null && knights <= s.players[s.largestArmy]!.playedKnights) return;
  s.largestArmy = seat;
  ctx.events.push({ type: 'awardChanged', award: 'largestArmy', holder: seat });
}
