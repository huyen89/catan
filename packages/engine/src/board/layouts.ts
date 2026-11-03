import { hexId } from '../hex/coords';
import type { DevCardType, HexId, PortType, Terrain } from '../types';

/** A hex whose terrain (and token) is fixed by the layout instead of drawn from the pools. */
export interface FixedHex {
  q: number;
  r: number;
  terrain: Terrain;
  /** Required for producing terrain (incl. gold); omitted for sea/desert. */
  token?: number;
}

/**
 * A region of pool hexes with its own pools (e.g. the small islands of a scenario, so their gold
 * cannot land on the home island). Shuffled and numbered separately from the global pools.
 */
export interface RegionPool {
  /** Pool hexes of this region (never fixed hexes, never in another region). */
  hexes: readonly HexId[];
  /** Terrains (multiset) for exactly these hexes. */
  terrainPool: Readonly<Partial<Record<Terrain, number>>>;
  /** Number tokens. Length = region hexes that are neither desert nor sea. */
  tokenPool: readonly number[];
}

/** Static description of a board shape and its component pools. Scenarios are data. */
export interface LayoutDef {
  id: string;
  /** Every hex of the board, sea included. */
  hexes: ReadonlyArray<{ q: number; r: number }>;
  /** Terrains (multiset) for the hexes in neither `fixedHexes` nor a `regionPools` region. */
  terrainPool: Readonly<Partial<Record<Terrain, number>>>;
  /** Number tokens (multiset). Length = those hexes that are neither desert nor sea. */
  tokenPool: readonly number[];
  /** Port types (multiset). Length = number of port slots. */
  portPool: Readonly<Partial<Record<PortType, number>>>;
  /** Indices into the coastline walk (BoardGraph.coastEdges) for 'fixed' port mode. */
  portSlots: readonly number[];

  // ---- Scenario fields (Open Seas). All optional; base/ext56 layouts set none of them.

  /** In-product display name (original, never a trademarked one). */
  name?: string;
  /** Hexes with a fixed terrain and token; excluded from `terrainPool` and `tokenPool`. */
  fixedHexes?: readonly FixedHex[];
  /** Pool hexes with their own pools; excluded from `terrainPool` and `tokenPool`. */
  regionPools?: readonly RegionPool[];
  /** Islands (land components) containing any of these hexes are home islands (setup only there). */
  homeHexes?: readonly HexId[];
  /** Robber start; defaults to the first desert, else the first land hex. */
  robberStart?: HexId;
  /** Pirate start (a sea hex). Absent = no pirate (GameState.pirate null). */
  pirateStart?: HexId;
  /** VP for a player's first settlement on each non-home island. */
  islandBonusVP?: number;
  /** vpToWin that normalizeConfig uses when the caller does not set one. */
  defaultVpToWin?: number;
  /** Player range of this scenario (narrows the variant's range). */
  minPlayers?: number;
  maxPlayers?: number;
  /** Overrides of the variant's supply for this scenario (e.g. the 5-6 player deck and bank). */
  devDeck?: Readonly<Record<DevCardType, number>>;
  bankPerResource?: number;
  specialBuildPhase?: boolean;
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

// ---------------------------------------------------------------- Open Seas scenarios

/**
 * Parse a sea-framed scenario map. One string per row, top to bottom, one character per hex;
 * odd rows are offset half a hex to the right ("odd-r"), and the middle row's middle hex is 0,0.
 *   `~` sea (fixed)            `P` sea, pirate start
 *   `.` land from the pools    `h` land from the pools, marks its island as a home island
 *   `1`-`9` land from that region's pools (`regions[digit]`, becomes a `regionPools` entry)
 *   `D` fixed desert (the first one is the robber start)
 *   `G` fixed gold; tokens come from `goldTokens` in reading order (the first G is the robber
 *       start when there is no desert)
 */
function seaMap(
  rows: readonly string[],
  goldTokens: readonly number[],
  regions: Readonly<Record<string, Omit<RegionPool, 'hexes'>>> = {},
): Pick<
  LayoutDef,
  'hexes' | 'fixedHexes' | 'regionPools' | 'homeHexes' | 'robberStart' | 'pirateStart'
> {
  const mid = Math.floor(rows.length / 2);
  const q0 = Math.floor(rows[mid]!.length / 2) - (mid - (mid & 1)) / 2;
  const hexes: Array<{ q: number; r: number }> = [];
  const fixedHexes: FixedHex[] = [];
  const homeHexes: HexId[] = [];
  const regionHexes = new Map<string, HexId[]>();
  let desert: HexId | undefined;
  let gold: HexId | undefined;
  let pirateStart: HexId | undefined;
  let g = 0;
  rows.forEach((row, i) =>
    [...row].forEach((ch, col) => {
      const q = col - (i - (i & 1)) / 2 - q0;
      const r = i - mid;
      const id = hexId(q, r);
      hexes.push({ q, r });
      if (ch === '~' || ch === 'P') fixedHexes.push({ q, r, terrain: 'sea' });
      if (ch === 'P') pirateStart = id;
      if (ch === 'h') homeHexes.push(id);
      if (ch >= '1' && ch <= '9') {
        if (!regions[ch]) throw new Error(`seaMap: no pools for region ${ch}`);
        regionHexes.set(ch, [...(regionHexes.get(ch) ?? []), id]);
      }
      if (ch === 'D') {
        fixedHexes.push({ q, r, terrain: 'desert' });
        desert ??= id;
      }
      if (ch === 'G') {
        const token = goldTokens[g++];
        if (token === undefined) throw new Error('seaMap: not enough gold tokens');
        fixedHexes.push({ q, r, terrain: 'gold', token });
        gold ??= id;
      }
    }),
  );
  if (g !== goldTokens.length) throw new Error('seaMap: unused gold tokens');
  const keys = Object.keys(regions).sort();
  for (const k of keys) if (!regionHexes.has(k)) throw new Error(`seaMap: region ${k} unused`);
  const robberStart = desert ?? gold;
  return {
    hexes,
    fixedHexes,
    ...(keys.length > 0 && {
      regionPools: keys.map((k) => ({ hexes: regionHexes.get(k)!, ...regions[k]! })),
    }),
    homeHexes,
    ...(robberStart !== undefined && { robberStart }),
    ...(pirateStart !== undefined && { pirateStart }),
  };
}

/**
 * The outer islands of New Shores and Grand Voyage: one of each terrain plus the pool gold (so
 * the pool gold never lands on the home island), with middling numbers only.
 */
const OUTER_ISLANDS: Omit<RegionPool, 'hexes'> = {
  terrainPool: { forest: 1, pasture: 1, fields: 1, hills: 1, mountains: 1, gold: 1 },
  tokenPool: [3, 4, 5, 9, 10, 11],
};

/** 3-4 players: one large home island, three small islands to the east (one with gold). */
export const NEW_SHORES_LAYOUT: LayoutDef = {
  id: 'newShores',
  name: 'New Shores',
  ...seaMap(
    [
      '~~~~~~~~~~~~',
      '~~...~~~11~~',
      '~....~~P~~~~',
      '~..D.h~~~~1~',
      '~....~~~~G1~',
      '~~...~11~~~~',
      '~~~~~~~~~~~~',
    ],
    [4],
    { 1: OUTER_ISLANDS },
  ),
  // The home island's 18 pool hexes.
  terrainPool: { forest: 4, pasture: 4, fields: 4, hills: 3, mountains: 3 },
  tokenPool: [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12],
  portPool: { any: 4, brick: 1, lumber: 1, wool: 1, grain: 1, ore: 1 },
  // The home island's coastline is coastEdges[0..38).
  portSlots: evenSlots(38, 9),
  islandBonusVP: 2,
  defaultVpToWin: 14,
  minPlayers: 3,
  maxPlayers: 4,
};

/** 3-4 players: four mid-size home islands around a central gold islet. */
export const ARCHIPELAGO_LAYOUT: LayoutDef = {
  id: 'archipelago',
  name: 'Archipelago',
  ...seaMap(
    [
      '~~~~~~~~~~~',
      '~h..~~~h..~',
      '~~..~~~~..~',
      '~~~~PG~~~~~',
      '~~h.~~~~h.~',
      '~...~~~...~',
      '~~~~~~~~~~~',
    ],
    [4],
  ),
  terrainPool: { forest: 4, pasture: 4, fields: 4, hills: 4, mountains: 4 },
  tokenPool: [2, 3, 3, 4, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 10, 11, 11, 12],
  portPool: { any: 3, brick: 1, lumber: 1, wool: 1, grain: 1, ore: 1 },
  // Two per home island. Coastlines in coastEdges: a home island at 0..16, the gold islet at
  // 16..22, then the other home islands at 22..38, 38..54 and 54..70.
  portSlots: [0, 8, 22, 30, 38, 46, 54, 62],
  islandBonusVP: 2,
  defaultVpToWin: 13,
  minPlayers: 3,
  maxPlayers: 4,
};

/** 5-6 players: a large home island and four islets to the east (one with gold). */
export const GRAND_VOYAGE_LAYOUT: LayoutDef = {
  id: 'grandVoyage',
  name: 'Grand Voyage',
  ...seaMap(
    [
      '~~~~~~~~~~~~~~',
      '~~....~~~11~~~',
      '~......~~~~~1~',
      '~...D.h.~P~~1~',
      '~......~~~~~~~',
      '~~....~~~1G~1~',
      '~~~~~~~~~~~~~~',
    ],
    [4],
    { 1: OUTER_ISLANDS },
  ),
  // The home island's 26 pool hexes.
  terrainPool: { forest: 6, pasture: 6, fields: 6, hills: 4, mountains: 4 },
  tokenPool: [2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 6, 6, 6, 8, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11, 12, 12],
  portPool: { any: 5, wool: 2, brick: 1, lumber: 1, grain: 1, ore: 1 },
  // The home island's coastline is coastEdges[0..42).
  portSlots: evenSlots(42, 11),
  islandBonusVP: 2,
  defaultVpToWin: 14,
  minPlayers: 5,
  maxPlayers: 6,
  devDeck: DEV_DECKS.ext56,
  bankPerResource: 24,
  specialBuildPhase: true,
};

/** Open Seas scenarios by id (= LayoutDef.id). */
export const SCENARIOS = {
  newShores: NEW_SHORES_LAYOUT,
  archipelago: ARCHIPELAGO_LAYOUT,
  grandVoyage: GRAND_VOYAGE_LAYOUT,
} as const satisfies Record<string, LayoutDef>;

export type ScenarioId = keyof typeof SCENARIOS;
export const SCENARIO_IDS = Object.keys(SCENARIOS) as [ScenarioId, ...ScenarioId[]];
