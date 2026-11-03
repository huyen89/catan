/** Longest road / trade route (longest trail, broken by opponent buildings) and largest army. */
import type { Ctx } from '../context';
import type { BoardGraph } from '../hex/topology';
import type { EdgeId, Seat, VertexId } from '../types';
import type { Pieces } from './placement';

export const LONGEST_ROAD_MIN = 5;
export const LARGEST_ARMY_MIN = 3;

type Kind = 'road' | 'ship';

/**
 * Length of the seat's longest trail: a walk along its own roads and ships that never reuses an
 * edge and does not continue through a vertex holding an opponent's building. With ships (the
 * Open Seas trade route) the walk may switch between a road and a ship only at a vertex holding
 * the seat's own building.
 */
export function longestTrail(pieces: Pieces, graph: BoardGraph, seat: Seat): number {
  const ships = pieces.ships ?? {};
  const kindOf = (e: EdgeId): Kind | null => {
    if (Object.hasOwn(pieces.roads, e) && pieces.roads[e] === seat) return 'road';
    if (Object.hasOwn(ships, e) && ships[e] === seat) return 'ship';
    return null;
  };
  const own: EdgeId[] = [
    ...Object.keys(pieces.roads).filter((e) => pieces.roads[e] === seat),
    ...Object.keys(ships).filter((e) => ships[e] === seat),
  ];
  if (own.length === 0) return 0;
  const ownerAt = (v: VertexId): Seat | undefined =>
    Object.hasOwn(pieces.buildings, v) ? pieces.buildings[v]!.owner : undefined;
  const used = new Set<EdgeId>();
  /** Longest continuation from `v`, having arrived over a piece of kind `came` (null at start). */
  const walk = (v: VertexId, came: Kind | null): number => {
    const mine = ownerAt(v) === seat;
    let best = 0;
    for (const e of graph.vertexEdges[v] ?? []) {
      if (used.has(e)) continue;
      const kind = kindOf(e);
      if (kind === null || (came !== null && kind !== came && !mine)) continue;
      const [a, b] = graph.edgeVertices[e]!;
      const w = a === v ? b : a;
      const o = ownerAt(w);
      used.add(e);
      const len = 1 + (o !== undefined && o !== seat ? 0 : walk(w, kind));
      used.delete(e);
      if (len > best) best = len;
    }
    return best;
  };
  let best = 0;
  const starts = new Set<VertexId>();
  for (const e of own) for (const v of graph.edgeVertices[e] ?? []) starts.add(v);
  for (const v of starts) best = Math.max(best, walk(v, null));
  return best;
}

/**
 * Opponents of `seat` with a road or ship touching `v`: the only trails a new building at `v` can
 * cut.
 */
export function seatsCutAt(ctx: Ctx, v: VertexId, seat: Seat): Seat[] {
  const out = new Set<Seat>();
  const { roads, ships } = ctx.state;
  for (const e of ctx.graph.vertexEdges[v] ?? []) {
    for (const map of [roads, ships]) {
      const owner = Object.hasOwn(map, e) ? map[e] : undefined;
      if (owner !== undefined && owner !== seat) out.add(owner);
    }
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
