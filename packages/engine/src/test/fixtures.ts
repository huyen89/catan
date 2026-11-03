import type { Ctx } from '../context';
import { createGame, normalizeConfig } from '../game';
import { graphFor, type BoardGraph } from '../hex/topology';
import { applyAction } from '../reducer';
import { resourcesOf } from '../resources';
import {
  RESOURCES,
  type Action,
  type EdgeId,
  type GameConfig,
  type GameEvent,
  type GameState,
  type HexId,
  type ResourceCounts,
  type Seat,
  type Terrain,
  type VertexId,
} from '../types';
import { variantFor } from '../variants';
import { randomLegalAction, seededRandom } from './randomPlay';

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

/** Set a seat's hand exactly (difference taken from / returned to the bank). Mutates and returns state. */
export function setHand(state: GameState, seat: Seat, r: Partial<ResourceCounts>): GameState {
  const full = resourcesOf(r);
  const hand = state.players[seat]!.resources;
  for (const k of RESOURCES) {
    state.bank[k] += hand[k] - full[k];
    hand[k] = full[k];
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

/** Place a ship directly (no validation). */
export function putShip(state: GameState, seat: Seat, edge: string): GameState {
  state.ships[edge] = seat;
  state.players[seat]!.shipsLeft--;
  return state;
}

/** A fresh Open Seas game (default: New Shores, 4 players). */
export function newSeaGame(
  players = 4,
  scenario = players >= 5 ? 'grandVoyage' : 'newShores',
  seed = 'sea-seed',
): GameState {
  return newGame(players, { variant: 'seafarers', scenario }, seed);
}

/** Overwrite a hex's terrain/token (tests that need a known board). Mutates and returns state. */
export function setHex(
  state: GameState,
  id: HexId,
  terrain: Terrain,
  token: number | null,
): GameState {
  const hex = state.board.hexes.find((h) => h.id === id);
  if (!hex) throw new Error(`No hex ${id}`);
  hex.terrain = terrain;
  hex.token = token;
  return state;
}

/** Apply an action that must succeed. */
export function act(
  state: GameState,
  seat: Seat,
  action: Action,
): { state: GameState; events: GameEvent[] } {
  const res = applyAction(state, seat, action);
  if (!res.ok) throw new Error(`${action.type} by ${seat} failed: ${res.error.message}`);
  return { state: res.state, events: res.events };
}

/** Play the setup snake draft with random legal placements; returns the state at turn 1 preRoll. */
export function finishSetup(state: GameState, seed = 'setup'): GameState {
  const rnd = seededRandom(seed);
  while (state.phase.kind === 'setup') {
    const seat = state.setupOrder[state.phase.index]!;
    const action = randomLegalAction(state, seat, rnd);
    if (!action) throw new Error('Setup is stuck');
    state = act(state, seat, action).state;
  }
  return state;
}

/** A rules context over `state` (mutated in place) for calling helpers like updateLongestRoad. */
export function ctxFor(state: GameState, seat: Seat = 0): Ctx {
  return {
    state,
    seat,
    events: [],
    graph: graphFor(state.board),
    variant: variantFor(state.config),
  };
}

/** The edge joining two adjacent vertices. */
export function edgeBetween(graph: BoardGraph, a: VertexId, b: VertexId): EdgeId {
  const e = graph.vertexEdges[a]!.find((x) => graph.edgeVertices[x]!.includes(b));
  if (!e) throw new Error(`${a} and ${b} are not adjacent`);
  return e;
}

/** A simple path of `n` edges from `start` (greedy, deterministic), avoiding `avoid` vertices. */
export function walk(
  graph: BoardGraph,
  start: VertexId,
  n: number,
  avoid: ReadonlySet<VertexId> = new Set(),
): VertexId[] {
  const path = [start];
  while (path.length <= n) {
    const next = [...graph.vertexNeighbors[path.at(-1)!]!]
      .sort()
      .find((v) => !path.includes(v) && !avoid.has(v));
    if (!next) throw new Error(`walk from ${start} stuck after ${path.length - 1} edges`);
    path.push(next);
  }
  return path;
}

/** Put roads for `seat` along consecutive vertices of `path`. Mutates and returns state. */
export function putPath(state: GameState, seat: Seat, path: readonly VertexId[]): GameState {
  const graph = graphFor(state.board);
  for (let i = 1; i < path.length; i++) {
    putRoad(state, seat, edgeBetween(graph, path[i - 1]!, path[i]!));
  }
  return state;
}

export * from './randomPlay';
