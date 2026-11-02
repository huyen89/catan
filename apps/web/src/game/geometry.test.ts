import { describe, expect, it } from 'vitest';
import { createGame, graphFor, hexToPixel, normalizeConfig, vertexToPixel } from '@hexhaven/engine';
import {
  HEX_SIZE,
  boardViewBox,
  edgePoints,
  hexCornerPoints,
  portAnchor,
  shrinkSegment,
  tokenPips,
  viewBoxAttr,
} from './geometry';

const board4 = createGame(normalizeConfig({ players: 4 }), 'geo').board;
const board6 = createGame(normalizeConfig({ players: 6 }), 'geo').board;

describe('hex geometry', () => {
  it('hex corners match the engine vertex positions (N corner first, S corner fourth)', () => {
    const pts = hexCornerPoints(1, -1);
    expect(pts).toHaveLength(6);
    const n = vertexToPixel('1,-1,N', HEX_SIZE);
    const s = vertexToPixel('1,-1,S', HEX_SIZE);
    expect(pts[0]!.x).toBeCloseTo(n.x);
    expect(pts[0]!.y).toBeCloseTo(n.y);
    expect(pts[3]!.x).toBeCloseTo(s.x);
    expect(pts[3]!.y).toBeCloseTo(s.y);
  });

  it('edge endpoints are the two vertex positions of the edge', () => {
    const g = graphFor(board4);
    const e = g.edges[0]!;
    const [a, b] = edgePoints(graphFor(board4), e);
    const [va, vb] = g.edgeVertices[e]!;
    expect(a).toEqual(vertexToPixel(va, HEX_SIZE));
    expect(b).toEqual(vertexToPixel(vb, HEX_SIZE));
    expect(() => edgePoints(graphFor(board4), '99,99,NE')).toThrow();
  });

  it('shrinkSegment trims both ends symmetrically', () => {
    const [a, b] = shrinkSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, 0.1);
    expect(a).toEqual({ x: 1, y: 0 });
    expect(b).toEqual({ x: 9, y: 0 });
  });
});

describe('boardViewBox', () => {
  for (const [name, board] of [
    ['base', board4],
    ['ext56', board6],
  ] as const) {
    it(`contains every hex corner and every port marker (${name})`, () => {
      const vb = boardViewBox(board);
      const inside = (p: { x: number; y: number }) =>
        p.x >= vb.minX && p.x <= vb.minX + vb.width && p.y >= vb.minY && p.y <= vb.minY + vb.height;
      for (const h of board.hexes)
        for (const p of hexCornerPoints(h.q, h.r)) expect(inside(p)).toBe(true);
      for (const port of board.ports) {
        const a = portAnchor(graphFor(board), port.edge);
        // marker radius is 0.3 hex
        expect(inside({ x: a.x - 18, y: a.y - 18 })).toBe(true);
        expect(inside({ x: a.x + 18, y: a.y + 18 })).toBe(true);
      }
      expect(viewBoxAttr(vb).split(' ')).toHaveLength(4);
    });
  }

  it('is wider for the 5-6 player board', () => {
    expect(boardViewBox(board6).width).toBeGreaterThan(boardViewBox(board4).width);
  });

  it('handles an empty board', () => {
    expect(boardViewBox({ layoutId: 'x', hexes: [], ports: [] }).width).toBeGreaterThan(0);
  });
});

describe('portAnchor', () => {
  it('sits outside the land hex that owns the coastal edge', () => {
    const g = graphFor(board4);
    for (const port of board4.ports) {
      const land = g.edgeHexes[port.edge]![0]!;
      const [q, r] = land.split(',').map(Number);
      const c = hexToPixel(q!, r!, HEX_SIZE);
      const a = portAnchor(g, port.edge);
      expect(Math.hypot(a.x - c.x, a.y - c.y)).toBeGreaterThan(HEX_SIZE);
    }
  });
});

describe('tokenPips', () => {
  it('counts probability dots', () => {
    expect([2, 3, 4, 5, 6, 8, 9, 10, 11, 12].map(tokenPips)).toEqual([
      1, 2, 3, 4, 5, 5, 4, 3, 2, 1,
    ]);
    expect(tokenPips(7)).toBe(0);
    expect(tokenPips(13)).toBe(0);
  });
});
