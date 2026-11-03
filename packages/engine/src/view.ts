import { getLegal } from './legal';
import { getPendingActors } from './pending';
import { totalResources } from './resources';
import { publicVP, totalVP } from './rules/victory';
import type {
  Board,
  Building,
  GameEvent,
  GameState,
  Phase,
  PlayerState,
  PlayerView,
  PublicPlayer,
  Seat,
  TradeOffer,
  VertexId,
} from './types';

/**
 * How each GameState field reaches a PlayerView:
 * - `public`: copied as is (deep, non-aliasing);
 * - `derived`: summarised or redacted (players → PublicPlayer, devDeck → devDeckCount);
 * - `private`: never leaves the server.
 * Typed as a full Record so adding a GameState field without classifying it fails to compile;
 * view.test.ts also checks the runtime keys of real states against it.
 */
export const STATE_VISIBILITY: Record<keyof GameState, 'public' | 'derived' | 'private'> = {
  version: 'public',
  engineVersion: 'private',
  config: 'public',
  rng: 'private',
  board: 'public',
  robber: 'public',
  buildings: 'public',
  roads: 'public',
  ships: 'public',
  pirate: 'public',
  islandBonus: 'public',
  players: 'derived',
  bank: 'public',
  devDeck: 'derived',
  setupOrder: 'public',
  turn: 'public',
  phase: 'public',
  trades: 'public',
  nextTradeId: 'private',
  longestRoad: 'public',
  largestArmy: 'public',
  winner: 'public',
};

/**
 * PlayerState fields: `public` for every viewer, `owner` only for the player themself (and for
 * everyone once the game is over).
 */
export const PLAYER_VISIBILITY: Record<keyof PlayerState, 'public' | 'owner'> = {
  seat: 'public',
  resources: 'owner',
  devCards: 'owner',
  newDevCards: 'owner',
  playedKnights: 'public',
  roadsLeft: 'public',
  settlementsLeft: 'public',
  citiesLeft: 'public',
  longestRoadLength: 'public',
  shipsLeft: 'public',
  bonusVP: 'public',
};

/**
 * Event types whose payload is redacted for some viewers. Every other event type is public.
 * Typed as a full Record so a new event type must be classified here to compile.
 */
export const EVENT_VISIBILITY: Record<GameEvent['type'], 'public' | 'redacted'> = {
  setupPlaced: 'public',
  setupResources: 'public',
  rolled: 'public',
  produced: 'public',
  discardRequired: 'public',
  discarded: 'public',
  robberMoved: 'public',
  stole: 'redacted',
  built: 'public',
  boughtDev: 'redacted',
  playedDev: 'public',
  monopoly: 'public',
  yearOfPlenty: 'public',
  maritimeTrade: 'public',
  tradeOffered: 'public',
  tradeResponded: 'public',
  traded: 'public',
  tradeCancelled: 'public',
  awardChanged: 'public',
  turnStarted: 'public',
  specialBuildTurn: 'public',
  shipMoved: 'public',
  pirateMoved: 'public',
  goldChosen: 'public',
  islandBonus: 'public',
  gameOver: 'public',
};

// Hand-written copies: several times cheaper than structuredClone on these small, known shapes,
// and still fully non-aliasing.

const copyBoard = (b: Board): Board => ({
  layoutId: b.layoutId,
  hexes: b.hexes.map((h) => ({ ...h })),
  ports: b.ports.map((p) => ({ ...p, vertices: [p.vertices[0], p.vertices[1]] })),
});

function copyBuildings(src: Record<VertexId, Building>): Record<VertexId, Building> {
  const out: Record<VertexId, Building> = {};
  for (const v of Object.keys(src)) out[v] = { ...src[v]! };
  return out;
}

const copyTrade = (t: TradeOffer): TradeOffer => ({
  ...t,
  give: { ...t.give },
  want: { ...t.want },
  to: t.to === null ? null : [...t.to],
  responses: { ...t.responses },
});

/** Exhaustive over Phase kinds: a new kind does not compile until it is copied here. */
function copyPhase(p: Phase): Phase {
  switch (p.kind) {
    case 'discard':
      return { kind: 'discard', pending: { ...p.pending } };
    case 'goldChoice':
      return { ...p, pending: { ...p.pending } };
    case 'steal':
      return { ...p, candidates: [...p.candidates] };
    case 'specialBuild':
      return { ...p, queue: [...p.queue] };
    // Flat phases: only primitive fields, so a spread is a full copy.
    case 'setup':
    case 'preRoll':
    case 'moveRobber':
    case 'main':
    case 'roadBuilding':
    case 'gameOver':
      return { ...p };
    default:
      // A new phase kind must be added above (and its nested data copied) to compile.
      return p satisfies never;
  }
}

/**
 * Redacted view for one viewer. NEVER includes: rng, devDeck order, opponents' hands or dev cards
 * (until game over). See STATE_VISIBILITY / PLAYER_VISIBILITY for the classification of every
 * field; every new GameState field must be classified there (see REVIEW_CHECKLIST.md).
 * The result shares no objects with `state`: consumers may mutate it freely.
 */
export function toPlayerView(state: GameState, viewer: Seat | null): PlayerView {
  const over = state.phase.kind === 'gameOver';
  const players: PublicPlayer[] = state.players.map((p) => {
    const pub: PublicPlayer = {
      seat: p.seat,
      resourceCount: totalResources(p.resources),
      devCardCount: p.devCards.length + p.newDevCards.length,
      playedKnights: p.playedKnights,
      roadsLeft: p.roadsLeft,
      settlementsLeft: p.settlementsLeft,
      citiesLeft: p.citiesLeft,
      longestRoadLength: p.longestRoadLength,
      shipsLeft: p.shipsLeft,
      bonusVP: p.bonusVP,
      publicVP: publicVP(state, p.seat),
    };
    if (over || p.seat === viewer) {
      pub.resources = { ...p.resources };
      pub.devCards = [...p.devCards];
      pub.newDevCards = [...p.newDevCards];
      pub.totalVP = totalVP(state, p.seat);
    }
    return pub;
  });

  return {
    viewer,
    version: state.version,
    config: { ...state.config },
    board: copyBoard(state.board),
    robber: state.robber,
    buildings: copyBuildings(state.buildings),
    roads: { ...state.roads },
    ships: { ...state.ships },
    pirate: state.pirate,
    islandBonus: Object.fromEntries(
      Object.entries(state.islandBonus).map(([k, seats]) => [k, [...seats]]),
    ),
    players,
    bank: { ...state.bank },
    devDeckCount: state.devDeck.length,
    setupOrder: [...state.setupOrder],
    turn: {
      ...state.turn,
      dice: state.turn.dice === null ? null : [state.turn.dice[0], state.turn.dice[1]],
      newShips: [...state.turn.newShips],
    },
    phase: copyPhase(state.phase),
    // Trade offers are public: every seat sees who offers what to whom and the responses.
    trades: state.trades.map(copyTrade),
    longestRoad: state.longestRoad,
    largestArmy: state.largestArmy,
    winner: state.winner,
    pendingActors: getPendingActors(state),
    legal: viewer === null || over ? null : getLegal(state, viewer),
  };
}

/** Redact an event for a viewer. Returns null if the viewer must not see it at all. */
export function redactEvent(e: GameEvent, viewer: Seat | null): GameEvent | null {
  switch (e.type) {
    case 'stole':
      return viewer === e.thief || viewer === e.victim ? e : { ...e, resource: null };
    case 'boughtDev':
      return viewer === e.seat ? e : { ...e, card: null };
    default:
      // Fail closed: an event classified 'redacted' without a case above is hidden entirely.
      return EVENT_VISIBILITY[e.type] === 'public' ? e : null;
  }
}
