import type { Board, EdgeId, GameConfig, Hex, HexId, Port, PortType, Terrain } from '../types';
import { hexId, hexNeighbors } from '../hex/coords';
import { buildGraph, type BoardGraph } from '../hex/topology';
import { nextInt, shuffle, type RngState } from '../rng';
import type { FixedHex, LayoutDef } from './layouts';
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

/** Pool hexes that share one terrain pool and one token pool. */
interface PoolGroup {
  /** Hexes in layout order. */
  hexes: HexId[];
  terrainPool: LayoutDef['terrainPool'];
  tokenPool: readonly number[];
}

/** A layout checked once: its fixed hexes and pool groups (the global pools first, then regions). */
interface CheckedLayout {
  fixed: Map<HexId, FixedHex>;
  groups: PoolGroup[];
}

const checked = new WeakMap<LayoutDef, CheckedLayout>();

/**
 * Validate a layout and split its pool hexes into groups. Everything checked here depends on the
 * layout alone (pools never contain sea, so which hexes are land is known before any shuffle), so
 * it runs once per layout object, not once per seed.
 */
function checkLayout(layout: LayoutDef): CheckedLayout {
  const hit = checked.get(layout);
  if (hit) return hit;
  const fail = (msg: string): never => {
    throw new Error(`Layout ${layout.id}: ${msg}`);
  };
  const fixed = new Map<HexId, FixedHex>();
  for (const f of layout.fixedHexes ?? []) {
    const id = hexId(f.q, f.r);
    if (tokenless(f.terrain) !== (f.token === undefined)) {
      fail(`fixed hex ${id} (${f.terrain}) token mismatch`);
    }
    fixed.set(id, f);
  }
  const ids = new Set(layout.hexes.map((h) => hexId(h.q, h.r)));
  const regionOf = new Map<HexId, number>();
  (layout.regionPools ?? []).forEach((region, i) =>
    region.hexes.forEach((id) => {
      if (!ids.has(id) || fixed.has(id) || regionOf.has(id)) {
        fail(`region hex ${id} is off the board, fixed or in two regions`);
      }
      regionOf.set(id, i);
    }),
  );
  const poolIds = layout.hexes.map((h) => hexId(h.q, h.r)).filter((id) => !fixed.has(id));
  const groups: PoolGroup[] = [
    {
      hexes: poolIds.filter((id) => !regionOf.has(id)),
      terrainPool: layout.terrainPool,
      tokenPool: layout.tokenPool,
    },
    ...(layout.regionPools ?? []).map((region, i) => ({
      hexes: poolIds.filter((id) => regionOf.get(id) === i),
      terrainPool: region.terrainPool,
      tokenPool: region.tokenPool,
    })),
  ];
  for (const group of groups) {
    const terrains = expandPool<Terrain>(group.terrainPool);
    if (terrains.includes('sea')) fail('sea hexes must be fixed, not drawn from a pool');
    if (terrains.length !== group.hexes.length) {
      fail(`${terrains.length} terrains for ${group.hexes.length} hexes`);
    }
    const producing = terrains.filter((t) => !tokenless(t)).length;
    if (group.tokenPool.length !== producing) {
      fail(`${group.tokenPool.length} tokens for ${producing} producing hexes`);
    }
  }
  for (const h of layout.homeHexes ?? []) {
    if (!ids.has(h) || fixed.get(h)?.terrain === 'sea') fail(`home hex ${h} is not land`);
  }
  const out = { fixed, groups };
  checked.set(layout, out);
  return out;
}

/**
 * Generate a random board, mutating `rng` (same input state => same board).
 *
 * - Fixed hexes (`layout.fixedHexes`: the sea, deserts and gold of Open Seas scenarios) keep their
 *   terrain and token. Every other hex draws from the pools: a `layout.regionPools` region from
 *   its own pools, the rest from `terrainPool`/`tokenPool`.
 * - Terrain: each pool shuffled over its hexes (deserts and pool gold may land anywhere in it).
 * - Numbers: 'random' places each token pool on its producing hexes (gold included), the global
 *   pool first, then the regions in order. Fixed tokens and tokens placed earlier count as
 *   neighbours. Rules: no adjacent 6/8 and, whenever achievable within a fixed search budget, no
 *   adjacent identical numbers and no 6/8 on gold (see `placeRandomTokens` for the fallbacks).
 *   'spiral' lays the official A..R sequence along a spiral from a random outer corner in a random
 *   direction, skipping deserts; layouts it does not fit (anything but the 19-hex all-land hexagon
 *   with the standard tokens and no fixed hexes or regions) fall back to 'random'.
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
  const { fixed, groups } = checkLayout(layout);
  const terrainOf = new Map<HexId, Terrain>();
  for (const group of groups) {
    const terrains = shuffle(rng, expandPool<Terrain>(group.terrainPool));
    group.hexes.forEach((id, i) => terrainOf.set(id, terrains[i]!));
  }
  const hexes: Hex[] = layout.hexes.map(({ q, r }) => {
    const id = hexId(q, r);
    const f = fixed.get(id);
    return f
      ? { id, q, r, terrain: f.terrain, token: f.token ?? null }
      : { id, q, r, terrain: terrainOf.get(id)!, token: null };
  });

  const spiral =
    config.numberMode === 'spiral' &&
    fixed.size === 0 &&
    groups.length === 1 &&
    placeSpiralTokens(hexes, layout, rng);
  if (!spiral) {
    const byId = new Map(hexes.map((h) => [h.id, h]));
    // Tokens already on the board: the fixed ones, then each group's as it is placed.
    const known = new Map<HexId, number>();
    for (const [id, f] of fixed) if (f.token !== undefined) known.set(id, f.token);
    for (const group of groups) {
      placeTokens(
        group.hexes.map((id) => byId.get(id)!),
        group.tokenPool,
        known,
        rng,
      );
    }
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

/** Home islands, sorted. `checkLayout` guarantees every home hex is land. */
function findHomeIslands(layout: LayoutDef, g: BoardGraph): number[] {
  const islands = layout.homeHexes?.length
    ? layout.homeHexes.map((h) => g.islandOf[h]!)
    : Object.values(g.islandOf);
  return [...new Set(islands)].sort((a, b) => a - b);
}

/**
 * 'random' number mode for one pool group: constrained placement over its producing hexes.
 * Tokens in `known` (fixed hexes, earlier groups) next to a slot count as its neighbours; gold
 * avoids 6/8 when it can. Adds the placed tokens to `known`.
 */
function placeTokens(
  group: Hex[],
  tokenPool: readonly number[],
  known: Map<HexId, number>,
  rng: RngState,
): void {
  const land = group.filter((h) => !tokenless(h.terrain));
  const slotOf = new Map<HexId, number>(land.map((h, i) => [h.id, i]));
  const neighbors: number[][] = [];
  const fixedNeighbors: number[][] = [];
  for (const h of land) {
    const ids = hexNeighbors(h.q, h.r);
    neighbors.push(ids.map((id) => slotOf.get(id)).filter((i): i is number => i !== undefined));
    fixedNeighbors.push(ids.map((id) => known.get(id)).filter((t): t is number => t !== undefined));
  }
  const avoidRed = land.map((h) => h.terrain === 'gold');
  const tokens = placeRandomTokens(neighbors, tokenPool, rng, { fixedNeighbors, avoidRed });
  land.forEach((h, i) => {
    h.token = tokens[i]!;
    known.set(h.id, h.token);
  });
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
 * Split `count` ports over coastlines in proportion to their length (largest remainder), never
 * above a coastline's capacity. Equal remainders go to the coastline listed first, so the caller
 * passes `lines` in a seeded random order. Returns the ports that did not fit.
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
  // Seeded tie-break order; a single coastline draws nothing, so base/ext56 output is unchanged.
  const order = lines.length > 1 ? shuffle(rng, lines) : lines;
  const quota = new Map<Coastline, number>();
  const overflow = apportion(
    order.filter((l) => home.has(l.island)),
    count,
    quota,
  );
  const left = apportion(
    order.filter((l) => !home.has(l.island)),
    overflow,
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
  // shareVertex also catches a slot listed twice (an edge shares both its vertices with itself).
  edges.forEach((a, i) =>
    edges.slice(i + 1).forEach((b) => {
      if (shareVertex(g, a, b)) {
        throw new Error(`Layout ${layout.id}: ports on ${a} and ${b} touch`);
      }
    }),
  );
  return edges.map((edge, i) => {
    const [a, b] = g.edgeVertices[edge]!;
    return { type: types[i]!, edge, vertices: [a, b] };
  });
}
