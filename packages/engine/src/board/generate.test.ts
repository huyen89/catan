import { describe, expect, it } from 'vitest';
import { createGame, normalizeConfig } from '../game';
import { HEX_DIRECTIONS, hexNeighbors, hexToPixel } from '../hex/coords';
import { buildGraph } from '../hex/topology';
import { seedRng } from '../rng';
import type { Board, GameConfig, HexId, NumberMode, PortMode, VariantId } from '../types';
import { expandPool, generateBoard } from './generate';
import { BASE_LAYOUT, EXT56_LAYOUT, type LayoutDef } from './layouts';
import { SPIRAL_SEQUENCE } from './spiral';

const LAYOUTS: LayoutDef[] = [BASE_LAYOUT, EXT56_LAYOUT];
const MODES: Array<Pick<GameConfig, 'numberMode' | 'portMode'>> = (
  ['random', 'spiral'] as NumberMode[]
).flatMap((numberMode) =>
  (['fixed', 'random'] as PortMode[]).map((portMode) => ({ numberMode, portMode })),
);
const isRed = (n: number | null): boolean => n === 6 || n === 8;
const sortNum = (xs: ReadonlyArray<number | null>): Array<number | null> =>
  [...xs].sort((a, b) => (a ?? 0) - (b ?? 0));

function gen(
  layout: LayoutDef,
  seed: string,
  mode: Pick<GameConfig, 'numberMode' | 'portMode'> = { numberMode: 'random', portMode: 'fixed' },
): Board {
  return generateBoard(layout, mode, seedRng(seed));
}

/** Pairs of land hexes that touch, each pair once. */
function adjacentPairs(board: Board): Array<[Board['hexes'][number], Board['hexes'][number]]> {
  const byId = new Map(board.hexes.map((h) => [h.id, h]));
  const out: Array<[Board['hexes'][number], Board['hexes'][number]]> = [];
  for (const h of board.hexes)
    for (const n of hexNeighbors(h.q, h.r)) {
      const o = byId.get(n);
      if (o && h.id < o.id) out.push([h, o]);
    }
  return out;
}

/** Cyclic distance between two coastline indices. */
function coastGap(a: number, b: number, len: number): number {
  const d = Math.abs(a - b) % len;
  return Math.min(d, len - d);
}

/** Port pairs that share a vertex or sit closer than `minGap` along the coastline. */
function portSpacingViolations(board: Board, layout: LayoutDef, minGap: number): string[] {
  const g = buildGraph(layout.hexes);
  const idx = board.ports.map((p) => g.coastEdges.indexOf(p.edge));
  const out: string[] = [];
  for (let i = 0; i < idx.length; i++)
    for (let j = i + 1; j < idx.length; j++) {
      const [a, b] = [board.ports[i]!, board.ports[j]!];
      if (coastGap(idx[i]!, idx[j]!, g.coastEdges.length) < minGap)
        out.push(`${a.edge}~${b.edge} too close`);
      if (a.vertices.some((v) => b.vertices.includes(v))) out.push(`${a.edge}~${b.edge} share`);
    }
  return out;
}

describe('generateBoard', () => {
  for (const layout of LAYOUTS)
    for (const mode of MODES)
      it(`${layout.id} ${mode.numberMode}/${mode.portMode}: component counts match the layout`, () => {
        const g = buildGraph(layout.hexes);
        for (let s = 0; s < 50; s++) {
          const board = gen(layout, `counts-${s}`, mode);
          expect(board.layoutId).toBe(layout.id);
          expect(board.hexes.map((h) => h.id).sort()).toEqual([...g.hexIds].sort());
          expect(board.hexes.map((h) => h.terrain).sort()).toEqual(
            expandPool(layout.terrainPool).sort(),
          );
          for (const h of board.hexes) {
            if (h.terrain === 'desert') expect(h.token).toBeNull();
            else expect(h.token).not.toBeNull();
          }
          expect(sortNum(board.hexes.filter((h) => h.token !== null).map((h) => h.token))).toEqual(
            sortNum(layout.tokenPool),
          );

          expect(board.ports.map((p) => p.type).sort()).toEqual(expandPool(layout.portPool).sort());
          expect(new Set(board.ports.map((p) => p.edge)).size).toBe(board.ports.length);
          for (const p of board.ports) {
            expect(g.coastEdges).toContain(p.edge);
            expect(p.vertices).toEqual(g.edgeVertices[p.edge]);
            // A copy, so mutating a board can never corrupt the memoized graph.
            expect(p.vertices).not.toBe(g.edgeVertices[p.edge]);
          }
        }
      });

  for (const layout of LAYOUTS) {
    it(`${layout.id}: fixed mode uses the layout's port slots, none sharing a vertex`, () => {
      const g = buildGraph(layout.hexes);
      const board = gen(layout, 'fixed-ports');
      expect(board.ports.map((p) => p.edge)).toEqual(layout.portSlots.map((s) => g.coastEdges[s]));
      expect(portSpacingViolations(board, layout, 2)).toEqual([]);
    });

    it(`${layout.id}: deserts land in varying places`, () => {
      const deserts = new Set<HexId>();
      for (let s = 0; s < 300; s++)
        for (const h of gen(layout, `desert-${s}`).hexes)
          if (h.terrain === 'desert') deserts.add(h.id);
      expect(deserts.size).toBe(layout.hexes.length);
    });
  }

  it('is deterministic: same RNG state in => same board and same RNG state out', () => {
    for (const layout of LAYOUTS)
      for (const mode of MODES) {
        const a = seedRng('det');
        const b = seedRng('det');
        expect(generateBoard(layout, mode, a)).toEqual(generateBoard(layout, mode, b));
        expect(a).toEqual(b);
      }
    expect(gen(BASE_LAYOUT, 'one')).not.toEqual(gen(BASE_LAYOUT, 'two'));
  });
});

describe('generateBoard property: number tokens', () => {
  for (const layout of LAYOUTS)
    it(`${layout.id}: no adjacent 6/8 nor adjacent equal numbers over 10,000 seeds`, () => {
      let equalNeighbors = 0;
      for (let s = 0; s < 10_000; s++) {
        const board = gen(layout, `prop-${s}`);
        for (const [a, b] of adjacentPairs(board)) {
          if (isRed(a.token) && isRed(b.token)) {
            throw new Error(`seed prop-${s}: 6/8 on adjacent ${a.id} and ${b.id}`);
          }
          if (a.token !== null && a.token === b.token) equalNeighbors++;
        }
      }
      // The strict search always succeeds on the standard layouts; the 6/8-only relaxation is a
      // termination guarantee that these seeds never need.
      expect(equalNeighbors).toBe(0);
    });
});

describe('generateBoard: spiral numbers', () => {
  /**
   * Independent spiral walk (by polar angle, not by stepping along directions): outer ring then
   * inner ring, each ordered by angle from the start corner in the given sense, then the centre.
   */
  function angleSpiral(board: Board, corner: number, sense: 1 | -1): HexId[] {
    const angle = (q: number, r: number): number => {
      const { x, y } = hexToPixel(q, r, 1);
      return Math.atan2(y, x);
    };
    const [cq, cr] = HEX_DIRECTIONS[corner]!;
    const a0 = angle(cq, cr);
    const turn = (q: number, r: number): number => {
      const d = (((sense * (angle(q, r) - a0)) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      return d > 2 * Math.PI - 1e-9 ? 0 : d;
    };
    const ring = (h: { q: number; r: number }): number =>
      (Math.abs(h.q) + Math.abs(h.r) + Math.abs(h.q + h.r)) / 2;
    return [...board.hexes]
      .sort((a, b) => ring(b) - ring(a) || turn(a.q, a.r) - turn(b.q, b.r))
      .map((h) => h.id);
  }

  function matchingWalks(board: Board): string[] {
    const byId = new Map(board.hexes.map((h) => [h.id, h]));
    const out: string[] = [];
    for (let corner = 0; corner < 6; corner++)
      for (const sense of [1, -1] as const) {
        const tokens = angleSpiral(board, corner, sense)
          .map((id) => byId.get(id)!)
          .filter((h) => h.terrain !== 'desert')
          .map((h) => h.token);
        if (tokens.join(',') === SPIRAL_SEQUENCE.join(',')) out.push(`${corner}${sense}`);
      }
    return out;
  }

  it('base19: tokens follow A..R along a spiral from a random corner and direction, skipping the desert', () => {
    const seen = new Set<string>();
    for (let s = 0; s < 400; s++) {
      const board = gen(BASE_LAYOUT, `spiral-${s}`, { numberMode: 'spiral', portMode: 'fixed' });
      const walks = matchingWalks(board);
      expect(walks.length, `seed spiral-${s}`).toBeGreaterThan(0);
      walks.forEach((w) => seen.add(w));
    }
    // All 6 start corners x 2 directions occur.
    expect(seen.size).toBe(12);
  });

  it('ext30: spiral mode falls back to constrained random placement', () => {
    for (let s = 0; s < 200; s++) {
      const board = gen(EXT56_LAYOUT, `spiral-ext-${s}`, {
        numberMode: 'spiral',
        portMode: 'fixed',
      });
      for (const [a, b] of adjacentPairs(board))
        expect(isRed(a.token) && isRed(b.token)).toBe(false);
    }
  });
});

describe('generateBoard property: random ports', () => {
  for (const layout of LAYOUTS)
    it(`${layout.id}: ports never share a vertex and keep a free coastal edge between them`, () => {
      const g = buildGraph(layout.hexes);
      const used = new Set<string>();
      const violations: string[] = [];
      for (let s = 0; s < 2000; s++) {
        const board = gen(layout, `ports-${s}`, { numberMode: 'random', portMode: 'random' });
        if (board.ports.length !== layout.portSlots.length) violations.push(`ports-${s}: count`);
        for (const v of portSpacingViolations(board, layout, 2))
          violations.push(`ports-${s}: ${v}`);
        board.ports.forEach((p) => used.add(p.edge));
      }
      expect(violations).toEqual([]);
      // Every coastal edge can host a port.
      expect(used.size).toBe(g.coastEdges.length);
    });
});

describe('createGame with the generated boards', () => {
  const cases: Array<[VariantId, number]> = [
    ['base', 3],
    ['base', 4],
    ['ext56', 3],
    ['ext56', 4],
    ['ext56', 5],
    ['ext56', 6],
  ];
  for (const [variant, players] of cases)
    for (const mode of MODES)
      it(`${variant} with ${players} players, ${mode.numberMode}/${mode.portMode}`, () => {
        const state = createGame(normalizeConfig({ players, variant, ...mode }), `game-${players}`);
        expect(state.players).toHaveLength(players);
        expect(state.board.layoutId).toBe(variant === 'base' ? 'base19' : 'ext30');
        const robberHex = state.board.hexes.find((h) => h.id === state.robber);
        expect(robberHex?.terrain).toBe('desert');
        expect(
          createGame(normalizeConfig({ players, variant, ...mode }), `game-${players}`),
        ).toEqual(state);
      });
});
