import { expandPool, generateBoard } from './board/generate';
import { emptyResources } from './resources';
import { seedRng, shuffle } from './rng';
import type { DevCardType, GameConfig, GameState, PlayerState } from './types';
import { DEFAULT_CONFIG, RESOURCES } from './types';
import { VARIANTS, defaultScenarioFor, defaultVariantFor, variantFor } from './variants';

/**
 * Rules/state-shape version. 2: Open Seas fields (ships, pirate, islandBonus, shipsLeft, bonusVP,
 * board.homeIslands/islandBonusVP, turn.shipMoved/newShips, moveRobber.allowPirate, steal.via).
 * Older snapshots: upgradeState.
 */
export const ENGINE_VERSION = 2;

export function normalizeConfig(partial: Partial<GameConfig> & { players: number }): GameConfig {
  const defined = Object.fromEntries(
    Object.entries(partial).filter(([, v]) => v !== undefined),
  ) as Partial<GameConfig> & { players: number };
  const config: GameConfig = {
    ...DEFAULT_CONFIG,
    variant: defaultVariantFor(partial.players),
    ...defined,
  };
  if (!VARIANTS[config.variant]?.scenarios) {
    delete config.scenario;
    return config;
  }
  config.scenario ??= defaultScenarioFor(config.variant, config.players);
  if (defined.vpToWin === undefined) {
    config.vpToWin = variantFor(config).layout.defaultVpToWin ?? config.vpToWin;
  }
  return config;
}

/** Snake order for setup: 0..n-1 then n-1..0. */
export function snakeOrder(n: number): number[] {
  const fwd = Array.from({ length: n }, (_, i) => i);
  return [...fwd, ...fwd.slice().reverse()];
}

export function createGame(config: GameConfig, seed: string): GameState {
  const variant = variantFor(config);
  const where = variant.scenarios ? `${config.variant}/${variant.layout.id}` : config.variant;
  if (config.players < variant.minPlayers || config.players > variant.maxPlayers) {
    throw new Error(
      `Variant ${where} supports ${variant.minPlayers}-${variant.maxPlayers} players`,
    );
  }
  const layout = variant.layout;
  const rng = seedRng(seed);
  const board = generateBoard(layout, config, rng);
  const robber =
    layout.robberStart ??
    (
      board.hexes.find((h) => h.terrain === 'desert') ??
      board.hexes.find((h) => h.terrain !== 'sea') ??
      board.hexes[0]!
    ).id;
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
    shipsLeft: variant.ships,
    bonusVP: 0,
  }));

  return {
    version: 0,
    engineVersion: ENGINE_VERSION,
    config,
    rng,
    board,
    robber,
    buildings: {},
    roads: {},
    ships: {},
    pirate: layout.pirateStart ?? null,
    islandBonus: {},
    players,
    bank,
    devDeck,
    setupOrder: snakeOrder(config.players),
    turn: { current: 0, number: 0, dice: null, devPlayed: false, shipMoved: false, newShips: [] },
    phase: { kind: 'setup', index: 0, step: 'settlement', lastSettlement: null },
    trades: [],
    nextTradeId: 1,
    longestRoad: null,
    largestArmy: null,
    winner: null,
  };
}

/**
 * Bring a persisted state from an older ENGINE_VERSION up to the current shape: fills every field
 * added since with its default (no ships, no pirate, no bonuses; supply from the variant). Pure:
 * returns a new state and leaves `state` untouched; `version` is kept. Idempotent, so it is safe
 * to call on every load. Throws for a state written by a newer engine.
 */
export function upgradeState(state: GameState): GameState {
  if (state.engineVersion > ENGINE_VERSION) {
    throw new Error(
      `State from engine v${state.engineVersion} is newer than this engine (v${ENGINE_VERSION})`,
    );
  }
  const s = structuredClone(state);
  const variant = variantFor(s.config);
  s.ships ??= {};
  s.pirate ??= null;
  s.islandBonus ??= {};
  // Pre-v2 boards have no sea: one island, which is home.
  s.board.homeIslands ??= [0];
  s.board.islandBonusVP ??= 0;
  s.turn.shipMoved ??= false;
  s.turn.newShips ??= [];
  for (const p of s.players) {
    p.shipsLeft ??= variant.ships;
    p.bonusVP ??= 0;
  }
  if (s.phase.kind === 'moveRobber') s.phase.allowPirate ??= false;
  if (s.phase.kind === 'steal') s.phase.via ??= 'robber';
  s.engineVersion = ENGINE_VERSION;
  return s;
}
