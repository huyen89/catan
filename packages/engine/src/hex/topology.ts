import type { EdgeId, HexId, VertexId } from '../types';
import { hexCorners, hexId, hexSides } from './coords';

/** Adjacency graph for a set of land hexes. Pure function of the hex id list; memoized. */
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
  /** Edges touching exactly one land hex, ordered as a walk around the coastline. */
  coastEdges: EdgeId[];
}

const cache = new Map<string, BoardGraph>();

function push<K extends string, V>(m: Record<K, V[]>, k: K, v: V): void {
  const arr = m[k] ?? (m[k] = []);
  if (!arr.includes(v)) arr.push(v);
}

function deepFreeze(o: object): void {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  Object.freeze(o);
}

/** Returns a cached, deeply frozen graph — never mutate it. */
export function buildGraph(coords: ReadonlyArray<{ q: number; r: number }>): BoardGraph {
  const key = coords
    .map((c) => hexId(c.q, c.r))
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
  };

  for (const { q, r } of coords) {
    const h = hexId(q, r);
    g.hexIds.push(h);
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

  // Walk the coastline in order.
  const coastal = new Set(g.edges.filter((e) => g.edgeHexes[e]!.length === 1));
  const ordered: EdgeId[] = [];
  if (coastal.size > 0) {
    let current = [...coastal].sort()[0]!;
    let at = g.edgeVertices[current]![1];
    while (ordered.length < coastal.size) {
      ordered.push(current);
      const next = g.vertexEdges[at]!.find((e) => coastal.has(e) && !ordered.includes(e));
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

/** Convenience: graph for a board's hexes. */
export function graphFor(board: { hexes: ReadonlyArray<{ q: number; r: number }> }): BoardGraph {
  return buildGraph(board.hexes);
}
