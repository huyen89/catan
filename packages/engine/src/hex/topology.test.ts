import { describe, expect, it } from 'vitest';
import { BASE_LAYOUT, EXT56_LAYOUT } from '../board/layouts';
import { buildGraph } from './topology';

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
});
