import type { EdgeId, HexId, Terrain, VertexId } from '../types';
import { hexCorners, hexId, hexSides } from './coords';

/**
 * Adjacency graph for a set of hexes. Pure function of the hex ids and which of them are sea;
 * memoized. Hexes given without a terrain count as land, so a board without sea (base, ext56)
 * yields the same graph as before sea existed: every vertex/edge is a land vertex/road edge.
 */
export interface BoardGraph {
  hexIds: HexId[];
  vertices: VertexId[];
  edges: EdgeId[];
  hexVertices: Record<HexId, VertexId[]>;
  hexEdges: Record<HexId, EdgeId[]>;
  vertexHexes: Record<VertexId, HexId[]>;
  vertexEdges: Record<VertexId, EdgeId[]>;
  vertexNeighbors: Record<VertexId, VertexId[]>;
  edgeVertices: Record<EdgeId, [VertexId, VertexId]>;
  edgeHexes: Record<EdgeId, HexId[]>;
  /**
   * Edges touching exactly one land hex (land|sea, or land|off-board), ordered as a walk: each
   * coastline is one closed cycle, cycles follow each other (each starts at its smallest edge id
   * among the edges not yet walked). Without sea this is the single outer coastline as before.
   */
  coastEdges: EdgeId[];
  /** Non-sea hexes, in board order. */
  landHexes: HexId[];
  /**
   * Land hex -> island index. Islands are the connected components of land hexes, numbered in
   * order of their first hex in `landHexes`.
   */
  islandOf: Record<HexId, number>;
  /** Vertices touching at least one land hex (where buildings may stand). Sorted. */
  landVertices: VertexId[];
  /** Edges touching at least one land hex (where roads may go). Sorted. */
  roadEdges: EdgeId[];
  /**
   * Edges touching at least one sea hex and lying between two hexes (where ships may go; the
   * board rim is excluded). Sorted. Empty on boards without sea.
   */
  seaEdges: EdgeId[];
}

/** A hex for graph purposes: terrain only matters as sea vs land (absent = land). */
export type GraphHex = { q: number; r: number; terrain?: Terrain };

const cache = new Map<string, BoardGraph>();

function push<K extends string, V>(m: Record<K, V[]>, k: K, v: V): void {
  const arr = m[k] ?? (m[k] = []);
  if (!arr.includes(v)) arr.push(v);
}

function deepFreeze(o: object): void {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  Object.freeze(o);
}

/**
 * Returns a cached, deeply frozen graph — never mutate it.
 * WARNING: hexes without `terrain` count as land. Pass the board's hexes (or graphFor(board)),
 * not bare layout coordinates, whenever the board may contain sea, or you get an all-land graph.
 */
export function buildGraph(coords: ReadonlyArray<GraphHex>): BoardGraph {
  // Sea hexes get a '~' suffix: same coordinates with a different sea pattern is another graph.
  const key = coords
    .map((c) => hexId(c.q, c.r) + (c.terrain === 'sea' ? '~' : ''))
    .sort()
    .join(';');
  const hit = cache.get(key);
  if (hit) return hit;

  const g: BoardGraph = {
    hexIds: [],
    vertices: [],
    edges: [],
    hexVertices: {},
    hexEdges: {},
    vertexHexes: {},
    vertexEdges: {},
    vertexNeighbors: {},
    edgeVertices: {},
    edgeHexes: {},
    coastEdges: [],
    landHexes: [],
    islandOf: {},
    landVertices: [],
    roadEdges: [],
    seaEdges: [],
  };

  const sea = new Set<HexId>();
  for (const { q, r, terrain } of coords) {
    const h = hexId(q, r);
    g.hexIds.push(h);
    if (terrain === 'sea') sea.add(h);
    else g.landHexes.push(h);
    const corners = hexCorners(q, r);
    const sides = hexSides(q, r);
    g.hexVertices[h] = corners;
    g.hexEdges[h] = sides;
    corners.forEach((v) => push(g.vertexHexes, v, h));
    sides.forEach((e, i) => {
      push(g.edgeHexes, e, h);
      const a = corners[i]!;
      const b = corners[(i + 1) % 6]!;
      g.edgeVertices[e] = [a, b];
      push(g.vertexEdges, a, e);
      push(g.vertexEdges, b, e);
      push(g.vertexNeighbors, a, b);
      push(g.vertexNeighbors, b, a);
    });
  }
  g.vertices = Object.keys(g.vertexHexes).sort();
  g.edges = Object.keys(g.edgeVertices).sort();

  const isLand = (h: HexId): boolean => !sea.has(h);
  const landCount = (hs: readonly HexId[]): number => hs.filter(isLand).length;
  g.landVertices = g.vertices.filter((v) => landCount(g.vertexHexes[v]!) > 0);
  g.roadEdges = g.edges.filter((e) => landCount(g.edgeHexes[e]!) > 0);
  g.seaEdges = g.edges.filter((e) => {
    const hs = g.edgeHexes[e]!;
    return hs.length === 2 && hs.some((h) => sea.has(h));
  });

  // Islands: connected components of land hexes (hexes sharing an edge).
  let island = 0;
  for (const start of g.landHexes) {
    if (Object.hasOwn(g.islandOf, start)) continue;
    const stack = [start];
    g.islandOf[start] = island;
    while (stack.length > 0) {
      const h = stack.pop()!;
      for (const e of g.hexEdges[h]!)
        for (const n of g.edgeHexes[e]!)
          if (isLand(n) && !Object.hasOwn(g.islandOf, n)) {
            g.islandOf[n] = island;
            stack.push(n);
          }
    }
    island++;
  }

  // Walk each coastline in order. Every vertex touches 0 or 2 coastal edges, so the coastal
  // edges form disjoint cycles; walk them one after another.
  const coastal = new Set(g.edges.filter((e) => landCount(g.edgeHexes[e]!) === 1));
  const walked = new Set<EdgeId>();
  const ordered: EdgeId[] = [];
  for (const first of [...coastal].sort()) {
    if (walked.has(first)) continue;
    let current = first;
    let at = g.edgeVertices[current]![1];
    for (;;) {
      ordered.push(current);
      walked.add(current);
      const next = g.vertexEdges[at]!.find((e) => coastal.has(e) && !walked.has(e));
      if (!next) break;
      const [a, b] = g.edgeVertices[next]!;
      at = a === at ? b : a;
      current = next;
    }
  }
  g.coastEdges = ordered;

  deepFreeze(g);
  cache.set(key, g);
  return g;
}

/**
 * Graphs per board object. buildGraph re-derives its key from every hex on each call, and the
 * reducer, legal and view call graphFor many times per action on the same board. A board's hexes
 * never change during a game; the hexes array is checked too, so replacing it re-derives.
 */
const byBoard = new WeakMap<object, { hexes: ReadonlyArray<GraphHex>; graph: BoardGraph }>();

/** Convenience: graph for a board's hexes (reads each hex's terrain for sea vs land). */
export function graphFor(board: { hexes: ReadonlyArray<GraphHex> }): BoardGraph {
  const hit = byBoard.get(board);
  if (hit && hit.hexes === board.hexes) return hit.graph;
  const graph = buildGraph(board.hexes);
  byBoard.set(board, { hexes: board.hexes, graph });
  return graph;
}
