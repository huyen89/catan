import { createGame, normalizeConfig } from '../game';
import { resourcesOf } from '../resources';
import type { GameConfig, GameState, ResourceCounts, Seat } from '../types';

/** A fresh game with a deterministic seed. */
export function newGame(
  players = 4,
  overrides: Partial<GameConfig> = {},
  seed = 'test-seed',
): GameState {
  return createGame(normalizeConfig({ players, ...overrides }), seed);
}

/** Skip setup: put the game into `phase` with the given player as current. Mutates and returns state. */
export function inPhase(state: GameState, phase: GameState['phase'], current: Seat = 0): GameState {
  state.phase = phase;
  state.turn.current = current;
  if (phase.kind !== 'setup') state.turn.number = Math.max(1, state.turn.number);
  return state;
}

/** Give resources to a seat (taken from the bank). Mutates and returns state. */
export function give(state: GameState, seat: Seat, r: Partial<ResourceCounts>): GameState {
  const full = resourcesOf(r);
  for (const k of Object.keys(full) as Array<keyof ResourceCounts>) {
    state.players[seat]!.resources[k] += full[k];
    state.bank[k] -= full[k];
  }
  return state;
}

/** Place a building directly (no validation). */
export function putBuilding(
  state: GameState,
  seat: Seat,
  vertex: string,
  kind: 'settlement' | 'city' = 'settlement',
): GameState {
  state.buildings[vertex] = { owner: seat, kind };
  const p = state.players[seat]!;
  if (kind === 'settlement') p.settlementsLeft--;
  else p.citiesLeft--;
  return state;
}

/** Place a road directly (no validation). */
export function putRoad(state: GameState, seat: Seat, edge: string): GameState {
  state.roads[edge] = seat;
  state.players[seat]!.roadsLeft--;
  return state;
}
