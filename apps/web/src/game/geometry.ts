import {
  graphFor,
  hexToPixel,
  parseHexId,
  vertexToPixel,
  type Board,
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

/** Both endpoints of an edge, from the board's adjacency graph. */
export function edgePoints(board: Board, id: EdgeId, size = HEX_SIZE): [Point, Point] {
  const ends = graphFor(board).edgeVertices[id];
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
export function portAnchor(board: Board, edge: EdgeId, size = HEX_SIZE): Point {
  const g = graphFor(board);
  const [a, b] = edgePoints(board, edge, size);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const land = g.edgeHexes[edge]?.[0];
  if (!land) return mid;
  const c = hexCenter(land, size);
  const dx = mid.x - c.x;
  const dy = mid.y - c.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: mid.x + (dx / len) * size * PORT_OFFSET, y: mid.y + (dy / len) * size * PORT_OFFSET };
}

/** A viewBox containing every hex plus room for port markers around the coast. */
export function boardViewBox(board: Board, size = HEX_SIZE): ViewBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const h of board.hexes) {
    for (const p of hexCornerPoints(h.q, h.r, size)) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, width: size, height: size };
  const margin = size * (PORT_OFFSET + 0.45);
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
