import { describe, expect, it } from 'vitest';
import {
  SCENARIO_IDS,
  createGame,
  graphFor,
  hexToPixel,
  normalizeConfig,
  vertexToPixel,
} from '@hexhaven/engine';
import {
  HEX_SIZE,
  RIM_MARGIN,
  boardViewBox,
  boundsOf,
  clampSprite,
  edgeMidpoint,
  edgePoints,
  hexCornerPoints,
  landHull,
  portAnchor,
  rimSeaHexes,
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
    expect(
      boardViewBox({ layoutId: 'x', hexes: [], ports: [], homeIslands: [], islandBonusVP: 0 })
        .width,
    ).toBeGreaterThan(0);
  });
});

describe('Open Seas boards', () => {
  const seas = SCENARIO_IDS.map((scenario) => {
    const players = scenario === 'grandVoyage' ? 5 : 4;
    const cfg = normalizeConfig({ players, variant: 'seafarers', scenario });
    return [scenario, createGame(cfg, 'geo').board] as const;
  });

  it('classic boards have no rim to crop', () => {
    expect(rimSeaHexes(board4).size).toBe(0);
    expect(rimSeaHexes(board6).size).toBe(0);
  });

  for (const [id, board] of seas) {
    it(`crops the outer sea ring but keeps land, ports and rim centres in view (${id})`, () => {
      const rim = rimSeaHexes(board);
      expect(rim.size).toBeGreaterThan(0);
      for (const h of board.hexes) if (rim.has(h.id)) expect(h.terrain).toBe('sea');
      const vb = boardViewBox(board);
      const inside = (p: { x: number; y: number }) =>
        p.x >= vb.minX - 0.01 &&
        p.x <= vb.minX + vb.width + 0.01 &&
        p.y >= vb.minY - 0.01 &&
        p.y <= vb.minY + vb.height + 0.01;
      const g = graphFor(board);
      for (const h of board.hexes) {
        if (h.terrain !== 'sea')
          for (const p of hexCornerPoints(h.q, h.r)) expect(inside(p)).toBe(true);
        // Every hex centre stays visible, so a pirate on the rim is never off-screen.
        expect(inside(hexToPixel(h.q, h.r, HEX_SIZE))).toBe(true);
      }
      for (const port of board.ports) expect(inside(portAnchor(g, port.edge))).toBe(true);
      // Whole sprites stay in view: the pirate on any sea hex (clamped into the box), and a
      // ship on any sea edge (drawn at midpoint + 2, about 28×24).
      const box = (c: { x: number; y: number }, dx: number, top: number, bottom: number) =>
        [
          { x: c.x - dx, y: c.y + top },
          { x: c.x + dx, y: c.y + bottom },
        ].every(inside);
      for (const h of board.hexes)
        if (h.terrain === 'sea') {
          const c = hexToPixel(h.q, h.r, HEX_SIZE);
          const at = clampSprite({ x: c.x, y: c.y + 4 }, vb, 18, -21, 11);
          expect(box(at, 18, -21, 11)).toBe(true);
          // Clamping only nudges it: the pirate stays over its own hex.
          expect(Math.hypot(at.x - c.x, at.y - c.y)).toBeLessThan(HEX_SIZE * 0.5);
        }
      for (const e of g.seaEdges) expect(box(edgeMidpoint(g, e), 14, -12, 10)).toBe(true);
      // Smaller than the uncropped box would be.
      const xs = board.hexes.flatMap((h) => hexCornerPoints(h.q, h.r).map((p) => p.x));
      expect(vb.width).toBeLessThan(Math.max(...xs) - Math.min(...xs));
      expect(RIM_MARGIN).toBeLessThan(1.5);
    });

    it(`pushes ports out over the sea, away from their land hex (${id})`, () => {
      const g = graphFor(board);
      for (const port of board.ports) {
        const land = g.edgeHexes[port.edge]!.find((h) => g.islandOf[h] !== undefined)!;
        const [q, r] = land.split(',').map(Number);
        const c = hexToPixel(q!, r!, HEX_SIZE);
        const a = portAnchor(g, port.edge);
        expect(Math.hypot(a.x - c.x, a.y - c.y)).toBeGreaterThan(HEX_SIZE);
      }
    });
  }

  it('edge midpoints sit halfway between the endpoints', () => {
    const g = graphFor(board4);
    const e = g.edges[3]!;
    const [a, b] = edgePoints(g, e);
    expect(edgeMidpoint(g, e)).toEqual({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
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

describe('landHull (table frame)', () => {
  for (const [name, board] of [
    ['base', board4],
    ['ext56', board6],
  ] as const) {
    it(`is convex and keeps every port marker on the water inside it (${name})`, () => {
      const hull = landHull(board, 2.2);
      const n = hull.length;
      // Clockwise in screen space (y down): every turn has a positive cross product.
      for (let i = 0; i < n; i++) {
        const [a, b, c] = [hull[i]!, hull[(i + 1) % n]!, hull[(i + 2) % n]!];
        expect((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)).toBeGreaterThan(0);
      }
      const inside = (p: { x: number; y: number }) =>
        hull.every((a, i) => {
          const b = hull[(i + 1) % n]!;
          return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= 0;
        });
      const graph = graphFor(board);
      for (const port of board.ports) {
        const a = portAnchor(graph, port.edge);
        for (const [dx, dy] of [
          [0, 0],
          [18, 0],
          [-18, 0],
          [0, 18],
          [0, -18],
        ])
          expect(inside({ x: a.x + dx!, y: a.y + dy! })).toBe(true);
      }
    });
  }

  it('falls back to a square for an empty point set', () => {
    expect(boundsOf([], 5, 60)).toEqual({ minX: 0, minY: 0, width: 60, height: 60 });
  });

  it('bounds a point set with padding', () => {
    expect(
      boundsOf(
        [
          { x: 0, y: 1 },
          { x: 4, y: -2 },
        ],
        1,
      ),
    ).toEqual({
      minX: -1,
      minY: -3,
      width: 6,
      height: 5,
    });
  });
});
