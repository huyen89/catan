import type { DevCardType, PortType, Terrain } from '../types';

/** Static description of a board shape and its component pools. Scenarios are data. */
export interface LayoutDef {
  id: string;
  hexes: ReadonlyArray<{ q: number; r: number }>;
  terrainPool: Readonly<Partial<Record<Terrain, number>>>;
  /** Number tokens (multiset). Length = non-desert land hexes. */
  tokenPool: readonly number[];
  /** Port types (multiset). Length = number of port slots. */
  portPool: Readonly<Partial<Record<PortType, number>>>;
  /** Indices into the coastline walk (BoardGraph.coastEdges) for 'fixed' port mode. */
  portSlots: readonly number[];
}

function hexagon(radius: number): Array<{ q: number; r: number }> {
  const out: Array<{ q: number; r: number }> = [];
  for (let q = -radius; q <= radius; q++)
    for (let r = -radius; r <= radius; r++) {
      const s = -q - r;
      if (Math.abs(s) <= radius) out.push({ q, r });
    }
  return out;
}

/** 30-hex board, rows (r = -3..3) of 3,4,5,6,5,4,3. */
function ext56Shape(): Array<{ q: number; r: number }> {
  const out: Array<{ q: number; r: number }> = [];
  for (let r = -3; r <= 3; r++)
    for (let q = -3; q <= 2; q++) {
      const s = -q - r;
      if (s >= -2 && s <= 3) out.push({ q, r });
    }
  return out;
}

/** Evenly spaced slot indices around a coastline of `coastLen` edges. */
export function evenSlots(coastLen: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => Math.floor((i * coastLen) / count));
}

export const BASE_LAYOUT: LayoutDef = {
  id: 'base19',
  hexes: hexagon(2),
  terrainPool: { forest: 4, pasture: 4, fields: 4, hills: 3, mountains: 3, desert: 1 },
  tokenPool: [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12],
  portPool: { any: 4, brick: 1, lumber: 1, wool: 1, grain: 1, ore: 1 },
  portSlots: evenSlots(30, 9),
};

export const EXT56_LAYOUT: LayoutDef = {
  id: 'ext30',
  hexes: ext56Shape(),
  terrainPool: { forest: 6, pasture: 6, fields: 6, hills: 5, mountains: 5, desert: 2 },
  tokenPool: [
    2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 8, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12,
  ],
  portPool: { any: 5, wool: 2, brick: 1, lumber: 1, grain: 1, ore: 1 },
  portSlots: evenSlots(38, 11),
};

export const DEV_DECKS: Record<'base' | 'ext56', Record<DevCardType, number>> = {
  base: { knight: 14, victoryPoint: 5, roadBuilding: 2, yearOfPlenty: 2, monopoly: 2 },
  ext56: { knight: 20, victoryPoint: 5, roadBuilding: 3, yearOfPlenty: 3, monopoly: 3 },
};
