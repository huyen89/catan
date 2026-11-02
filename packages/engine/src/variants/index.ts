import type { DevCardType, VariantId } from '../types';
import { BASE_LAYOUT, DEV_DECKS, EXT56_LAYOUT, type LayoutDef } from '../board/layouts';

export interface VariantDef {
  id: VariantId;
  minPlayers: number;
  maxPlayers: number;
  layout: LayoutDef;
  devDeck: Record<DevCardType, number>;
  bankPerResource: number;
  pieces: { roads: number; settlements: number; cities: number };
  /** 5-6 player Special Building Phase after each turn. */
  specialBuildPhase: boolean;
}

export const VARIANTS: Record<VariantId, VariantDef> = {
  base: {
    id: 'base',
    minPlayers: 3,
    maxPlayers: 4,
    layout: BASE_LAYOUT,
    devDeck: DEV_DECKS.base,
    bankPerResource: 19,
    pieces: { roads: 15, settlements: 5, cities: 4 },
    specialBuildPhase: false,
  },
  ext56: {
    id: 'ext56',
    minPlayers: 3,
    maxPlayers: 6,
    layout: EXT56_LAYOUT,
    devDeck: DEV_DECKS.ext56,
    bankPerResource: 24,
    pieces: { roads: 15, settlements: 5, cities: 4 },
    specialBuildPhase: true,
  },
};

/** Variant to use for a player count when the host doesn't override. */
export function defaultVariantFor(players: number): VariantId {
  return players >= 5 ? 'ext56' : 'base';
}
