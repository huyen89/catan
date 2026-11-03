import { describe, expect, it } from 'vitest';
import {
  BASE_LAYOUT,
  EXT56_LAYOUT,
  SCENARIOS,
  SCENARIO_IDS,
  type LayoutDef,
  type ScenarioId,
} from '../board/layouts';
import { hexId } from './coords';
import { buildGraph, type BoardGraph } from './topology';

describe('topology', () => {
  it('base 19-hex board has 54 vertices, 72 edges, 30 coastal edges', () => {
    const g = buildGraph(BASE_LAYOUT.hexes);
    expect(g.hexIds).toHaveLength(19);
    expect(g.vertices).toHaveLength(54);
    expect(g.edges).toHaveLength(72);
    expect(g.coastEdges).toHaveLength(30);
  });

  it('5-6 player 30-hex board has 80 vertices, 109 edges, 38 coastal edges', () => {
    const g = buildGraph(EXT56_LAYOUT.hexes);
    expect(g.hexIds).toHaveLength(30);
    expect(g.vertices).toHaveLength(80);
    expect(g.edges).toHaveLength(109);
    expect(g.coastEdges).toHaveLength(38);
  });

  it('every vertex has 2-3 neighbors and every edge 2 distinct endpoints', () => {
    for (const layout of [BASE_LAYOUT, EXT56_LAYOUT]) {
      const g = buildGraph(layout.hexes);
      for (const v of g.vertices) {
        expect(g.vertexNeighbors[v]!.length).toBeGreaterThanOrEqual(2);
        expect(g.vertexNeighbors[v]!.length).toBeLessThanOrEqual(3);
      }
      for (const e of g.edges) {
        const [a, b] = g.edgeVertices[e]!;
        expect(a).not.toBe(b);
        expect(g.vertexNeighbors[a]).toContain(b);
      }
    }
  });

  it('coastline walk is a closed cycle', () => {
    const g = buildGraph(BASE_LAYOUT.hexes);
    const first = g.edgeVertices[g.coastEdges[0]!]!;
    const last = g.edgeVertices[g.coastEdges.at(-1)!]!;
    expect(first.some((v) => last.includes(v))).toBe(true);
  });

  it('boards without sea: land sets are the full sets and there are no sea edges', () => {
    for (const layout of [BASE_LAYOUT, EXT56_LAYOUT]) {
      const g = buildGraph(layout.hexes);
      expect(g.landHexes).toEqual(g.hexIds);
      expect(g.landVertices).toEqual(g.vertices);
      expect(g.roadEdges).toEqual(g.edges);
      expect(g.seaEdges).toEqual([]);
      expect(new Set(Object.values(g.islandOf))).toEqual(new Set([0]));
    }
  });
});

describe('topology of sea-framed scenario boards', () => {
  const seaOf = (layout: LayoutDef): Set<string> =>
    new Set(
      (layout.fixedHexes ?? []).filter((f) => f.terrain === 'sea').map((f) => hexId(f.q, f.r)),
    );
  /** The layout's hexes with sea marked (which land terrain does not matter to the graph). */
  const hexesOf = (layout: LayoutDef) => {
    const sea = seaOf(layout);
    return layout.hexes.map(({ q, r }) => ({
      q,
      r,
      terrain: sea.has(hexId(q, r)) ? ('sea' as const) : ('forest' as const),
    }));
  };
  const islandSizes = (g: BoardGraph): number[] => {
    const sizes: number[] = [];
    for (const h of g.landHexes) sizes[g.islandOf[h]!] = (sizes[g.islandOf[h]!] ?? 0) + 1;
    return sizes;
  };
  const expected: Record<ScenarioId, { islands: number[]; coast: number }> = {
    newShores: { islands: [19, 2, 3, 2], coast: 72 },
    archipelago: { islands: [5, 5, 1, 5, 5], coast: 70 },
    grandVoyage: { islands: [27, 2, 2, 2, 1], coast: 78 },
  };

  for (const id of SCENARIO_IDS) {
    const layout = SCENARIOS[id];
    const sea = seaOf(layout);
    const isLand = (h: string): boolean => !sea.has(h);
    const g = buildGraph(hexesOf(layout));

    it(`${id}: islands are the land components; the frame is sea`, () => {
      expect(islandSizes(g)).toEqual(expected[id].islands);
      for (const e of g.edges) {
        const land = g.edgeHexes[e]!.filter(isLand);
        if (land.length === 2) expect(g.islandOf[land[0]!]).toBe(g.islandOf[land[1]!]);
        if (g.edgeHexes[e]!.length === 1) expect(land).toEqual([]);
      }
      for (const h of layout.homeHexes ?? []) expect(g.landHexes).toContain(h);
    });

    it(`${id}: land vertices, road edges and sea edges`, () => {
      expect(g.landVertices).toEqual(g.vertices.filter((v) => g.vertexHexes[v]!.some(isLand)));
      expect(g.roadEdges).toEqual(g.edges.filter((e) => g.edgeHexes[e]!.some(isLand)));
      expect(g.seaEdges.length).toBeGreaterThan(0);
      for (const e of g.seaEdges) {
        expect(g.edgeHexes[e]).toHaveLength(2);
        expect(g.edgeHexes[e]!.some((h) => !isLand(h))).toBe(true);
      }
      // Every land vertex is reachable from every other over road and ship edges.
      const usable = new Set([...g.roadEdges, ...g.seaEdges]);
      const start = g.landVertices[0]!;
      const seen = new Set([start]);
      const stack = [start];
      while (stack.length > 0) {
        const v = stack.pop()!;
        for (const e of g.vertexEdges[v]!) {
          if (!usable.has(e)) continue;
          for (const w of g.edgeVertices[e]!)
            if (!seen.has(w)) {
              seen.add(w);
              stack.push(w);
            }
        }
      }
      for (const v of g.landVertices) expect(seen.has(v), v).toBe(true);
    });

    it(`${id}: coastEdges are the land|sea edges, walked as one closed cycle per island`, () => {
      const coast = g.edges.filter((e) => {
        const hs = g.edgeHexes[e]!;
        return hs.length === 2 && hs.filter(isLand).length === 1;
      });
      expect([...g.coastEdges].sort()).toEqual(coast);
      expect(g.coastEdges).toHaveLength(expected[id].coast);
      // Split the walk where consecutive edges stop sharing a vertex; each piece must close.
      let cycleStart = 0;
      const cycleIslands: number[] = [];
      for (let i = 0; i < g.coastEdges.length; i++) {
        const here = g.edgeVertices[g.coastEdges[i]!]!;
        const next = g.coastEdges[i + 1];
        if (next !== undefined && g.edgeVertices[next]!.some((v) => here.includes(v))) continue;
        const first = g.edgeVertices[g.coastEdges[cycleStart]!]!;
        expect(
          first.some((v) => here.includes(v)),
          `cycle from ${cycleStart} closes`,
        ).toBe(true);
        const islands = new Set(
          g.coastEdges
            .slice(cycleStart, i + 1)
            .map((e) => g.islandOf[g.edgeHexes[e]!.find(isLand)!]),
        );
        expect(islands.size).toBe(1);
        cycleIslands.push([...islands][0]!);
        cycleStart = i + 1;
      }
      expect([...cycleIslands].sort()).toEqual(expected[id].islands.map((_, i) => i));
    });
  }

  it('memoizes by sea pattern: the same coordinates without sea are another graph', () => {
    const layout = SCENARIOS.newShores;
    const withSea = buildGraph(hexesOf(layout));
    const allLand = buildGraph(layout.hexes);
    expect(withSea).not.toBe(allLand);
    expect(allLand.landHexes).toHaveLength(layout.hexes.length);
    expect(withSea.landHexes).toHaveLength(layout.hexes.length - seaOf(layout).size);
    expect(buildGraph(hexesOf(layout))).toBe(withSea);
  });
});
