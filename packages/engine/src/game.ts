import { generateBoard } from './board/generate';
import { emptyResources } from './resources';
import { seedRng, shuffle } from './rng';
import type { DevCardType, GameConfig, GameState, PlayerState } from './types';
import { DEFAULT_CONFIG, RESOURCES } from './types';
import { VARIANTS, defaultVariantFor } from './variants';
import { expandPool } from './board/generate';

export const ENGINE_VERSION = 1;

export function normalizeConfig(partial: Partial<GameConfig> & { players: number }): GameConfig {
  return {
    ...DEFAULT_CONFIG,
    variant: defaultVariantFor(partial.players),
    ...partial,
  };
}

/** Snake order for setup: 0..n-1 then n-1..0. */
export function snakeOrder(n: number): number[] {
  const fwd = Array.from({ length: n }, (_, i) => i);
  return [...fwd, ...fwd.slice().reverse()];
}

export function createGame(config: GameConfig, seed: string): GameState {
  const variant = VARIANTS[config.variant];
  if (config.players < variant.minPlayers || config.players > variant.maxPlayers) {
    throw new Error(
      `Variant ${config.variant} supports ${variant.minPlayers}-${variant.maxPlayers} players`,
    );
  }
  const rng = seedRng(seed);
  const board = generateBoard(variant.layout, config, rng);
  const desert = board.hexes.find((h) => h.terrain === 'desert') ?? board.hexes[0]!;
  const devDeck = shuffle(rng, expandPool<DevCardType>(variant.devDeck));
  const bank = emptyResources();
  for (const r of RESOURCES) bank[r] = variant.bankPerResource;

  const players: PlayerState[] = Array.from({ length: config.players }, (_, seat) => ({
    seat,
    resources: emptyResources(),
    devCards: [],
    newDevCards: [],
    playedKnights: 0,
    roadsLeft: variant.pieces.roads,
    settlementsLeft: variant.pieces.settlements,
    citiesLeft: variant.pieces.cities,
    longestRoadLength: 0,
  }));

  return {
    version: 0,
    engineVersion: ENGINE_VERSION,
    config,
    rng,
    board,
    robber: desert.id,
    buildings: {},
    roads: {},
    players,
    bank,
    devDeck,
    setupOrder: snakeOrder(config.players),
    turn: { current: 0, number: 0, dice: null, devPlayed: false },
    phase: { kind: 'setup', index: 0, step: 'settlement', lastSettlement: null },
    trades: [],
    nextTradeId: 1,
    longestRoad: null,
    largestArmy: null,
    winner: null,
  };
}
