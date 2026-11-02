import { describe, expect, it } from 'vitest';
import { hexCorners } from '../hex/coords';
import { graphFor } from '../hex/topology';
import {
  ctxFor,
  edgeBetween,
  newGame,
  putBuilding,
  putPath,
  putRoad,
  walk,
} from '../test/fixtures';
import type { GameState, Seat, VertexId } from '../types';
import { longestTrail, updateLargestArmy, updateLongestRoad } from './awards';

const g = graphFor(newGame(4).board);
const ring = (q: number, r: number): VertexId[] => {
  const c = hexCorners(q, r);
  return [...c, c[0]!];
};
const len = (s: GameState, seat: Seat) => longestTrail(s, g, seat);
/** Recompute awards on `s` in place; returns the emitted events. */
const recompute = (s: GameState) => {
  const ctx = ctxFor(s);
  updateLongestRoad(ctx);
  return ctx.events;
};

describe('longest trail (RULES.md#awards)', () => {
  it('straight line', () => {
    const s = putPath(newGame(4), 0, walk(g, '0,0,N', 5));
    expect(len(s, 0)).toBe(5);
    expect(len(s, 1)).toBe(0);
  });

  it('fork counts only one branch', () => {
    const s = newGame(4);
    const main = walk(g, '0,0,N', 4);
    putPath(s, 0, main);
    const branch = walk(g, main[2]!, 3, new Set(main.filter((v) => v !== main[2])));
    putPath(s, 0, branch);
    expect(Object.keys(s.roads)).toHaveLength(7);
    expect(len(s, 0)).toBe(5);
  });

  it('loop', () => {
    const s = putPath(newGame(4), 0, ring(0, 0));
    expect(len(s, 0)).toBe(6);
  });

  it('figure-6: a tail into a loop uses every edge', () => {
    const s = newGame(4);
    const loop = ring(0, 0);
    putPath(s, 0, loop);
    putPath(s, 0, walk(g, loop[0]!, 3, new Set(loop.slice(1))));
    expect(len(s, 0)).toBe(9);
  });

  it('figure-8: two loops sharing an edge (theta graph) is one 11-edge trail', () => {
    const s = newGame(4);
    putPath(s, 0, ring(0, 0));
    for (const e of g.hexEdges['1,0']!) if (s.roads[e] === undefined) putRoad(s, 0, e);
    expect(Object.keys(s.roads)).toHaveLength(11);
    expect(len(s, 0)).toBe(11);
  });

  it("is broken by an opponent's building but not by an own one", () => {
    const s = newGame(4);
    const path = walk(g, '0,0,N', 6);
    putPath(s, 0, path);
    putBuilding(s, 0, path[3]!);
    expect(len(s, 0)).toBe(6);
    s.buildings[path[3]!] = { owner: 1, kind: 'settlement' };
    expect(len(s, 0)).toBe(3);
    s.buildings[path[3]!] = { owner: 1, kind: 'city' };
    expect(len(s, 0)).toBe(3);
  });

  it('a loop broken at one vertex is still a trail through the rest', () => {
    const s = newGame(4);
    const loop = ring(0, 0);
    putPath(s, 0, loop);
    putBuilding(s, 1, loop[2]!);
    expect(len(s, 0)).toBe(6);
  });
});

/** Seats 0..2 each get a disjoint path of the given length. */
function withPaths(lengths: number[]): { s: GameState; paths: VertexId[][] } {
  const s = newGame(4);
  const used = new Set<VertexId>();
  const starts = ['-2,0,N', '2,-2,S', '-1,2,S'];
  const paths = lengths.map((n, seat) => {
    const p = walk(g, starts[seat]!, n, used);
    for (const v of p) for (const nb of [v, ...g.vertexNeighbors[v]!]) used.add(nb);
    putPath(s, seat, p);
    return p;
  });
  return { s, paths };
}

describe('longest road award (RULES.md#awards)', () => {
  it('needs at least 5 roads', () => {
    const { s } = withPaths([4]);
    expect(recompute(s)).toEqual([]);
    expect(s.longestRoad).toBeNull();
    expect(s.players[0]!.longestRoadLength).toBe(4);
    putRoad(s, 0, edgeBetween(g, ...(walk(g, '-2,0,N', 5).slice(4) as [string, string])));
    expect(recompute(s)).toEqual([{ type: 'awardChanged', award: 'longestRoad', holder: 0 }]);
  });

  it('holder keeps it on a tie; a strictly longer road takes it', () => {
    const { s } = withPaths([5, 5]);
    s.longestRoad = 0;
    expect(recompute(s)).toEqual([]);
    expect(s.longestRoad).toBe(0);
    const { s: s2 } = withPaths([5, 6]);
    s2.longestRoad = 0;
    recompute(s2);
    expect(s2.longestRoad).toBe(1);
  });

  it('nobody gets it from a tie when there was no holder', () => {
    const { s } = withPaths([5, 5]);
    recompute(s);
    expect(s.longestRoad).toBeNull();
  });

  it('holder broken to a tie among others → nobody holds it', () => {
    const { s, paths } = withPaths([7, 5, 5]);
    s.longestRoad = 0;
    s.buildings[paths[0]![3]!] = { owner: 1, kind: 'settlement' };
    const events = recompute(s);
    expect(s.players[0]!.longestRoadLength).toBe(4);
    expect(s.longestRoad).toBeNull();
    expect(events).toEqual([{ type: 'awardChanged', award: 'longestRoad', holder: null }]);
  });

  it('holder broken but still tied for longest keeps it', () => {
    const { s, paths } = withPaths([7, 5]);
    s.longestRoad = 0;
    s.buildings[paths[0]![2]!] = { owner: 1, kind: 'settlement' };
    recompute(s);
    expect(s.players[0]!.longestRoadLength).toBe(5);
    expect(s.longestRoad).toBe(0);
  });

  it('holder broken below a unique longer road passes it on', () => {
    const { s, paths } = withPaths([7, 5, 6]);
    s.longestRoad = 0;
    s.buildings[paths[0]![3]!] = { owner: 1, kind: 'settlement' };
    recompute(s);
    expect(s.longestRoad).toBe(2);
  });

  it('holder broken below 5 with nobody else at 5 → nobody', () => {
    const { s, paths } = withPaths([6, 4]);
    s.longestRoad = 0;
    s.buildings[paths[0]![3]!] = { owner: 1, kind: 'settlement' };
    recompute(s);
    expect(s.longestRoad).toBeNull();
  });
});

describe('largest army (RULES.md#awards)', () => {
  it('needs 3 knights and strictly more than the holder', () => {
    const s = newGame(4);
    const ctx = ctxFor(s);
    s.players[0]!.playedKnights = 2;
    updateLargestArmy(ctx, 0);
    expect(s.largestArmy).toBeNull();
    s.players[0]!.playedKnights = 3;
    updateLargestArmy(ctx, 0);
    expect(s.largestArmy).toBe(0);
    s.players[1]!.playedKnights = 3;
    updateLargestArmy(ctx, 1);
    expect(s.largestArmy).toBe(0);
    s.players[1]!.playedKnights = 4;
    updateLargestArmy(ctx, 1);
    expect(s.largestArmy).toBe(1);
    expect(ctx.events).toEqual([
      { type: 'awardChanged', award: 'largestArmy', holder: 0 },
      { type: 'awardChanged', award: 'largestArmy', holder: 1 },
    ]);
  });
});
