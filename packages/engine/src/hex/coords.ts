/**
 * Pointy-top axial coordinates. See docs/ARCHITECTURE.md#hex-model.
 *
 * Hex corners (clockwise from top): N, NE, SE, S, SW, NW.
 * Every vertex is canonically the N or S corner of exactly one hex:
 *   NE(q,r) = S(q+1,r-1)   SE(q,r) = N(q,r+1)   SW(q,r) = N(q-1,r+1)   NW(q,r) = S(q,r-1)
 * Every edge is canonically the NE, NW or W side of exactly one hex:
 *   E(q,r) = W(q+1,r)      SE(q,r) = NW(q,r+1)  SW(q,r) = NE(q-1,r+1)
 */
import type { EdgeId, HexId, VertexId } from '../types';

export const hexId = (q: number, r: number): HexId => `${q},${r}`;

export function parseHexId(id: HexId): { q: number; r: number } {
  const [q, r] = id.split(',').map(Number);
  return { q: q!, r: r! };
}

export const vertexId = (q: number, r: number, c: 'N' | 'S'): VertexId => `${q},${r},${c}`;
export const edgeId = (q: number, r: number, side: 'NE' | 'NW' | 'W'): EdgeId =>
  `${q},${r},${side}`;

/** Neighbor offsets in order E, NE, NW, W, SW, SE. */
export const HEX_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

export function hexNeighbors(q: number, r: number): HexId[] {
  return HEX_DIRECTIONS.map(([dq, dr]) => hexId(q + dq, r + dr));
}

/** The 6 corner vertices of a hex, clockwise from N: [N, NE, SE, S, SW, NW]. */
export function hexCorners(q: number, r: number): VertexId[] {
  return [
    vertexId(q, r, 'N'),
    vertexId(q + 1, r - 1, 'S'),
    vertexId(q, r + 1, 'N'),
    vertexId(q, r, 'S'),
    vertexId(q - 1, r + 1, 'N'),
    vertexId(q, r - 1, 'S'),
  ];
}

/** The 6 sides of a hex, clockwise from the NE side: [NE, E, SE, SW, W, NW]. Side i joins corner i and corner i+1. */
export function hexSides(q: number, r: number): EdgeId[] {
  return [
    edgeId(q, r, 'NE'),
    edgeId(q + 1, r, 'W'),
    edgeId(q, r + 1, 'NW'),
    edgeId(q - 1, r + 1, 'NE'),
    edgeId(q, r, 'W'),
    edgeId(q, r, 'NW'),
  ];
}

/** Pixel center of a hex for a given circumradius (pointy-top, y grows downward). */
export function hexToPixel(q: number, r: number, size: number): { x: number; y: number } {
  return { x: size * Math.sqrt(3) * (q + r / 2), y: size * 1.5 * r };
}

/** Pixel position of a vertex id. */
export function vertexToPixel(v: VertexId, size: number): { x: number; y: number } {
  const [qs, rs, c] = v.split(',');
  const { x, y } = hexToPixel(Number(qs), Number(rs), size);
  return { x, y: c === 'N' ? y - size : y + size };
}
