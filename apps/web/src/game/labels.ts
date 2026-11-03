import {
  RESOURCES,
  type Board,
  type DevCardType,
  type Resource,
  type ResourceCounts,
  type Terrain,
} from '@hexhaven/engine';

export const RESOURCE_LABEL: Record<Resource, string> = {
  brick: 'Brick',
  lumber: 'Lumber',
  wool: 'Wool',
  grain: 'Grain',
  ore: 'Ore',
};

export const TERRAIN_LABEL: Record<Terrain, string> = {
  hills: 'Hills',
  forest: 'Forest',
  pasture: 'Pasture',
  fields: 'Fields',
  mountains: 'Mountains',
  desert: 'Desert',
  sea: 'Sea',
  gold: 'Gold field',
};

export const DEV_LABEL: Record<DevCardType, string> = {
  knight: 'Knight',
  victoryPoint: 'Victory Point',
  roadBuilding: 'Road Building',
  yearOfPlenty: 'Year of Plenty',
  monopoly: 'Monopoly',
};

export const DEV_HELP: Record<DevCardType, string> = {
  knight: 'Move the robber and steal a card',
  victoryPoint: '1 hidden victory point',
  roadBuilding: 'Place 2 free roads',
  yearOfPlenty: 'Take any 2 resources from the bank',
  monopoly: 'Take every card of one resource from all opponents',
};

/** "2 brick, 1 ore" — empty counts render as "nothing". */
export function formatCounts(c: ResourceCounts): string {
  const parts = RESOURCES.filter((r) => c[r] > 0).map((r) => `${c[r]} ${r}`);
  return parts.length ? parts.join(', ') : 'nothing';
}

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}

export type Award = 'longestRoad' | 'largestArmy';

/**
 * Award names. With ships (Open Seas) the longest-road award is the longest trade route,
 * counting roads and ships together.
 */
export function awardLabel(award: Award, variant?: string): string {
  if (award === 'largestArmy') return 'Largest Army';
  return variant === 'seafarers' ? 'Longest Trade Route' : 'Longest Road';
}

/** Short badge text for the players panel. */
export function awardBadge(award: Award, variant?: string): string {
  if (award === 'largestArmy') return 'Army';
  return variant === 'seafarers' ? 'Route' : 'Road';
}

/**
 * Where an edge is, for screen readers: "between Forest 4 and Sea", or "next to Hills 5" on the
 * board edge. Falls back to the raw id for unknown edges.
 */
export function edgePlace(
  board: Board,
  edgeHexes: Readonly<Record<string, readonly string[]>>,
  edge: string,
): string {
  const label = (id: string) => {
    const h = board.hexes.find((x) => x.id === id);
    return h ? `${TERRAIN_LABEL[h.terrain]}${h.token ? ` ${h.token}` : ''}` : id;
  };
  const hexes = edgeHexes[edge] ?? [];
  if (hexes.length === 2) return `between ${label(hexes[0]!)} and ${label(hexes[1]!)}`;
  if (hexes.length === 1) return `next to ${label(hexes[0]!)}`;
  return `at ${edge}`;
}

/** "Forest (8)" — used by the log and robber prompts. */
export function hexLabel(board: Board, id: string): string {
  const h = board.hexes.find((x) => x.id === id);
  if (!h) return id;
  return h.token ? `${TERRAIN_LABEL[h.terrain]} (${h.token})` : TERRAIN_LABEL[h.terrain];
}
