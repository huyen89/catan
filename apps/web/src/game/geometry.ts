import {
  hexNeighbors,
  hexToPixel,
  parseHexId,
  vertexToPixel,
  type Board,
  type BoardGraph,
  type EdgeId,
  type HexId,
  type VertexId,
} from '@hexhaven/engine';

/** Circumradius of a hex in SVG user units. */
export const HEX_SIZE = 60;

export interface Point {
  x: number;
  y: number;
}

export interface ViewBox {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

/** Corner points of a pointy-top hex, clockwise from the top (N) corner. */
export function hexCornerPoints(q: number, r: number, size = HEX_SIZE): Point[] {
  const c = hexToPixel(q, r, size);
  return Array.from({ length: 6 }, (_, i) => {
    const a = ((60 * i - 90) * Math.PI) / 180;
    return { x: c.x + size * Math.cos(a), y: c.y + size * Math.sin(a) };
  });
}

export const pointsAttr = (pts: Point[]): string =>
  pts.map((p) => `${round(p.x)},${round(p.y)}`).join(' ');

export const round = (n: number): number => Math.round(n * 100) / 100;

export function hexCenter(id: HexId, size = HEX_SIZE): Point {
  const { q, r } = parseHexId(id);
  return hexToPixel(q, r, size);
}

export function vertexPoint(id: VertexId, size = HEX_SIZE): Point {
  return vertexToPixel(id, size);
}

/** Both endpoints of an edge, from the board's adjacency graph (`graphFor(board)`). */
export function edgePoints(graph: BoardGraph, id: EdgeId, size = HEX_SIZE): [Point, Point] {
  const ends = graph.edgeVertices[id];
  if (!ends) throw new Error(`Unknown edge ${id}`);
  return [vertexToPixel(ends[0], size), vertexToPixel(ends[1], size)];
}

/** Shrink a segment towards its middle by `fraction` of its length at each end. */
export function shrinkSegment(a: Point, b: Point, fraction: number): [Point, Point] {
  const dx = (b.x - a.x) * fraction;
  const dy = (b.y - a.y) * fraction;
  return [
    { x: a.x + dx, y: a.y + dy },
    { x: b.x - dx, y: b.y - dy },
  ];
}

/** How far ports stick out beyond the coastline, in hex radii. */
export const PORT_OFFSET = 0.62;

/**
 * Where to draw a port marker: pushed out from the coast edge's midpoint, away from the land hex
 * that owns the edge.
 */
export function portAnchor(g: BoardGraph, edge: EdgeId, size = HEX_SIZE): Point {
  const [a, b] = edgePoints(g, edge, size);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const land = g.edgeHexes[edge]?.[0];
  if (!land) return mid;
  const c = hexCenter(land, size);
  const dx = mid.x - c.x;
  const dy = mid.y - c.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: mid.x + (dx / len) * size * PORT_OFFSET, y: mid.y + (dy / len) * size * PORT_OFFSET };
}

/** Midpoint of an edge (where ships sit). */
export function edgeMidpoint(graph: BoardGraph, id: EdgeId, size = HEX_SIZE): Point {
  const [a, b] = edgePoints(graph, id, size);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Sea hexes on the outer rim of a sea-framed board (fewer than six neighbours on the board).
 * They only frame the map, so the viewBox may cut them in half to give the islands more room.
 */
export function rimSeaHexes(board: Board): Set<HexId> {
  const ids = new Set(board.hexes.map((h) => h.id));
  const rim = new Set<HexId>();
  for (const h of board.hexes) {
    if (h.terrain !== 'sea') continue;
    if (hexNeighbors(h.q, h.r).some((n) => !ids.has(n))) rim.add(h.id);
  }
  return rim;
}

/** How much of the rim stays visible around the inner hexes of a sea-framed board, in radii. */
export const RIM_MARGIN = 0.9;

/**
 * A viewBox containing every hex plus room for port markers around the coast. On sea-framed
 * boards (Open Seas) the outer sea ring is cropped to about half a hex: ports sit on inner
 * coasts there, and the bigger maps need every pixel on a phone.
 */
export function boardViewBox(board: Board, size = HEX_SIZE): ViewBox {
  const rim = rimSeaHexes(board);
  const inner = board.hexes.filter((h) => !rim.has(h.id));
  const cropped = rim.size > 0 && inner.length > 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const h of cropped ? inner : board.hexes) {
    for (const p of hexCornerPoints(h.q, h.r, size)) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, width: size, height: size };
  const margin = size * (cropped ? RIM_MARGIN : PORT_OFFSET + 0.45);
  return {
    minX: round(minX - margin),
    minY: round(minY - margin),
    width: round(maxX - minX + 2 * margin),
    height: round(maxY - minY + 2 * margin),
  };
}

export const viewBoxAttr = (v: ViewBox): string => `${v.minX} ${v.minY} ${v.width} ${v.height}`;

/** Number of probability dots under a number token (2 and 12 → 1, 6 and 8 → 5). */
export function tokenPips(n: number): number {
  return n >= 2 && n <= 12 && n !== 7 ? 6 - Math.abs(7 - n) : 0;
}

export const isHotToken = (n: number): boolean => n === 6 || n === 8;
