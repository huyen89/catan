import type { Board, GameConfig, Hex, HexId, Port, PortType, Terrain } from '../types';
import { hexId, hexNeighbors } from '../hex/coords';
import { buildGraph } from '../hex/topology';
import { nextInt, shuffle, type RngState } from '../rng';
import type { LayoutDef } from './layouts';
import { placeRandomTokens } from './numbers';
import { randomPortPositions } from './ports';
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
 * - Terrain: the layout's pool shuffled over all hexes (deserts may land anywhere).
 * - Numbers: 'random' places tokens with no adjacent 6/8 and, whenever achievable within a fixed
 *   search budget, no adjacent identical numbers. 'spiral' lays the official A..R sequence along a
 *   spiral from a random outer corner in a random direction, skipping deserts; layouts it does not
 *   fit (anything but the 19-hex hexagon with the standard tokens) fall back to 'random'.
 * - Ports: 'fixed' shuffles the port types onto `layout.portSlots`; 'random' picks coastal edges
 *   with at least one free coastal edge between any two ports.
 * - Fixed hexes (`layout.fixedHexes`, Open Seas scenarios) keep their terrain and token and take no
 *   part in the shuffles above. [CONTRACT minimal support — GEN owns the real scenario generation.]
 */
export function generateBoard(
  layout: LayoutDef,
  config: Pick<GameConfig, 'numberMode' | 'portMode'>,
  rng: RngState,
): Board {
  const fixed = new Map((layout.fixedHexes ?? []).map((f) => [hexId(f.q, f.r), f]));
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
  // Pool hexes: everything the shuffles may touch.
  const pool = hexes.filter((h) => !fixed.has(h.id));
  const landCount = pool.filter((h) => !tokenless(h.terrain)).length;
  if (layout.tokenPool.length !== landCount) {
    throw new Error(
      `Layout ${layout.id}: ${layout.tokenPool.length} tokens for ${landCount} producing hexes`,
    );
  }

  if (config.numberMode !== 'spiral' || fixed.size > 0 || !placeSpiralTokens(hexes, layout, rng)) {
    placeTokens(pool, layout, rng);
  }

  return { layoutId: layout.id, hexes, ports: placePorts(layout, hexes, config.portMode, rng) };
}

/** 'random' number mode: constrained placement over the producing (pool) hexes. */
function placeTokens(hexes: Hex[], layout: LayoutDef, rng: RngState): void {
  const land = hexes.filter((h) => !tokenless(h.terrain));
  const slotOf = new Map<HexId, number>(land.map((h, i) => [h.id, i]));
  const neighbors = land.map((h) =>
    hexNeighbors(h.q, h.r)
      .map((id) => slotOf.get(id))
      .filter((i): i is number => i !== undefined),
  );
  const tokens = placeRandomTokens(neighbors, layout.tokenPool, rng);
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

function placePorts(
  layout: LayoutDef,
  hexes: readonly Hex[],
  mode: GameConfig['portMode'],
  rng: RngState,
): Port[] {
  // The generated hexes carry terrain, so on sea-framed boards this walks the land|sea coasts.
  const g = buildGraph(hexes);
  const types = shuffle(rng, expandPool<PortType>(layout.portPool));
  const slots =
    mode === 'random'
      ? randomPortPositions(g.coastEdges.length, types.length, rng)
      : layout.portSlots.map((s) => s % g.coastEdges.length);
  if (slots.length !== types.length) {
    throw new Error(`Layout ${layout.id}: ${types.length} port types for ${slots.length} slots`);
  }
  return slots.map((slot, i) => {
    const edge = g.coastEdges[slot]!;
    const [a, b] = g.edgeVertices[edge]!;
    return { type: types[i]!, edge, vertices: [a, b] };
  });
}
