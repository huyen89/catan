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

/**
 * Recompute every player's longest trail and reassign the longest-road award:
 * - nobody below LONGEST_ROAD_MIN holds it;
 * - the holder keeps it while tied for the longest;
 * - otherwise it goes to the unique longest player, or to nobody on a tie.
 */
export function updateLongestRoad(ctx: Ctx): void {
  const s = ctx.state;
  for (const p of s.players) p.longestRoadLength = longestTrail(s, ctx.graph, p.seat);
  const max = Math.max(...s.players.map((p) => p.longestRoadLength));
  const leaders = s.players.filter((p) => p.longestRoadLength === max).map((p) => p.seat);
  let holder: Seat | null;
  if (max < LONGEST_ROAD_MIN) holder = null;
  else if (s.longestRoad !== null && leaders.includes(s.longestRoad)) holder = s.longestRoad;
  else holder = leaders.length === 1 ? leaders[0]! : null;
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
