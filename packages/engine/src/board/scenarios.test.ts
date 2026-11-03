import { describe, expect, it } from 'vitest';
import { createGame, normalizeConfig } from '../game';
import { hexId, hexNeighbors } from '../hex/coords';
import { buildGraph, graphFor, type BoardGraph } from '../hex/topology';
import { seedRng } from '../rng';
import type { Board, GameConfig, GameState, NumberMode, PortMode } from '../types';
import { coastlines, expandPool, generateBoard } from './generate';
import { BASE_LAYOUT, SCENARIOS, SCENARIO_IDS, type LayoutDef } from './layouts';

const MODES: Array<Pick<GameConfig, 'numberMode' | 'portMode'>> = (
  ['random', 'spiral'] as NumberMode[]
).flatMap((numberMode) =>
  (['fixed', 'random'] as PortMode[]).map((portMode) => ({ numberMode, portMode })),
);
const isRed = (n: number | null): boolean => n === 6 || n === 8;
const sortStr = (xs: readonly string[]): string[] => [...xs].sort();
const sortNum = (xs: readonly number[]): number[] => [...xs].sort((a, b) => a - b);

/** Island of the land hex an edge touches (coastal edges touch exactly one). */
const islandOfEdge = (g: BoardGraph, edge: string): number =>
  g.islandOf[g.edgeHexes[edge]!.find((h) => Object.hasOwn(g.islandOf, h))!]!;

/** Every invariant a generated scenario game must satisfy; returns the violations. */
function violations(layout: LayoutDef, state: GameState, portMode: PortMode): string[] {
  const out: string[] = [];
  const board = state.board;
  const g = graphFor(board);
  const fixed = new Map((layout.fixedHexes ?? []).map((f) => [hexId(f.q, f.r), f]));
  const byId = new Map(board.hexes.map((h) => [h.id, h]));

  // Hexes, terrain and tokens.
  if (board.layoutId !== layout.id) out.push(`layoutId ${board.layoutId}`);
  const ids = layout.hexes.map((h) => hexId(h.q, h.r));
  if (sortStr(board.hexes.map((h) => h.id)).join() !== sortStr(ids).join()) out.push('hex set');
  const pool = board.hexes.filter((h) => !fixed.has(h.id));
  if (sortStr(pool.map((h) => h.terrain)).join() !== sortStr(expandPool(layout.terrainPool)).join())
    out.push('pool terrains');
  const poolTokens = pool.flatMap((h) => (h.token === null ? [] : [h.token]));
  if (sortNum(poolTokens).join() !== sortNum(layout.tokenPool).join()) out.push('pool tokens');
  for (const [id, f] of fixed) {
    const h = byId.get(id)!;
    if (h.terrain !== f.terrain || h.token !== (f.token ?? null)) out.push(`fixed ${id} changed`);
  }
  for (const h of board.hexes) {
    const tokenless = h.terrain === 'sea' || h.terrain === 'desert';
    if (tokenless && h.token !== null) out.push(`${h.terrain} ${h.id} has a token`);
    if (!tokenless && h.token === null) out.push(`${h.terrain} ${h.id} lacks a token`);
    if (h.terrain === 'gold' && !fixed.has(h.id) && isRed(h.token)) out.push(`6/8 on gold ${h.id}`);
    for (const n of hexNeighbors(h.q, h.r)) {
      const o = byId.get(n);
      if (o && h.id < o.id && isRed(h.token) && isRed(o.token)) out.push(`6/8 ${h.id}~${o.id}`);
    }
  }

  // Robber and pirate.
  if (byId.get(state.robber)?.terrain === 'sea' || !byId.has(state.robber)) out.push('robber');
  if (layout.robberStart && state.robber !== layout.robberStart) out.push('robber start');
  if (state.pirate === null || byId.get(state.pirate)?.terrain !== 'sea') out.push('pirate');

  // Home islands.
  const home = sortNum([...new Set((layout.homeHexes ?? []).map((h) => g.islandOf[h]!))]);
  if (home.length === 0 || board.homeIslands.join() !== home.join()) out.push('homeIslands');
  if (board.islandBonusVP !== (layout.islandBonusVP ?? 0)) out.push('islandBonusVP');

  // Ports.
  if (
    sortStr(board.ports.map((p) => p.type)).join() !== sortStr(expandPool(layout.portPool)).join()
  )
    out.push('port types');
  board.ports.forEach((p, i) => {
    const hexes = g.edgeHexes[p.edge] ?? [];
    const terrains = hexes.map((h) => byId.get(h)!.terrain === 'sea');
    if (hexes.length !== 2 || terrains.filter(Boolean).length !== 1)
      out.push(`port ${p.edge} not land|sea`);
    if (p.vertices.join() !== g.edgeVertices[p.edge]?.join()) out.push(`port ${p.edge} vertices`);
    for (const q of board.ports.slice(i + 1))
      if (p.vertices.some((v) => q.vertices.includes(v)))
        out.push(`ports ${p.edge}~${q.edge} touch`);
    if (portMode === 'random' && !board.homeIslands.includes(islandOfEdge(g, p.edge)))
      out.push(`random port ${p.edge} off the home islands`);
  });
  if (portMode === 'fixed') {
    const want = layout.portSlots.map((s) => g.coastEdges[s % g.coastEdges.length]);
    if (board.ports.map((p) => p.edge).join() !== want.join()) out.push('fixed port slots');
  }
  return out;
}

describe('Open Seas scenario boards: invariants over seeds x scenarios x players x modes', () => {
  for (const id of SCENARIO_IDS) {
    const layout = SCENARIOS[id];
    for (let players = layout.minPlayers!; players <= layout.maxPlayers!; players++)
      for (const mode of MODES)
        it(`${id}, ${players} players, ${mode.numberMode}/${mode.portMode}`, () => {
          const bad: string[] = [];
          for (let s = 0; s < 150; s++) {
            const config = normalizeConfig({
              players,
              variant: 'seafarers',
              scenario: id,
              ...mode,
            });
            const state = createGame(config, `inv-${id}-${s}`);
            for (const v of violations(layout, state, mode.portMode)) bad.push(`seed ${s}: ${v}`);
            if (s < 5) expect(createGame(config, `inv-${id}-${s}`)).toEqual(state);
          }
          expect(bad).toEqual([]);
        });
  }
});

describe('Open Seas number tokens', () => {
  for (const id of SCENARIO_IDS)
    it(`${id}: no equal neighbours, fixed tokens counted, over 2,000 seeds`, () => {
      const layout = SCENARIOS[id];
      let equal = 0;
      for (let s = 0; s < 2000; s++) {
        const board = generateBoard(
          layout,
          { numberMode: 'random', portMode: 'random' },
          seedRng(`n${s}`),
        );
        const byId = new Map(board.hexes.map((h) => [h.id, h]));
        for (const h of board.hexes)
          for (const n of hexNeighbors(h.q, h.r)) {
            const o = byId.get(n);
            if (o && h.token !== null && o.token === h.token) equal++;
            if (o && isRed(h.token) && isRed(o.token))
              throw new Error(`seed n${s}: 6/8 ${h.id}~${o.id}`);
          }
      }
      expect(equal).toBe(0);
    });

  it('pool gold gets varied, never red tokens; fixed gold keeps its token', () => {
    for (const id of ['newShores', 'grandVoyage'] as const) {
      const layout = SCENARIOS[id];
      const fixedGold = new Set(
        (layout.fixedHexes ?? []).filter((f) => f.terrain === 'gold').map((f) => hexId(f.q, f.r)),
      );
      const seen = new Set<number>();
      for (let s = 0; s < 300; s++)
        for (const h of generateBoard(
          layout,
          { numberMode: 'random', portMode: 'fixed' },
          seedRng(`g${s}`),
        ).hexes)
          if (h.terrain === 'gold' && !fixedGold.has(h.id)) {
            expect(isRed(h.token)).toBe(false);
            seen.add(h.token!);
          }
      expect(seen.size).toBeGreaterThan(4);
    }
  });

  it('a pool hex next to a fixed 6 never gets a 6/8', () => {
    // Base board with the centre hex fixed as gold 6: its six neighbours must avoid red tokens.
    const layout: LayoutDef = {
      ...BASE_LAYOUT,
      id: 'centreGold',
      fixedHexes: [{ q: 0, r: 0, terrain: 'gold', token: 6 }],
      terrainPool: { ...BASE_LAYOUT.terrainPool, mountains: 2 },
      tokenPool: [2, 3, 3, 4, 4, 5, 5, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12],
    };
    const ring = new Set(hexNeighbors(0, 0));
    for (let s = 0; s < 500; s++) {
      const board = generateBoard(
        layout,
        { numberMode: 'random', portMode: 'fixed' },
        seedRng(`c${s}`),
      );
      for (const h of board.hexes) if (ring.has(h.id)) expect(isRed(h.token)).toBe(false);
    }
  });
});

describe('Open Seas ports', () => {
  it('random ports spread over every home island, uniformly enough on each coastline', () => {
    const layout = SCENARIOS.archipelago;
    const hits = new Map<string, number>();
    const perIsland = new Map<number, number>();
    for (let s = 0; s < 2000; s++) {
      const board = generateBoard(
        layout,
        { numberMode: 'random', portMode: 'random' },
        seedRng(`r${s}`),
      );
      const g = graphFor(board);
      for (const p of board.ports) {
        hits.set(p.edge, (hits.get(p.edge) ?? 0) + 1);
        const island = islandOfEdge(g, p.edge);
        perIsland.set(island, (perIsland.get(island) ?? 0) + 1);
      }
    }
    // Sea, gold and home hexes are fixed, so every seed has the same land/sea graph.
    const board0 = generateBoard(
      layout,
      { numberMode: 'random', portMode: 'random' },
      seedRng('r0'),
    );
    const g = graphFor(board0);
    // 8 ports over 4 equal home islands: 2 each, every seed.
    expect([...perIsland.values()]).toEqual([4000, 4000, 4000, 4000]);
    // Every home coastal edge is used, with roughly the uniform frequency (2 per 16 edges).
    const homeEdges = g.coastEdges.filter((e) => board0.homeIslands.includes(islandOfEdge(g, e)));
    expect(hits.size).toBe(homeEdges.length);
    const mean = (2000 * 2) / 16;
    for (const e of homeEdges) expect(Math.abs(hits.get(e)! - mean)).toBeLessThan(mean * 0.25);
  });

  it('coastlines split the walk into closed cycles, one per island coast', () => {
    for (const id of SCENARIO_IDS) {
      const board = generateBoard(
        SCENARIOS[id],
        { numberMode: 'random', portMode: 'fixed' },
        seedRng('c'),
      );
      const g = graphFor(board);
      const lines = coastlines(g);
      expect(lines.reduce((s, l) => s + l.length, 0)).toBe(g.coastEdges.length);
      expect(new Set(lines.map((l) => l.island)).size).toBe(lines.length);
      expect(lines.length).toBe(new Set(Object.values(g.islandOf)).size);
      for (const l of lines)
        for (let i = 0; i < l.length; i++) {
          const a = g.coastEdges[l.start + i]!;
          const b = g.coastEdges[l.start + ((i + 1) % l.length)]!;
          expect(g.edgeVertices[a]!.some((v) => g.edgeVertices[b]!.includes(v))).toBe(true);
          expect(islandOfEdge(g, a)).toBe(l.island);
        }
    }
    expect(coastlines(buildGraph(BASE_LAYOUT.hexes))).toEqual([
      { start: 0, length: 30, island: 0 },
    ]);
  });

  it('overflows to other islands only when the home coasts are full, and rejects touching fixed slots', () => {
    // The archipelago's 4 home coasts of 16 edges hold 32 ports with the gap, the gold islet's
    // 6 edges 3 more: 34 ports put 2 on the islet, 36 do not fit.
    const layout: LayoutDef = { ...SCENARIOS.archipelago, portPool: { any: 34 }, portSlots: [] };
    const board = generateBoard(layout, { numberMode: 'random', portMode: 'random' }, seedRng('o'));
    const g = graphFor(board);
    const off = board.ports.filter((p) => !board.homeIslands.includes(islandOfEdge(g, p.edge)));
    expect(board.ports).toHaveLength(34);
    expect(off).toHaveLength(2);
    expect(() =>
      generateBoard(
        { ...layout, portPool: { any: 36 } },
        { numberMode: 'random', portMode: 'random' },
        seedRng('o'),
      ),
    ).toThrow(/do not fit/);
    expect(() =>
      generateBoard(
        { ...SCENARIOS.archipelago, portSlots: [0, 1, 4, 8, 22, 30, 38, 46] },
        { numberMode: 'random', portMode: 'fixed' },
        seedRng('o'),
      ),
    ).toThrow(/touch/);
  });
});

describe('Open Seas layout validation', () => {
  it('rejects a home hex on sea and a fixed producing hex without a token', () => {
    const layout = SCENARIOS.newShores;
    const sea = layout.fixedHexes!.find((f) => f.terrain === 'sea')!;
    const mode = { numberMode: 'random', portMode: 'fixed' } as const;
    expect(() =>
      generateBoard({ ...layout, homeHexes: [hexId(sea.q, sea.r)] }, mode, seedRng('v')),
    ).toThrow(/not land/);
    const noToken = layout.fixedHexes!.map(({ token, ...f }) =>
      f.terrain === 'gold' ? f : { ...f, ...(token !== undefined && { token }) },
    );
    expect(() => generateBoard({ ...layout, fixedHexes: noToken }, mode, seedRng('v'))).toThrow(
      /token/,
    );
  });

  it('a board without home hexes makes every island home', () => {
    const board: Board = generateBoard(
      { ...SCENARIOS.newShores, homeHexes: [] },
      { numberMode: 'random', portMode: 'fixed' },
      seedRng('h'),
    );
    expect(board.homeIslands).toEqual([0, 1, 2, 3]);
  });
});
