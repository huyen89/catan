import type { Board, GameConfig, Hex, Port, PortType, Terrain } from '../types';
import { hexId } from '../hex/coords';
import { buildGraph } from '../hex/topology';
import { shuffle, type RngState } from '../rng';
import type { LayoutDef } from './layouts';

/** Expand a {item: count} pool into a flat array in a stable order. */
export function expandPool<T extends string>(pool: Readonly<Partial<Record<T, number>>>): T[] {
  const out: T[] = [];
  for (const k of Object.keys(pool).sort() as T[])
    for (let i = 0; i < (pool[k] ?? 0); i++) out.push(k);
  return out;
}

/**
 * Generate a random board. Mutates `rng`.
 * M0 baseline: shuffled terrain + shuffled tokens + fixed port slots.
 * Workstream E1 replaces internals with constrained token placement (no adjacent 6/8),
 * spiral mode and random port slots — signature stays the same.
 */
export function generateBoard(
  layout: LayoutDef,
  config: Pick<GameConfig, 'numberMode' | 'portMode'>,
  rng: RngState,
): Board {
  const terrains = shuffle(rng, expandPool<Terrain>(layout.terrainPool));
  const tokens = shuffle(rng, layout.tokenPool);
  let ti = 0;
  const hexes: Hex[] = layout.hexes.map(({ q, r }, i) => {
    const terrain = terrains[i]!;
    const token = terrain === 'desert' ? null : tokens[ti++]!;
    return { id: hexId(q, r), q, r, terrain, token };
  });

  const g = buildGraph(layout.hexes);
  const portTypes = shuffle(rng, expandPool<PortType>(layout.portPool));
  const ports: Port[] = layout.portSlots.map((slot, i) => {
    const edge = g.coastEdges[slot % g.coastEdges.length]!;
    return { type: portTypes[i]!, edge, vertices: g.edgeVertices[edge]! };
  });

  return { layoutId: layout.id, hexes, ports };
}
