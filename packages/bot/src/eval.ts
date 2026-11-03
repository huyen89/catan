import {
  COSTS,
  RESOURCES,
  TERRAIN_RESOURCE,
  emptyResources,
  graphFor,
  hasResources,
  type BoardGraph,
  type PlayerView,
  type ResourceCounts,
  type Seat,
  type VertexId,
} from '@hexhaven/engine';

/** Probability weight of a number token (number of dice combinations). */
export const pips = (token: number | null): number =>
  token === null ? 0 : 6 - Math.abs(7 - token);

/** Static value of each resource early in the game (brick/lumber matter most for expansion). */
export const BASE_WEIGHT: ResourceCounts = {
  brick: 1.1,
  lumber: 1.1,
  wool: 0.8,
  grain: 1.0,
  ore: 0.95,
};

export interface BoardInfo {
  graph: BoardGraph;
  hexById: Map<string, PlayerView['board']['hexes'][number]>;
  portAt: Map<VertexId, PlayerView['board']['ports'][number]['type']>;
}

// Views are deep copies, so cache by board content rather than object identity.
const infoCache = new Map<string, BoardInfo>();
const boardKey = (b: PlayerView['board']): string =>
  b.layoutId +
  '|' +
  b.hexes.map((h) => `${h.id}:${h.terrain}:${h.token}`).join(';') +
  '|' +
  b.ports.map((p) => `${p.edge}:${p.type}`).join(';');

// Within one decision the same board object is looked up many times: skip re-keying it.
const byObject = new WeakMap<PlayerView['board'], BoardInfo>();

export function boardInfo(view: PlayerView): BoardInfo {
  const same = byObject.get(view.board);
  if (same) return same;
  const key = boardKey(view.board);
  const hit = infoCache.get(key);
  if (hit) {
    byObject.set(view.board, hit);
    return hit;
  }
  if (infoCache.size > 64) infoCache.clear();
  const info: BoardInfo = {
    graph: graphFor(view.board),
    hexById: new Map(view.board.hexes.map((h) => [h.id, h])),
    portAt: new Map(),
  };
  for (const p of view.board.ports) for (const v of p.vertices) info.portAt.set(v, p.type);
  infoCache.set(key, info);
  byObject.set(view.board, info);
  return info;
}

/** Expected production of a vertex per resource (pips), ignoring the robber. */
export function vertexProduction(view: PlayerView, v: VertexId): ResourceCounts {
  const { graph, hexById } = boardInfo(view);
  const out = emptyResources();
  for (const h of graph.vertexHexes[v] ?? []) {
    const hex = hexById.get(h);
    const res = hex ? TERRAIN_RESOURCE[hex.terrain] : undefined;
    if (hex && res) out[res] += pips(hex.token);
  }
  return out;
}

/** Pips of the gold hexes (Open Seas) around a vertex. */
export function goldPips(view: PlayerView, v: VertexId): number {
  const { graph, hexById } = boardInfo(view);
  let n = 0;
  for (const h of graph.vertexHexes[v] ?? []) {
    const hex = hexById.get(h);
    if (hex?.terrain === 'gold') n += pips(hex.token);
  }
  return n;
}

/** Current production of a seat (pips per resource), counting cities double. */
export function seatProduction(view: PlayerView, seat: Seat): ResourceCounts {
  const out = emptyResources();
  for (const [v, b] of Object.entries(view.buildings)) {
    if (b.owner !== seat) continue;
    const p = vertexProduction(view, v);
    const mult = b.kind === 'city' ? 2 : 1;
    for (const r of RESOURCES) out[r] += p[r] * mult;
  }
  return out;
}

/** How valuable a settlement spot is for `seat`: production weighted by scarcity + diversity + port. */
export function scoreVertex(
  view: PlayerView,
  seat: Seat,
  v: VertexId,
  have: ResourceCounts = seatProduction(view, seat),
): number {
  const prod = vertexProduction(view, v);
  let score = 0;
  let kinds = 0;
  for (const r of RESOURCES) {
    if (prod[r] === 0) continue;
    kinds++;
    // Resources we don't produce yet are worth more.
    const scarcity = have[r] === 0 ? 1.35 : have[r] < 5 ? 1.1 : 0.9;
    score += prod[r] * BASE_WEIGHT[r] * scarcity;
  }
  // Gold (Open Seas) yields any resource: worth a bit more than the best fixed one.
  const gold = goldPips(view, v);
  if (gold > 0) {
    kinds++;
    score += gold * 1.2;
  }
  score += kinds * 0.6;
  const port = boardInfo(view).portAt.get(v);
  if (port === 'any') score += 1;
  else if (port && have[port] >= 4) score += 1.5 + have[port] * 0.1;
  else if (port) score += 0.4;
  return score;
}

/** True if a settlement could ever go on `v` (empty and no adjacent building). */
export function isOpenSpot(view: PlayerView, v: VertexId): boolean {
  const { graph } = boardInfo(view);
  if (view.buildings[v]) return false;
  return !(graph.vertexNeighbors[v] ?? []).some((n) => view.buildings[n]);
}

export type BuildTarget = 'city' | 'settlement' | 'devCard' | 'road' | 'ship';

export function canAfford(hand: ResourceCounts, what: BuildTarget): boolean {
  return hasResources(hand, COSTS[what]);
}

/** Cards missing from `hand` to pay `cost`. */
export function missing(hand: ResourceCounts, cost: ResourceCounts): ResourceCounts {
  const out = { ...cost };
  for (const r of RESOURCES) out[r] = Math.max(0, cost[r] - hand[r]);
  return out;
}

export function myHand(view: PlayerView): ResourceCounts {
  const me = view.players[view.viewer ?? -1];
  return me?.resources ? { ...me.resources } : emptyResources();
}

export function argmax<T>(items: readonly T[], score: (t: T) => number): T | undefined {
  let best: T | undefined;
  let bestScore = -Infinity;
  for (const it of items) {
    const s = score(it);
    if (s > bestScore) {
      bestScore = s;
      best = it;
    }
  }
  return best;
}
