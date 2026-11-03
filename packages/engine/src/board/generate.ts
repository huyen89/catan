import type { Board, EdgeId, GameConfig, Hex, HexId, Port, PortType, Terrain } from '../types';
import { hexId, hexNeighbors } from '../hex/coords';
import { buildGraph, type BoardGraph } from '../hex/topology';
import { nextInt, shuffle, type RngState } from '../rng';
import type { LayoutDef } from './layouts';
import { placeRandomTokens } from './numbers';
import { RANDOM_PORT_GAP, randomPortPositions } from './ports';
import { SPIRAL_SEQUENCE, hexagonRadius, spiralWalk } from './spiral';

/** Expand a {item: count} pool into a flat array in a stable order. */
export function expandPool<T extends string>(pool: Readonly<Partial<Record<T, number>>>): T[] {
  const out: T[] = [];
  for (const k of Object.keys(pool).sort() as T[])
    for (let i = 0; i < (pool[k] ?? 0); i++) out.push(k);
  return out;
}

/** Terrains that never carry a number token. */
const tokenless = (t: Terrain): boolean => t === 'desert' || t === 'sea';

/**
 * Generate a random board, mutating `rng` (same input state => same board).
 *
 * - Fixed hexes (`layout.fixedHexes`: the sea, deserts and gold of Open Seas scenarios) keep their
 *   terrain and token. Every other hex draws from the pools.
 * - Terrain: the layout's pool shuffled over the pool hexes (deserts and pool gold may land anywhere).
 * - Numbers: 'random' places the token pool on the producing pool hexes (gold included) with no
 *   adjacent 6/8, counting fixed tokens as neighbours, and, whenever achievable within a fixed
 *   search budget, no adjacent identical numbers and no 6/8 on gold. 'spiral' lays the official
 *   A..R sequence along a spiral from a random outer corner in a random direction, skipping
 *   deserts; layouts it does not fit (anything but the 19-hex all-land hexagon with the standard
 *   tokens) fall back to 'random'.
 * - Ports (always on coastal edges, never two sharing a vertex): 'fixed' shuffles the port types
 *   onto `layout.portSlots`; 'random' spreads them over the home islands' coastlines in
 *   proportion to their length, uniformly on each coastline with at least one free coastal edge
 *   between ports, and uses the other islands only when the home coasts are full.
 * - Home islands: those containing a `layout.homeHexes` hex; every island when it names none.
 */
export function generateBoard(
  layout: LayoutDef,
  config: Pick<GameConfig, 'numberMode' | 'portMode'>,
  rng: RngState,
): Board {
  const fixed = new Map((layout.fixedHexes ?? []).map((f) => [hexId(f.q, f.r), f]));
  for (const [id, f] of fixed) {
    if (tokenless(f.terrain) !== (f.token === undefined)) {
      throw new Error(`Layout ${layout.id}: fixed hex ${id} (${f.terrain}) token mismatch`);
    }
  }
  const terrains = shuffle(rng, expandPool<Terrain>(layout.terrainPool));
  if (terrains.length !== layout.hexes.length - fixed.size) {
    throw new Error(
      `Layout ${layout.id}: ${terrains.length} terrains for ${layout.hexes.length - fixed.size} hexes`,
    );
  }
  let next = 0;
  const hexes: Hex[] = layout.hexes.map(({ q, r }) => {
    const id = hexId(q, r);
    const f = fixed.get(id);
    return f
      ? { id, q, r, terrain: f.terrain, token: f.token ?? null }
      : { id, q, r, terrain: terrains[next++]!, token: null };
  });
  const pool = hexes.filter((h) => !fixed.has(h.id));
  const landCount = pool.filter((h) => !tokenless(h.terrain)).length;
  if (layout.tokenPool.length !== landCount) {
    throw new Error(
      `Layout ${layout.id}: ${layout.tokenPool.length} tokens for ${landCount} producing hexes`,
    );
  }

  if (config.numberMode !== 'spiral' || fixed.size > 0 || !placeSpiralTokens(hexes, layout, rng)) {
    placeTokens(hexes, pool, layout, rng);
  }

  // The generated hexes carry terrain, so on sea-framed boards this is the land/sea graph.
  const g = buildGraph(hexes);
  const homeIslands = findHomeIslands(layout, g);
  return {
    layoutId: layout.id,
    hexes,
    ports: placePorts(layout, g, new Set(homeIslands), config.portMode, rng),
    homeIslands,
    islandBonusVP: layout.islandBonusVP ?? 0,
  };
}

function findHomeIslands(layout: LayoutDef, g: BoardGraph): number[] {
  if (!layout.homeHexes?.length)
    return [...new Set(Object.values(g.islandOf))].sort((a, b) => a - b);
  const home = layout.homeHexes.map((h) => {
    const island = g.islandOf[h];
    if (island === undefined) throw new Error(`Layout ${layout.id}: home hex ${h} is not land`);
    return island;
  });
  return [...new Set(home)].sort((a, b) => a - b);
}

/**
 * 'random' number mode: constrained placement over the producing pool hexes. Tokens of fixed
 * hexes next to a pool hex count as its neighbours; pool gold avoids 6/8 when it can.
 */
function placeTokens(all: Hex[], pool: Hex[], layout: LayoutDef, rng: RngState): void {
  const byId = new Map(all.map((h) => [h.id, h]));
  const land = pool.filter((h) => !tokenless(h.terrain));
  const slotOf = new Map<HexId, number>(land.map((h, i) => [h.id, i]));
  const neighbors: number[][] = [];
  const fixedNeighbors: number[][] = [];
  for (const h of land) {
    const ids = hexNeighbors(h.q, h.r);
    neighbors.push(ids.map((id) => slotOf.get(id)).filter((i): i is number => i !== undefined));
    fixedNeighbors.push(
      ids
        .filter((id) => !slotOf.has(id))
        .map((id) => byId.get(id)?.token)
        .filter((t): t is number => t !== undefined && t !== null),
    );
  }
  const avoidRed = land.map((h) => h.terrain === 'gold');
  const tokens = placeRandomTokens(neighbors, layout.tokenPool, rng, { fixedNeighbors, avoidRed });
  land.forEach((h, i) => (h.token = tokens[i]!));
}

/** 'spiral' number mode. Returns false (rng untouched) when the layout does not support it. */
function placeSpiralTokens(hexes: Hex[], layout: LayoutDef, rng: RngState): boolean {
  const radius = hexagonRadius(layout.hexes);
  const sorted = (xs: readonly number[]): string => [...xs].sort((a, b) => a - b).join(',');
  if (radius === null || sorted(layout.tokenPool) !== sorted(SPIRAL_SEQUENCE)) return false;

  const corner = nextInt(rng, 0, 5);
  const clockwise = nextInt(rng, 0, 1) === 1;
  const byId = new Map(hexes.map((h) => [h.id, h]));
  let next = 0;
  for (const id of spiralWalk(radius, corner, clockwise)) {
    const hex = byId.get(id)!;
    if (!tokenless(hex.terrain)) hex.token = SPIRAL_SEQUENCE[next++]!;
  }
  return true;
}

/** One closed coastline: `coastEdges[start .. start + length)`, consecutive edges share a vertex. */
export interface Coastline {
  start: number;
  length: number;
  island: number;
}

const shareVertex = (g: BoardGraph, a: EdgeId, b: EdgeId): boolean =>
  g.edgeVertices[a]!.some((v) => g.edgeVertices[b]!.includes(v));

/**
 * Split the coastline walk into its closed cycles by graph adjacency: a cycle ends where the next
 * walk edge shares no vertex with the current one. Distinct cycles never share a vertex (every
 * vertex touches 0 or 2 coastal edges), so ports on different cycles can never touch.
 */
export function coastlines(g: BoardGraph): Coastline[] {
  const c = g.coastEdges;
  const out: Coastline[] = [];
  let start = 0;
  for (let i = 0; i < c.length; i++) {
    if (i + 1 < c.length && shareVertex(g, c[i]!, c[i + 1]!)) continue;
    if (!shareVertex(g, c[i]!, c[start]!) && i > start) {
      throw new Error(`coastlines: walk from ${c[start]} does not close`);
    }
    const land = g.edgeHexes[c[start]!]!.find((h) => Object.hasOwn(g.islandOf, h))!;
    out.push({ start, length: i + 1 - start, island: g.islandOf[land]! });
    start = i + 1;
  }
  return out;
}

/** Most ports a coastline of `length` edges holds with the random-mode gap. */
const capacity = (length: number): number => Math.floor(length / RANDOM_PORT_GAP);

/**
 * Split `count` ports over coastlines in proportion to their length (largest remainder, ties to
 * the earlier coastline), never above a coastline's capacity. Deterministic: no RNG.
 */
function apportion(
  lines: readonly Coastline[],
  count: number,
  quota: Map<Coastline, number>,
): number {
  const total = lines.reduce((s, l) => s + l.length, 0);
  if (total === 0) return count;
  const ideal = (l: Coastline): number => (count * l.length) / total;
  let left = count;
  for (const l of lines) {
    const q = Math.min(capacity(l.length), Math.floor(ideal(l)));
    quota.set(l, q);
    left -= q;
  }
  while (left > 0) {
    let best: Coastline | undefined;
    for (const l of lines) {
      if (quota.get(l)! >= capacity(l.length)) continue;
      if (!best || ideal(l) - quota.get(l)! > ideal(best) - quota.get(best)!) best = l;
    }
    if (!best) break;
    quota.set(best, quota.get(best)! + 1);
    left--;
  }
  return left;
}

/**
 * 'random' port mode: indices into `g.coastEdges`. Ports go on the home coastlines (proportional
 * to length), overflowing to the other coastlines only when the home ones are full; on each
 * coastline the positions are uniform among those keeping `RANDOM_PORT_GAP`. A board with a
 * single coastline (base, ext56) makes exactly one `randomPortPositions` draw, as it always did.
 */
function randomPortSlots(
  g: BoardGraph,
  home: ReadonlySet<number>,
  count: number,
  rng: RngState,
): number[] {
  const lines = coastlines(g);
  const quota = new Map<Coastline, number>();
  const left = apportion(
    lines.filter((l) => !home.has(l.island)),
    apportion(
      lines.filter((l) => home.has(l.island)),
      count,
      quota,
    ),
    quota,
  );
  if (left > 0) throw new Error(`randomPorts: ${count} ports do not fit on the coast`);
  const out: number[] = [];
  for (const l of lines) {
    const q = quota.get(l) ?? 0;
    if (q > 0) for (const p of randomPortPositions(l.length, q, rng)) out.push(l.start + p);
  }
  return out;
}

function placePorts(
  layout: LayoutDef,
  g: BoardGraph,
  home: ReadonlySet<number>,
  mode: GameConfig['portMode'],
  rng: RngState,
): Port[] {
  const types = shuffle(rng, expandPool<PortType>(layout.portPool));
  const slots =
    mode === 'random'
      ? randomPortSlots(g, home, types.length, rng)
      : layout.portSlots.map((s) => s % g.coastEdges.length);
  if (slots.length !== types.length) {
    throw new Error(`Layout ${layout.id}: ${types.length} port types for ${slots.length} slots`);
  }
  const edges = slots.map((s) => g.coastEdges[s]!);
  edges.forEach((a, i) =>
    edges.slice(i + 1).forEach((b) => {
      if (a === b || shareVertex(g, a, b)) {
        throw new Error(`Layout ${layout.id}: ports on ${a} and ${b} touch`);
      }
    }),
  );
  return edges.map((edge, i) => {
    const [a, b] = g.edgeVertices[edge]!;
    return { type: types[i]!, edge, vertices: [a, b] };
  });
}
