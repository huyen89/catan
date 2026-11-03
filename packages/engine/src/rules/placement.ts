/**
 * Placement geometry: distance rule, road and ship connectivity, port ratios.
 * Functions take only the piece maps they need so the bot can call them on a PlayerView too.
 *
 * Open Seas: settlements stand only on land vertices, roads only on edges touching land, ships
 * only on edges between two hexes with at least one sea hex (BoardGraph.landVertices / roadEdges
 * / seaEdges). On boards without sea every vertex and edge is land, so the base rules are
 * unchanged. A coast edge takes a road or a ship, never both.
 */
import type { BoardGraph } from '../hex/topology';
import type { Board, Building, EdgeId, HexId, ResourceCounts, Seat, VertexId } from '../types';
import { RESOURCES } from '../types';

/** The piece maps placement rules look at (present on both GameState and PlayerView). */
export interface Pieces {
  buildings: Record<VertexId, Building>;
  roads: Record<EdgeId, Seat>;
  /** Ships by edge (Open Seas). Absent = no ships. */
  ships?: Record<EdgeId, Seat>;
}

/** Pieces plus the pirate, for ship placement (present on both GameState and PlayerView). */
export interface SeaPieces extends Pieces {
  ships: Record<EdgeId, Seat>;
  pirate: HexId | null;
}

export const isVertex = (graph: BoardGraph, v: unknown): v is VertexId =>
  typeof v === 'string' && Object.hasOwn(graph.vertexHexes, v);

export const isEdge = (graph: BoardGraph, e: unknown): e is EdgeId =>
  typeof e === 'string' && Object.hasOwn(graph.edgeVertices, e);

const isLandHex = (graph: BoardGraph, h: HexId): boolean => Object.hasOwn(graph.islandOf, h);

/** Vertex touching at least one land hex (where a building may stand). */
export const isLandVertex = (graph: BoardGraph, v: VertexId): boolean =>
  graph.vertexHexes[v]!.some((h) => isLandHex(graph, h));

/** Edge touching at least one land hex (where a road may go). */
export const isRoadEdge = (graph: BoardGraph, e: EdgeId): boolean =>
  graph.edgeHexes[e]!.some((h) => isLandHex(graph, h));

/** Edge between two hexes, at least one of them sea (where a ship may go). */
export function isShipEdge(graph: BoardGraph, e: EdgeId): boolean {
  const hs = graph.edgeHexes[e]!;
  return hs.length === 2 && hs.some((h) => !isLandHex(graph, h));
}

/** Island index of a land vertex (all land hexes at a vertex share an island), else null. */
export function islandOfVertex(graph: BoardGraph, v: VertexId): number | null {
  for (const h of graph.vertexHexes[v] ?? []) {
    if (isLandHex(graph, h)) return graph.islandOf[h]!;
  }
  return null;
}

const roadAt = (pieces: Pieces, e: EdgeId): Seat | undefined =>
  Object.hasOwn(pieces.roads, e) ? pieces.roads[e] : undefined;

const shipAt = (pieces: Pieces, e: EdgeId): Seat | undefined =>
  pieces.ships && Object.hasOwn(pieces.ships, e) ? pieces.ships[e] : undefined;

/** No road and no ship on the edge. */
const edgeFree = (pieces: Pieces, e: EdgeId): boolean =>
  roadAt(pieces, e) === undefined && shipAt(pieces, e) === undefined;

const buildingAt = (pieces: Pieces, v: VertexId): Building | undefined =>
  Object.hasOwn(pieces.buildings, v) ? pieces.buildings[v] : undefined;

/** Distance rule: the vertex and all its neighbours are free. */
export function distanceRuleOk(pieces: Pieces, graph: BoardGraph, v: VertexId): boolean {
  if (buildingAt(pieces, v)) return false;
  return graph.vertexNeighbors[v]!.every((n) => !buildingAt(pieces, n));
}

/** Setup settlement: a land vertex on a home island respecting the distance rule. */
export function canPlaceSetupSettlement(
  pieces: Pieces & { board: Pick<Board, 'homeIslands'> },
  graph: BoardGraph,
  v: unknown,
): boolean {
  if (!isVertex(graph, v) || !distanceRuleOk(pieces, graph, v)) return false;
  const island = islandOfVertex(graph, v);
  return island !== null && pieces.board.homeIslands.includes(island);
}

/** Regular settlement: land vertex, distance rule, touches one of the seat's roads or ships. */
export function canBuildSettlementAt(
  pieces: Pieces,
  graph: BoardGraph,
  seat: Seat,
  v: unknown,
): boolean {
  return (
    isVertex(graph, v) &&
    isLandVertex(graph, v) &&
    distanceRuleOk(pieces, graph, v) &&
    graph.vertexEdges[v]!.some((e) => roadAt(pieces, e) === seat || shipAt(pieces, e) === seat)
  );
}

/**
 * Regular road: free road edge that touches the seat's own building, or the seat's own road at a
 * vertex not occupied by an opponent's building. Ships do not extend roads: only the seat's own
 * building joins a road to a ship.
 */
export function canBuildRoadAt(pieces: Pieces, graph: BoardGraph, seat: Seat, e: unknown): boolean {
  if (!isEdge(graph, e) || !isRoadEdge(graph, e) || !edgeFree(pieces, e)) return false;
  return graph.edgeVertices[e]!.some((u) => {
    const b = buildingAt(pieces, u);
    if (b) return b.owner === seat;
    return graph.vertexEdges[u]!.some((x) => x !== e && roadAt(pieces, x) === seat);
  });
}

/** Ship edge that is free and not blocked by the pirate (it blocks ships on its hex's edges). */
function shipEdgeOpen(pieces: SeaPieces, graph: BoardGraph, e: EdgeId): boolean {
  return (
    isShipEdge(graph, e) &&
    edgeFree(pieces, e) &&
    (pieces.pirate === null || !graph.edgeHexes[e]!.includes(pieces.pirate))
  );
}

/**
 * Regular ship: free ship edge, not on an edge of the pirate's hex, touching the seat's own
 * building, or the seat's own ship at a vertex not occupied by an opponent's building. Roads do
 * not extend shipping lines: only the seat's own building joins the two.
 */
export function canBuildShipAt(
  pieces: SeaPieces,
  graph: BoardGraph,
  seat: Seat,
  e: unknown,
): boolean {
  if (!isEdge(graph, e) || !shipEdgeOpen(pieces, graph, e)) return false;
  return graph.edgeVertices[e]!.some((u) => {
    const b = buildingAt(pieces, u);
    if (b) return b.owner === seat;
    return graph.vertexEdges[u]!.some((x) => x !== e && shipAt(pieces, x) === seat);
  });
}

/** Setup road: free road edge touching the settlement just placed. */
export function canPlaceSetupRoad(
  pieces: Pieces,
  graph: BoardGraph,
  lastSettlement: VertexId | null,
  e: unknown,
): boolean {
  return (
    lastSettlement !== null &&
    isEdge(graph, e) &&
    isRoadEdge(graph, e) &&
    edgeFree(pieces, e) &&
    graph.edgeVertices[e]!.includes(lastSettlement)
  );
}

/** Setup ship: free ship edge, not blocked by the pirate, touching the settlement just placed. */
export function canPlaceSetupShip(
  pieces: SeaPieces,
  graph: BoardGraph,
  lastSettlement: VertexId | null,
  e: unknown,
): boolean {
  return (
    lastSettlement !== null &&
    isEdge(graph, e) &&
    shipEdgeOpen(pieces, graph, e) &&
    graph.edgeVertices[e]!.includes(lastSettlement)
  );
}

export const setupSettlementVertices = (
  pieces: Pieces & { board: Pick<Board, 'homeIslands'> },
  graph: BoardGraph,
): VertexId[] => graph.landVertices.filter((v) => canPlaceSetupSettlement(pieces, graph, v));

export const setupRoadEdges = (
  pieces: Pieces,
  graph: BoardGraph,
  lastSettlement: VertexId | null,
): EdgeId[] =>
  lastSettlement === null || !isVertex(graph, lastSettlement)
    ? []
    : graph.vertexEdges[lastSettlement]!.filter((e) =>
        canPlaceSetupRoad(pieces, graph, lastSettlement, e),
      ).sort();

export const setupShipEdges = (
  pieces: SeaPieces,
  graph: BoardGraph,
  lastSettlement: VertexId | null,
): EdgeId[] =>
  lastSettlement === null || !isVertex(graph, lastSettlement)
    ? []
    : graph.vertexEdges[lastSettlement]!.filter((e) =>
        canPlaceSetupShip(pieces, graph, lastSettlement, e),
      ).sort();

/** Edges in `map` held by the seat (ignores ids that are not on this board). */
function ownEdges(map: Record<EdgeId, Seat> | undefined, graph: BoardGraph, seat: Seat): EdgeId[] {
  const out: EdgeId[] = [];
  if (!map) return out;
  for (const e of Object.keys(map)) {
    if (map[e] === seat && Object.hasOwn(graph.edgeVertices, e)) out.push(e);
  }
  return out;
}

const ownRoadEdges = (pieces: Pieces, graph: BoardGraph, seat: Seat): EdgeId[] =>
  ownEdges(pieces.roads, graph, seat);

/** Edges holding the seat's ships (ignores ids that are not on this board). */
export const ownShipEdges = (pieces: Pieces, graph: BoardGraph, seat: Seat): EdgeId[] =>
  ownEdges(pieces.ships, graph, seat);

/**
 * Vertices where the seat could build a settlement (sorted). Only endpoints of its own roads and
 * ships can qualify, so those are the only candidates checked instead of every vertex on the board.
 */
export function buildableSettlementVertices(
  pieces: Pieces,
  graph: BoardGraph,
  seat: Seat,
): VertexId[] {
  const candidates = new Set<VertexId>();
  for (const e of [...ownRoadEdges(pieces, graph, seat), ...ownShipEdges(pieces, graph, seat)]) {
    for (const v of graph.edgeVertices[e]!) candidates.add(v);
  }
  return [...candidates]
    .filter((v) => isLandVertex(graph, v) && distanceRuleOk(pieces, graph, v))
    .sort();
}

/** Vertices with the seat's buildings plus endpoints of `edges`: where new pieces can attach. */
function anchorEdges(pieces: Pieces, graph: BoardGraph, seat: Seat, edges: EdgeId[]): Set<EdgeId> {
  const anchors = new Set<VertexId>();
  for (const v of Object.keys(pieces.buildings)) {
    if (pieces.buildings[v]!.owner === seat && isVertex(graph, v)) anchors.add(v);
  }
  for (const e of edges) for (const v of graph.edgeVertices[e]!) anchors.add(v);
  const candidates = new Set<EdgeId>();
  for (const v of anchors) for (const e of graph.vertexEdges[v]!) candidates.add(e);
  return candidates;
}

/**
 * Edges where the seat could build a road (sorted). Only edges touching its own buildings or road
 * endpoints can qualify, so those are the only candidates checked.
 */
export function buildableRoadEdges(pieces: Pieces, graph: BoardGraph, seat: Seat): EdgeId[] {
  const candidates = anchorEdges(pieces, graph, seat, ownRoadEdges(pieces, graph, seat));
  return [...candidates].filter((e) => canBuildRoadAt(pieces, graph, seat, e)).sort();
}

/**
 * Edges where the seat could build a ship (sorted). Only edges touching its own buildings or ship
 * endpoints can qualify, so those are the only candidates checked. Empty on boards without sea.
 */
export function buildableShipEdges(pieces: SeaPieces, graph: BoardGraph, seat: Seat): EdgeId[] {
  if (graph.seaEdges.length === 0) return [];
  const candidates = anchorEdges(pieces, graph, seat, ownShipEdges(pieces, graph, seat));
  return [...candidates].filter((e) => canBuildShipAt(pieces, graph, seat, e)).sort();
}

/**
 * The seat's ship on `e` sits at the open end of a shipping line: one of its vertices has neither
 * the seat's building nor another of the seat's ships.
 */
export function isOpenShip(pieces: Pieces, graph: BoardGraph, seat: Seat, e: EdgeId): boolean {
  if (!isEdge(graph, e) || shipAt(pieces, e) !== seat) return false;
  return graph.edgeVertices[e]!.some((v) => {
    if (buildingAt(pieces, v)?.owner === seat) return false;
    return !graph.vertexEdges[v]!.some((x) => x !== e && shipAt(pieces, x) === seat);
  });
}

/**
 * Ships the seat may move and where each may go (MOVE_SHIP), ignoring phase and the
 * once-per-turn limit. A movable ship is open-ended, not placed this turn (`newShips`) and not on
 * an edge of the pirate's hex. A target is any edge where the ship could be built once lifted
 * from `from`, except `from` itself. Ships without a target are left out.
 */
export function shipMoveTargets(
  pieces: SeaPieces,
  graph: BoardGraph,
  seat: Seat,
  newShips: readonly EdgeId[],
): Record<EdgeId, EdgeId[]> {
  const out: Record<EdgeId, EdgeId[]> = {};
  for (const from of ownShipEdges(pieces, graph, seat).sort()) {
    if (newShips.includes(from) || !isOpenShip(pieces, graph, seat, from)) continue;
    if (pieces.pirate !== null && graph.edgeHexes[from]!.includes(pieces.pirate)) continue;
    const ships = { ...pieces.ships };
    delete ships[from];
    const targets = buildableShipEdges({ ...pieces, ships }, graph, seat).filter((e) => e !== from);
    if (targets.length > 0) out[from] = targets;
  }
  return out;
}

/** The seat's settlements (upgrade candidates). */
export const ownSettlements = (pieces: Pieces, seat: Seat): VertexId[] =>
  Object.keys(pieces.buildings)
    .filter(
      (v) => pieces.buildings[v]!.owner === seat && pieces.buildings[v]!.kind === 'settlement',
    )
    .sort();

/** Best maritime ratio per resource from the ports the seat has a building on. */
export function maritimeRatios(
  pieces: Pieces & { board: Pick<Board, 'ports'> },
  seat: Seat,
): ResourceCounts {
  const out = { brick: 4, lumber: 4, wool: 4, grain: 4, ore: 4 };
  for (const port of pieces.board.ports) {
    if (!port.vertices.some((v) => buildingAt(pieces, v)?.owner === seat)) continue;
    if (port.type === 'any') for (const r of RESOURCES) out[r] = Math.min(out[r], 3);
    else out[port.type] = 2;
  }
  return out;
}
