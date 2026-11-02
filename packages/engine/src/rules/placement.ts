/**
 * Placement geometry: distance rule, road connectivity, port ratios.
 * Functions take only the piece maps they need so the bot can call them on a PlayerView too.
 */
import type { BoardGraph } from '../hex/topology';
import type { Board, Building, EdgeId, ResourceCounts, Seat, VertexId } from '../types';
import { RESOURCES } from '../types';

/** The piece maps placement rules look at (present on both GameState and PlayerView). */
export interface Pieces {
  buildings: Record<VertexId, Building>;
  roads: Record<EdgeId, Seat>;
}

export const isVertex = (graph: BoardGraph, v: unknown): v is VertexId =>
  typeof v === 'string' && Object.hasOwn(graph.vertexHexes, v);

export const isEdge = (graph: BoardGraph, e: unknown): e is EdgeId =>
  typeof e === 'string' && Object.hasOwn(graph.edgeVertices, e);

const roadAt = (pieces: Pieces, e: EdgeId): Seat | undefined =>
  Object.hasOwn(pieces.roads, e) ? pieces.roads[e] : undefined;

const buildingAt = (pieces: Pieces, v: VertexId): Building | undefined =>
  Object.hasOwn(pieces.buildings, v) ? pieces.buildings[v] : undefined;

/** Distance rule: the vertex and all its neighbours are free. */
export function distanceRuleOk(pieces: Pieces, graph: BoardGraph, v: VertexId): boolean {
  if (buildingAt(pieces, v)) return false;
  return graph.vertexNeighbors[v]!.every((n) => !buildingAt(pieces, n));
}

/** Setup settlement: any vertex respecting the distance rule. */
export function canPlaceSetupSettlement(pieces: Pieces, graph: BoardGraph, v: unknown): boolean {
  return isVertex(graph, v) && distanceRuleOk(pieces, graph, v);
}

/** Regular settlement: distance rule + touches one of the seat's roads. */
export function canBuildSettlementAt(
  pieces: Pieces,
  graph: BoardGraph,
  seat: Seat,
  v: unknown,
): boolean {
  return (
    isVertex(graph, v) &&
    distanceRuleOk(pieces, graph, v) &&
    graph.vertexEdges[v]!.some((e) => roadAt(pieces, e) === seat)
  );
}

/**
 * Regular road: free edge that touches the seat's own building, or the seat's own road at a vertex
 * not occupied by an opponent's building.
 */
export function canBuildRoadAt(pieces: Pieces, graph: BoardGraph, seat: Seat, e: unknown): boolean {
  if (!isEdge(graph, e) || roadAt(pieces, e) !== undefined) return false;
  return graph.edgeVertices[e]!.some((u) => {
    const b = buildingAt(pieces, u);
    if (b) return b.owner === seat;
    return graph.vertexEdges[u]!.some((x) => x !== e && roadAt(pieces, x) === seat);
  });
}

/** Setup road: free edge touching the settlement just placed. */
export function canPlaceSetupRoad(
  pieces: Pieces,
  graph: BoardGraph,
  lastSettlement: VertexId | null,
  e: unknown,
): boolean {
  return (
    lastSettlement !== null &&
    isEdge(graph, e) &&
    roadAt(pieces, e) === undefined &&
    graph.edgeVertices[e]!.includes(lastSettlement)
  );
}

export const setupSettlementVertices = (pieces: Pieces, graph: BoardGraph): VertexId[] =>
  graph.vertices.filter((v) => distanceRuleOk(pieces, graph, v));

export const setupRoadEdges = (
  pieces: Pieces,
  graph: BoardGraph,
  lastSettlement: VertexId | null,
): EdgeId[] =>
  lastSettlement === null || !isVertex(graph, lastSettlement)
    ? []
    : graph.vertexEdges[lastSettlement]!.filter((e) => roadAt(pieces, e) === undefined).sort();

export const buildableSettlementVertices = (
  pieces: Pieces,
  graph: BoardGraph,
  seat: Seat,
): VertexId[] => graph.vertices.filter((v) => canBuildSettlementAt(pieces, graph, seat, v));

export const buildableRoadEdges = (pieces: Pieces, graph: BoardGraph, seat: Seat): EdgeId[] =>
  graph.edges.filter((e) => canBuildRoadAt(pieces, graph, seat, e));

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
