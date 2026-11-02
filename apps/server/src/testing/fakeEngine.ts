import {
  redactEvent,
  type Action,
  type ApplyResult,
  type GameConfig,
  type GameEvent,
  type GameState,
  type PlayerView,
  type Seat,
} from '@hexhaven/engine';
import type { BotDecide, EngineApi } from '../rooms/engineApi';

const empty = () => ({ brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 });

/**
 * Toy engine for server tests. Every seat in turn sends END_TURN; after `turnsToWin` turns the
 * game ends with the last player to end a turn as the winner. BUY_DEV hands the current player a
 * secret card (so tests can check redaction of hands and `boughtDev` events).
 */
export function createFakeEngine(opts: { turnsToWin?: number } = {}): EngineApi {
  const turnsToWin = opts.turnsToWin ?? 1000;
  const fail = (code: 'NOT_YOUR_TURN' | 'INVALID_ACTION', message: string): ApplyResult => ({
    ok: false,
    error: { code, message },
  });

  return {
    normalizeConfig: (p) =>
      ({
        variant: p.players >= 5 ? 'ext56' : 'base',
        vpToWin: 10,
        discardLimit: 7,
        numberMode: 'random',
        portMode: 'fixed',
        ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)),
      }) as GameConfig,

    createGame(config, seed): GameState {
      return {
        version: 0,
        engineVersion: 0,
        config,
        rng: [seed.length, 0, 0, 0],
        board: { layoutId: 'fake', hexes: [], ports: [] },
        robber: '0,0',
        buildings: {},
        roads: {},
        players: Array.from({ length: config.players }, (_, seat) => ({
          seat,
          resources: empty(),
          devCards: [],
          newDevCards: [],
          playedKnights: 0,
          roadsLeft: 15,
          settlementsLeft: 5,
          citiesLeft: 4,
          longestRoadLength: 0,
        })),
        bank: { brick: 19, lumber: 19, wool: 19, grain: 19, ore: 19 },
        devDeck: ['knight', 'monopoly', 'victoryPoint', 'yearOfPlenty'],
        setupOrder: [],
        turn: { current: 0, number: 1, dice: null, devPlayed: false },
        phase: { kind: 'main' },
        trades: [],
        nextTradeId: 1,
        longestRoad: null,
        largestArmy: null,
        winner: null,
      };
    },

    applyAction(state: GameState, seat: Seat, action: Action): ApplyResult {
      if (state.phase.kind === 'gameOver')
        return { ok: false, error: { code: 'GAME_OVER', message: 'over' } };
      if (seat !== state.turn.current) return fail('NOT_YOUR_TURN', `seat ${seat} cannot act`);
      const next = structuredClone(state);
      next.version = state.version + 1;
      const events: GameEvent[] = [];
      switch (action.type) {
        case 'END_TURN': {
          if (state.turn.number >= turnsToWin) {
            next.phase = { kind: 'gameOver', winner: seat };
            next.winner = seat;
            events.push({ type: 'gameOver', winner: seat, vp: next.players.map(() => 0) });
          } else {
            next.turn = { ...next.turn, current: (seat + 1) % state.players.length };
            next.turn.number++;
            events.push({ type: 'turnStarted', seat: next.turn.current, turn: next.turn.number });
          }
          break;
        }
        case 'BUY_DEV': {
          const card = next.devDeck.pop() ?? 'knight';
          next.players[seat]!.devCards.push(card);
          events.push({ type: 'boughtDev', seat, card });
          break;
        }
        default:
          return fail('INVALID_ACTION', `fake engine does not support ${action.type}`);
      }
      return { ok: true, state: next, events };
    },

    toPlayerView(state, viewer): PlayerView {
      const over = state.phase.kind === 'gameOver';
      return {
        viewer,
        version: state.version,
        config: state.config,
        board: state.board,
        robber: state.robber,
        buildings: state.buildings,
        roads: state.roads,
        players: state.players.map((p) => ({
          seat: p.seat,
          resourceCount: Object.values(p.resources).reduce((a, b) => a + b, 0),
          devCardCount: p.devCards.length,
          playedKnights: 0,
          roadsLeft: p.roadsLeft,
          settlementsLeft: p.settlementsLeft,
          citiesLeft: p.citiesLeft,
          longestRoadLength: 0,
          publicVP: 0,
          ...(over || p.seat === viewer
            ? { resources: { ...p.resources }, devCards: [...p.devCards], newDevCards: [] }
            : {}),
        })),
        bank: { ...state.bank },
        devDeckCount: state.devDeck.length,
        setupOrder: state.setupOrder,
        turn: state.turn,
        phase: state.phase,
        trades: state.trades,
        longestRoad: null,
        largestArmy: null,
        winner: state.winner,
        pendingActors: over ? [] : [state.turn.current],
        legal: null,
      };
    },

    redactEvent,

    getPendingActors: (state) => (state.phase.kind === 'gameOver' ? [] : [state.turn.current]),
  };
}

export interface FakeBot {
  decide: BotDecide;
  /** Seats (view.viewer) the bot was asked to play, in order. */
  calls: Array<Seat | null>;
}

/** Bot that always ends its turn. `throwFor` seats make decide throw (to test fallbacks). */
export function createFakeBot(opts: { throwFor?: Seat[] } = {}): FakeBot {
  const calls: Array<Seat | null> = [];
  return {
    calls,
    decide: (view) => {
      calls.push(view.viewer);
      if (view.viewer !== null && opts.throwFor?.includes(view.viewer)) throw new Error('boom');
      return { type: 'END_TURN' };
    },
  };
}
