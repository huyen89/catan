/**
 * Open Seas (seafarers) planning: where roads and ships lead, island bonuses, gold choices and
 * the pirate. Everything works from a PlayerView only; on boards without sea it degrades to the
 * plain road planner (no sea edges, every spot on the home island).
 */
import {
  COSTS,
  RESOURCES,
  emptyResources,
  type Building,
  type EdgeId,
  type HexId,
  type PlayerView,
  type Resource,
  type ResourceCounts,
  type Seat,
  type VertexId,
} from '@hexhaven/engine';
import { BASE_WEIGHT, boardInfo, isOpenSpot, missing, pips, scoreVertex } from './eval';

export type PieceKind = 'road' | 'ship';

/** How far (in pieces beyond the candidate) a road or a shipping line is planned. */
export const PLAN_DEPTH: Record<PieceKind, number> = { road: 3, ship: 6 };

/**
 * Discount per extra piece on the way to a spot. Shipping lines are long by nature (islands lie
 * several edges off the coast), so a ship's distance is discounted less than a road's.
 */
export const STEP_DISCOUNT: Record<PieceKind, number> = { road: 1, ship: 0.6 };

/** Score points per island-bonus VP: a new island's bonus is worth more than the settlement. */
export const BONUS_WEIGHT = 5;

/** Island index of a land vertex, else null (all land hexes at a vertex share an island). */
export function islandOfVertex(view: PlayerView, v: VertexId): number | null {
  const { graph } = boardInfo(view);
  for (const h of graph.vertexHexes[v] ?? []) {
    const island = graph.islandOf[h];
    if (island !== undefined) return island;
  }
  return null;
}

/** Value of the island bonus `seat` would earn by settling `v` (0 on home islands). */
export function islandBonusValue(view: PlayerView, seat: Seat, v: VertexId): number {
  const vp = view.board.islandBonusVP;
  if (!(vp > 0)) return 0;
  const island = islandOfVertex(view, v);
  if (island === null || view.board.homeIslands.includes(island)) return 0;
  if (view.islandBonus[String(island)]?.includes(seat)) return 0;
  return vp * BONUS_WEIGHT;
}

const pieceAt = (map: Record<EdgeId, Seat> | undefined, e: EdgeId): Seat | undefined =>
  map && Object.hasOwn(map, e) ? map[e] : undefined;

/**
 * The open end of `seat`'s ship on `e`: the vertex with neither the seat's building nor another
 * of its ships, or null if both ends are anchored.
 */
export function openShipEnd(
  view: PlayerView,
  ships: Record<EdgeId, Seat>,
  seat: Seat,
  e: EdgeId,
): VertexId | null {
  const { graph } = boardInfo(view);
  for (const v of graph.edgeVertices[e] ?? []) {
    if (view.buildings[v]?.owner === seat) continue;
    const continued = (graph.vertexEdges[v] ?? []).some(
      (x) => x !== e && pieceAt(ships, x) === seat,
    );
    if (!continued) return v;
  }
  return null;
}

export interface EdgePlan {
  kind: PieceKind;
  edge: EdgeId;
  score: number;
}

/**
 * Plans roads and ships for one seat on one view. `ships` overrides the view's ships (to judge a
 * ship move with the moved ship lifted). Spot values are memoised per planner.
 */
export class SeaPlanner {
  private readonly spots = new Map<VertexId, number>();
  private readonly roadSet: Set<EdgeId>;
  private readonly seaSet: Set<EdgeId>;

  constructor(
    private readonly view: PlayerView,
    private readonly seat: Seat,
    private readonly have: ResourceCounts,
    private readonly ships: Record<EdgeId, Seat> = view.ships ?? {},
  ) {
    const { graph } = boardInfo(view);
    this.roadSet = new Set(graph.roadEdges);
    this.seaSet = new Set(graph.seaEdges);
  }

  /** A planner that sees `from` lifted off the board (for MOVE_SHIP). */
  without(from: EdgeId): SeaPlanner {
    const ships = { ...this.ships };
    delete ships[from];
    return new SeaPlanner(this.view, this.seat, this.have, ships);
  }

  /** Settlement value of `v` for us: production, ports and any island bonus. */
  spotValue(v: VertexId): number {
    let s = this.spots.get(v);
    if (s === undefined) {
      s =
        scoreVertex(this.view, this.seat, v, this.have) + islandBonusValue(this.view, this.seat, v);
      this.spots.set(v, s);
    }
    return s;
  }

  private isLand(v: VertexId): boolean {
    return islandOfVertex(this.view, v) !== null;
  }

  /** May our planned `kind` line pass over `e` (free, or already ours)? */
  private passable(e: EdgeId, kind: PieceKind): boolean {
    const road = pieceAt(this.view.roads, e);
    const ship = pieceAt(this.ships, e);
    if (kind === 'road') {
      if (!this.roadSet.has(e) || ship !== undefined) return false;
      return road === undefined || road === this.seat;
    }
    if (!this.seaSet.has(e) || road !== undefined) return false;
    return ship === undefined || ship === this.seat;
  }

  /** Best open settlement spot reachable from `start` along `kind` edges, discounted by distance. */
  reach(start: VertexId, kind: PieceKind): number {
    const { graph } = boardInfo(this.view);
    let best = 0;
    const seen = new Set([start]);
    let frontier = [start];
    for (let d = 0; d <= PLAN_DEPTH[kind] && frontier.length; d++) {
      const next: VertexId[] = [];
      for (const v of frontier) {
        if (this.isLand(v) && isOpenSpot(this.view, v))
          best = Math.max(best, this.spotValue(v) / (1 + d * STEP_DISCOUNT[kind]));
        const b = this.view.buildings[v];
        if (b && b.owner !== this.seat) continue; // an opponent's building blocks the line
        for (const e of graph.vertexEdges[v] ?? []) {
          if (!this.passable(e, kind)) continue;
          const [a, c] = graph.edgeVertices[e]!;
          const n = a === v ? c : a;
          if (!seen.has(n)) {
            seen.add(n);
            next.push(n);
          }
        }
      }
      frontier = next;
    }
    return best;
  }

  /** Vertices our `kind` pieces can attach to: our buildings and the ends of our `kind` pieces. */
  private anchors(kind: PieceKind): Set<VertexId> {
    const { graph } = boardInfo(this.view);
    const out = new Set<VertexId>();
    const map = kind === 'road' ? this.view.roads : this.ships;
    for (const [e, s] of Object.entries(map ?? {}))
      if (s === this.seat) for (const v of graph.edgeVertices[e] ?? []) out.add(v);
    for (const [v, b] of Object.entries(this.view.buildings)) if (b.owner === this.seat) out.add(v);
    return out;
  }

  /** Value of building a `kind` piece on `e`: the best spot reachable from its far end. */
  edgeValue(e: EdgeId, kind: PieceKind): number {
    const { graph } = boardInfo(this.view);
    const [a, b] = graph.edgeVertices[e]!;
    const mine = this.anchors(kind);
    const far = mine.has(a) && !mine.has(b) ? b : mine.has(b) && !mine.has(a) ? a : b;
    return this.reach(far, kind);
  }

  /** The best of `roads` and `ships` (either may be empty), with `noise` added to each score. */
  best(roads: readonly EdgeId[], ships: readonly EdgeId[], noise: () => number): EdgePlan | null {
    let out: EdgePlan | null = null;
    const consider = (edges: readonly EdgeId[], kind: PieceKind) => {
      for (const edge of edges) {
        const score = this.edgeValue(edge, kind) + noise();
        if (!out || score > out.score) out = { kind, edge, score };
      }
    };
    consider(roads, 'road');
    consider(ships, 'ship');
    return out;
  }

  /** The open end of our ship on `e` (see `openShipEnd`). */
  openEnd(e: EdgeId): VertexId | null {
    return openShipEnd(this.view, this.ships, this.seat, e);
  }
}

/**
 * Pick `count` resources from gold: first what the current target still needs, then what the
 * next builds need, then what we produce least of. Never more of a kind than the bank holds.
 */
export function chooseGold(
  hand: ResourceCounts,
  production: ResourceCounts,
  bank: ResourceCounts,
  targetCost: ResourceCounts,
  count: number,
): ResourceCounts {
  const out = emptyResources();
  const left = { ...bank };
  const after = { ...hand };
  for (let i = 0; i < count; i++) {
    const need = missing(after, targetCost);
    const later = missing(after, {
      brick: COSTS.settlement.brick,
      lumber: COSTS.settlement.lumber,
      wool: COSTS.settlement.wool,
      grain: COSTS.settlement.grain + COSTS.city.grain,
      ore: COSTS.city.ore,
    });
    let pick: Resource | null = null;
    let bestScore = -Infinity;
    for (const r of RESOURCES) {
      if (left[r] <= 0) continue;
      const score = need[r] * 10 + later[r] * 2 + BASE_WEIGHT[r] / (1 + production[r] * 0.2);
      if (score > bestScore) {
        bestScore = score;
        pick = r;
      }
    }
    if (pick === null) break; // the engine caps gold by the bank, so this never happens
    out[pick]++;
    after[pick]++;
    left[pick]--;
  }
  return out;
}

const BUILDING_WEIGHT: Record<Building['kind'], number> = { settlement: 1, city: 2 };

/** Opponent weight for robber/pirate damage: more VP and the outright leader count more. */
export function threat(view: PlayerView, seat: Seat): number {
  const p = view.players[seat]!;
  const top = Math.max(...view.players.map((o) => o.publicVP));
  return 1 + p.publicVP / 4 + (p.publicVP === top ? 0.5 : 0);
}

/** Damage of the robber on `h`: blocked pips of opponents (by threat) minus our own, times 3. */
export function robberDamage(view: PlayerView, me: Seat, h: HexId): number {
  const { graph, hexById } = boardInfo(view);
  let score = 0;
  for (const v of graph.hexVertices[h] ?? []) {
    const b = view.buildings[v];
    if (!b) continue;
    const weight = BUILDING_WEIGHT[b.kind] * pips(hexById.get(h)?.token ?? null);
    if (b.owner === me) score -= weight * 3;
    else
      score += weight * threat(view, b.owner) + (view.players[b.owner]!.resourceCount > 0 ? 1 : 0);
  }
  return score;
}

/**
 * Damage of the pirate on `h`: it blocks building and moving ships on the hex's edges (an
 * opponent's open-ended ship there is a line being built: blocking it hurts most) and lets us
 * steal from a ship owner there. Our own ships there count against it.
 */
export function pirateDamage(view: PlayerView, me: Seat, h: HexId): number {
  const { graph } = boardInfo(view);
  const owners = new Set<Seat>();
  let score = 0;
  for (const e of graph.hexEdges[h] ?? []) {
    const owner = pieceAt(view.ships, e);
    if (owner === undefined) continue;
    const open = openShipEnd(view, view.ships, owner, e) !== null;
    if (owner === me) score -= open ? 4 : 2;
    else {
      score += (open ? 5 : 1.5) * threat(view, owner);
      owners.add(owner);
    }
  }
  for (const o of owners) if (view.players[o]!.resourceCount > 0) score += 1.5;
  return score;
}

/** Our ships on the edges of `h` (what the pirate there blocks for us). */
export function ownShipsOn(view: PlayerView, me: Seat, h: HexId | null): number {
  if (h === null) return 0;
  const { graph } = boardInfo(view);
  return (graph.hexEdges[h] ?? []).filter((e) => pieceAt(view.ships, e) === me).length;
}
