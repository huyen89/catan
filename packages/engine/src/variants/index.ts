import type { DevCardType, GameConfig, VariantId } from '../types';
import {
  BASE_LAYOUT,
  DEV_DECKS,
  EXT56_LAYOUT,
  NEW_SHORES_LAYOUT,
  SCENARIOS,
  type LayoutDef,
} from '../board/layouts';

export interface VariantDef {
  id: VariantId;
  minPlayers: number;
  maxPlayers: number;
  /** The board. For variants with scenarios: the default scenario's layout (see variantFor). */
  layout: LayoutDef;
  devDeck: Record<DevCardType, number>;
  bankPerResource: number;
  pieces: { roads: number; settlements: number; cities: number };
  /** Ships per player. 0 = the variant has no ships. */
  ships: number;
  /** 5-6 player Special Building Phase after each turn. */
  specialBuildPhase: boolean;
  /** Scenario id -> layout. Absent for single-board variants. */
  scenarios?: Readonly<Record<string, LayoutDef>>;
  /** Scenario used when the config names none and it fits the player count. */
  defaultScenario?: string;
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
    ships: 0,
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
    ships: 0,
    specialBuildPhase: true,
  },
  seafarers: {
    id: 'seafarers',
    minPlayers: 3,
    maxPlayers: 6,
    layout: NEW_SHORES_LAYOUT,
    devDeck: DEV_DECKS.base,
    bankPerResource: 19,
    pieces: { roads: 15, settlements: 5, cities: 4 },
    ships: 15,
    specialBuildPhase: false,
    scenarios: SCENARIOS,
    defaultScenario: 'newShores',
  },
};

/** Variant to use for a player count when the host doesn't override. */
export function defaultVariantFor(players: number): VariantId {
  return players >= 5 ? 'ext56' : 'base';
}

/**
 * Scenario for `variant` and a player count when the config names none: the variant's default
 * scenario if it fits, else the first scenario (in declaration order) that does. Undefined for
 * variants without scenarios.
 */
export function defaultScenarioFor(variant: VariantId, players: number): string | undefined {
  const v = VARIANTS[variant];
  if (!v.scenarios) return undefined;
  const fits = (l: LayoutDef) =>
    players >= (l.minPlayers ?? v.minPlayers) && players <= (l.maxPlayers ?? v.maxPlayers);
  const def = v.defaultScenario !== undefined ? v.scenarios[v.defaultScenario] : undefined;
  if (def && fits(def)) return v.defaultScenario;
  return Object.keys(v.scenarios).find((id) => fits(v.scenarios![id]!)) ?? v.defaultScenario;
}

const resolved = new Map<string, VariantDef>();

/**
 * The effective VariantDef for a config: for variants with scenarios, the scenario's layout,
 * player range and supply overrides are applied (scenario defaults to `defaultScenario`). For
 * other variants this is VARIANTS[variant] itself. Throws for an unknown scenario.
 * Rule handlers get this as `ctx.variant`. Cached; never mutate the result.
 */
export function variantFor(config: Pick<GameConfig, 'variant' | 'scenario'>): VariantDef {
  const v = VARIANTS[config.variant];
  if (!v) throw new Error(`Unknown variant ${String(config.variant)}`);
  if (!v.scenarios) return v;
  const id = config.scenario ?? v.defaultScenario!;
  const key = `${v.id}/${id}`;
  const hit = resolved.get(key);
  if (hit) return hit;
  const layout = Object.hasOwn(v.scenarios, id) ? v.scenarios[id] : undefined;
  if (!layout) throw new Error(`Variant ${v.id} has no scenario ${id}`);
  const out: VariantDef = {
    ...v,
    layout,
    minPlayers: layout.minPlayers ?? v.minPlayers,
    maxPlayers: layout.maxPlayers ?? v.maxPlayers,
    devDeck: layout.devDeck ?? v.devDeck,
    bankPerResource: layout.bankPerResource ?? v.bankPerResource,
    specialBuildPhase: layout.specialBuildPhase ?? v.specialBuildPhase,
  };
  resolved.set(key, out);
  return out;
}
