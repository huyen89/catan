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

/** "Forest (8)" — used by the log and robber prompts. */
export function hexLabel(board: Board, id: string): string {
  const h = board.hexes.find((x) => x.id === id);
  if (!h) return id;
  return h.token ? `${TERRAIN_LABEL[h.terrain]} (${h.token})` : TERRAIN_LABEL[h.terrain];
}
