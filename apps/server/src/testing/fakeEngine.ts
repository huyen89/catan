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
import type { BotFactory, EngineApi } from '../rooms/engineApi';

const empty = () => ({ brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 });

/**
 * Toy engine for server tests. Every seat in turn sends END_TURN; after `turnsToWin` turns the
 * game ends with the last player to end a turn as the winner. BUY_DEV hands the current player a
 * secret card (so tests can check redaction of hands and `boughtDev` events). Player trades are
 * bookkeeping only (no cards move): OFFER_TRADE opens an offer to every other seat, who then
 * become pending actors until they RESPOND_TRADE (or counter with OFFER_TRADE + counterTo, which
 * asks the original offerer only); CONFIRM/CANCEL close it, END_TURN clears all.
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
        ships: {},
        pirate: null,
        islandBonus: {},
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
          shipsLeft: 0,
          bonusVP: 0,
        })),
        bank: { brick: 19, lumber: 19, wool: 19, grain: 19, ore: 19 },
        devDeck: ['knight', 'monopoly', 'victoryPoint', 'yearOfPlenty'],
        setupOrder: [],
        turn: {
          current: 0,
          number: 1,
          dice: null,
          devPlayed: false,
          shipMoved: false,
          newShips: [],
        },
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
      const next = structuredClone(state);
      next.version = state.version + 1;
      const events: GameEvent[] = [];
      if (action.type === 'RESPOND_TRADE') {
        const t = next.trades.find((o) => o.id === action.offerId);
        if (t?.responses[String(seat)] !== 'pending')
          return fail('INVALID_ACTION', 'nothing to answer');
        t.responses[String(seat)] = action.response;
        events.push({ type: 'tradeResponded', offerId: t.id, seat, response: action.response });
        return { ok: true, state: next, events };
      }
      if (action.type === 'OFFER_TRADE' && action.counterTo !== null) {
        // A counter goes back to the original offerer, from a seat still asked to answer it.
        const orig = next.trades.find((o) => o.id === action.counterTo);
        if (orig?.responses[String(seat)] !== 'pending' || orig.counterTo !== null)
          return fail('INVALID_ACTION', 'nothing to counter');
        const counter = {
          id: next.nextTradeId++,
          from: seat,
          give: action.give,
          want: action.want,
          to: [orig.from],
          counterTo: orig.id,
          responses: { [String(orig.from)]: 'pending' as const },
        };
        next.trades.push(counter);
        events.push({ type: 'tradeOffered', offer: counter });
        return { ok: true, state: next, events };
      }
      if (seat !== state.turn.current) return fail('NOT_YOUR_TURN', `seat ${seat} cannot act`);
      switch (action.type) {
        case 'OFFER_TRADE': {
          const offer = {
            id: next.nextTradeId++,
            from: seat,
            give: action.give,
            want: action.want,
            to: null,
            counterTo: null,
            responses: Object.fromEntries(
              next.players
                .filter((p) => p.seat !== seat)
                .map((p) => [String(p.seat), 'pending' as const]),
            ),
          };
          next.trades.push(offer);
          events.push({ type: 'tradeOffered', offer });
          break;
        }
        case 'CONFIRM_TRADE': {
          const t = next.trades.find((o) => o.id === action.offerId);
          if (!t || t.responses[String(action.with)] !== 'accept')
            return fail('INVALID_ACTION', 'not accepted');
          next.trades = next.trades.filter((o) => o !== t);
          events.push({
            type: 'traded',
            offerId: t.id,
            a: seat,
            b: action.with,
            aGave: t.give,
            bGave: t.want,
          });
          break;
        }
        case 'CANCEL_TRADE': {
          if (!next.trades.some((o) => o.id === action.offerId && o.from === seat))
            return fail('INVALID_ACTION', 'no such offer of yours');
          next.trades = next.trades.filter((o) => o.id !== action.offerId);
          events.push({ type: 'tradeCancelled', offerId: action.offerId });
          break;
        }
        case 'END_TURN': {
          if (state.turn.number >= turnsToWin) {
            next.phase = { kind: 'gameOver', winner: seat };
            next.winner = seat;
            // Final VP = cards held, so tests can steer scores with BUY_DEV.
            events.push({
              type: 'gameOver',
              winner: seat,
              vp: next.players.map((p) => p.devCards.length),
            });
          } else {
            next.trades = [];
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
        ships: state.ships,
        pirate: state.pirate,
        islandBonus: state.islandBonus,
        players: state.players.map((p) => ({
          seat: p.seat,
          resourceCount: Object.values(p.resources).reduce((a, b) => a + b, 0),
          devCardCount: p.devCards.length,
          playedKnights: 0,
          roadsLeft: p.roadsLeft,
          settlementsLeft: p.settlementsLeft,
          citiesLeft: p.citiesLeft,
          longestRoadLength: 0,
          shipsLeft: p.shipsLeft,
          bonusVP: p.bonusVP,
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
        pendingActors: over ? [] : pendingOf(state),
        legal: null,
      };
    },

    redactEvent,

    upgradeState: (state) => state,

    getPendingActors: (state) => (state.phase.kind === 'gameOver' ? [] : pendingOf(state)),
  };
}

function pendingOf(state: GameState): Seat[] {
  const out = new Set<Seat>([state.turn.current]);
  for (const t of state.trades)
    for (const [s, r] of Object.entries(t.responses)) if (r === 'pending') out.add(Number(s));
  return [...out];
}

export interface FakeBot {
  bots: BotFactory;
  /** Seats (view.viewer) the bot was asked to play, in order. */
  calls: Array<Seat | null>;
  /** Difficulty of every bot instance created, in order (one per seat takeover). */
  created: string[];
}

/** Bot that always ends its turn. `throwFor` seats make decide throw (to test fallbacks). */
export function createFakeBot(opts: { throwFor?: Seat[] } = {}): FakeBot {
  const calls: Array<Seat | null> = [];
  const created: string[] = [];
  return {
    calls,
    created,
    bots: (o) => {
      created.push(o.difficulty);
      return {
        decide: (view) => {
          calls.push(view.viewer);
          if (view.viewer !== null && opts.throwFor?.includes(view.viewer)) throw new Error('boom');
          return { type: 'END_TURN' };
        },
      };
    },
  };
}
