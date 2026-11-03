/**
 * ENGINE CONTRACT — frozen after M0. Changes require a dedicated "contract" PR (see CLAUDE.md).
 * All state is plain JSON (no Maps/Sets/classes) so it can be persisted, hashed and diffed.
 */
import type { RngState } from './rng';

// ---------------------------------------------------------------- primitives

export const RESOURCES = ['brick', 'lumber', 'wool', 'grain', 'ore'] as const;
export type Resource = (typeof RESOURCES)[number];
export type ResourceCounts = Record<Resource, number>;

export type Terrain =
  | 'hills' // brick
  | 'forest' // lumber
  | 'pasture' // wool
  | 'fields' // grain
  | 'mountains' // ore
  | 'desert'
  // Open Seas (variant 'seafarers'): sea carries ships and no token; gold carries a token and
  // yields a resource of the owner's choice.
  | 'sea'
  | 'gold';

export const TERRAIN_RESOURCE: Partial<Record<Terrain, Resource>> = {
  hills: 'brick',
  forest: 'lumber',
  pasture: 'wool',
  fields: 'grain',
  mountains: 'ore',
};

/** Seat index 0..5 in turn order. */
export type Seat = number;
/** "q,r" axial coordinates (pointy-top). */
export type HexId = string;
/** Canonical vertex id "q,r,N" | "q,r,S". */
export type VertexId = string;
/** Canonical edge id "q,r,NE" | "q,r,NW" | "q,r,W". */
export type EdgeId = string;

export type DevCardType = 'knight' | 'victoryPoint' | 'roadBuilding' | 'yearOfPlenty' | 'monopoly';
export const DEV_CARD_TYPES: readonly DevCardType[] = [
  'knight',
  'victoryPoint',
  'roadBuilding',
  'yearOfPlenty',
  'monopoly',
];

export type PortType = Resource | 'any';

// ---------------------------------------------------------------- board

export interface Hex {
  id: HexId;
  q: number;
  r: number;
  terrain: Terrain;
  /** Number token 2..12 (never 7), null for desert/sea. Gold hexes carry a token. */
  token: number | null;
}

export interface Port {
  type: PortType;
  /** Coastal edge the port sits on (land|sea on sea-framed boards). Both endpoints get the port. */
  edge: EdgeId;
  vertices: [VertexId, VertexId];
}

export interface Board {
  layoutId: string;
  hexes: Hex[];
  ports: Port[];
  /**
   * Home islands (indices into graphFor(board).islandOf): setup settlements go only there. Every
   * island when the layout names none, so [0] on base/ext56 boards.
   */
  homeIslands: number[];
  /** VP for a player's first settlement on each non-home island; 0 without islands. */
  islandBonusVP: number;
}

// ---------------------------------------------------------------- config

/** 'seafarers' is the Open Seas variant: sea-framed scenario boards, ships, pirate, gold. */
export type VariantId = 'base' | 'ext56' | 'seafarers';
/** 'random' = shuffled tokens with no adjacent 6/8; 'spiral' = official A–R spiral (base only). */
export type NumberMode = 'random' | 'spiral';
/** 'fixed' = standard port slots with shuffled types; 'random' = random coastal slots. */
export type PortMode = 'fixed' | 'random';

export interface GameConfig {
  variant: VariantId;
  /** 3..6. ext56 is required for 5-6. */
  players: number;
  vpToWin: number;
  /** Players holding MORE than this many cards discard half on a 7. Default 7. */
  discardLimit: number;
  numberMode: NumberMode;
  portMode: PortMode;
  /**
   * Scenario id (a key of `VariantDef.scenarios`) for variants that have scenarios ('seafarers').
   * normalizeConfig fills the default for the player count; ignored (and dropped) otherwise.
   */
  scenario?: string;
}

export const DEFAULT_CONFIG: Omit<GameConfig, 'players' | 'variant'> = {
  vpToWin: 10,
  discardLimit: 7,
  numberMode: 'random',
  portMode: 'fixed',
};

// ---------------------------------------------------------------- pieces & players

export interface Building {
  owner: Seat;
  kind: 'settlement' | 'city';
}

export interface PlayerState {
  seat: Seat;
  resources: ResourceCounts;
  /** Dev cards that can be played (bought on an earlier turn). VP cards stay here too. */
  devCards: DevCardType[];
  /** Dev cards bought during the current turn (not yet playable). Merged into devCards at END_TURN. */
  newDevCards: DevCardType[];
  playedKnights: number;
  roadsLeft: number;
  settlementsLeft: number;
  citiesLeft: number;
  /**
   * Cached longest-trail length for this player (recomputed after every road/settlement). With
   * ships this is the trade-route length (roads and ships together).
   */
  longestRoadLength: number;
  /** Ships in supply. 0 in variants without ships. */
  shipsLeft: number;
  /** VP from island bonuses (public). 0 in variants without islands. */
  bonusVP: number;
}

// ---------------------------------------------------------------- trading

export interface TradeOffer {
  id: number;
  from: Seat;
  /** What `from` gives. */
  give: ResourceCounts;
  /** What `from` wants in return. */
  want: ResourceCounts;
  /** Restrict to these seats; null = everyone else. */
  to: Seat[] | null;
  /** Response per eligible seat. */
  responses: Record<string, 'pending' | 'accept' | 'reject'>;
  /** If this is a counter-offer, the id of the offer it counters. */
  counterTo: number | null;
}

// ---------------------------------------------------------------- phases

export type Phase =
  | {
      kind: 'setup';
      /** Index into setupOrder (snake: 0..n-1, n-1..0). */
      index: number;
      step: 'settlement' | 'road';
      /** Settlement just placed in this step pair; the road must touch it. */
      lastSettlement: VertexId | null;
    }
  | { kind: 'preRoll' }
  | {
      kind: 'discard';
      /** seat (as string key) -> number of cards still to discard. */
      pending: Record<string, number>;
    }
  | {
      kind: 'moveRobber';
      returnTo: 'preRoll' | 'main';
      /** The mover may move the pirate (MOVE_PIRATE) instead of the robber. False without sea. */
      allowPirate: boolean;
    }
  | {
      kind: 'steal';
      candidates: Seat[];
      returnTo: 'preRoll' | 'main';
      /** Robber: candidates own a building on the hex. Pirate: a ship on one of its edges. */
      via: 'robber' | 'pirate';
    }
  | { kind: 'main' }
  | { kind: 'roadBuilding'; remaining: number }
  | {
      kind: 'specialBuild';
      /** Seat currently allowed to build. */
      seat: Seat;
      /** Seats still to go after `seat`, in order. */
      queue: Seat[];
    }
  | {
      kind: 'goldChoice';
      /**
       * seat (as string key) -> number of resources still to choose from gold hexes. Every listed
       * seat chooses at the same time (like discard); the phase ends when all are done.
       */
      pending: Record<string, number>;
      /**
       * The exact phase to restore once every choice is made: `main` after a production roll,
       * the next `setup` step (index/step/lastSettlement) or `preRoll` after a second setup
       * settlement next to gold.
       */
      resume: Extract<Phase, { kind: 'setup' | 'preRoll' | 'main' }>;
    }
  | { kind: 'gameOver'; winner: Seat };

export type PhaseKind = Phase['kind'];

// ---------------------------------------------------------------- state

export interface TurnState {
  /** Active player (the one whose turn it is; during specialBuild still the player who just ended). */
  current: Seat;
  /** 1-based turn counter, counting from the first regular turn after setup. 0 during setup. */
  number: number;
  /** Last dice roll of this turn, null before rolling. */
  dice: [number, number] | null;
  /** A dev card has been played this turn. */
  devPlayed: boolean;
  /** A ship has been moved this turn (at most one MOVE_SHIP per turn). */
  shipMoved: boolean;
  /** Ships placed this turn; they cannot be moved until a later turn. */
  newShips: EdgeId[];
}

export interface GameState {
  /** Increments on every successful action. Used for optimistic concurrency. */
  version: number;
  engineVersion: number;
  config: GameConfig;
  rng: RngState;
  board: Board;
  robber: HexId;
  buildings: Record<VertexId, Building>;
  roads: Record<EdgeId, Seat>;
  /** Ships by edge. Empty in variants without ships. */
  ships: Record<EdgeId, Seat>;
  /** Sea hex the pirate sits on; null on boards without sea. */
  pirate: HexId | null;
  /** Island index (BoardGraph.islandOf, as string key) -> seats that already got its bonus. */
  islandBonus: Record<string, Seat[]>;
  players: PlayerState[];
  bank: ResourceCounts;
  /** Remaining dev deck, top = last element. Hidden. */
  devDeck: DevCardType[];
  setupOrder: Seat[];
  turn: TurnState;
  phase: Phase;
  trades: TradeOffer[];
  nextTradeId: number;
  longestRoad: Seat | null;
  largestArmy: Seat | null;
  winner: Seat | null;
}

// ---------------------------------------------------------------- actions

export type Action =
  | { type: 'PLACE_SETTLEMENT'; vertex: VertexId }
  | { type: 'PLACE_ROAD'; edge: EdgeId }
  | { type: 'ROLL' }
  | { type: 'DISCARD'; resources: ResourceCounts }
  | { type: 'MOVE_ROBBER'; hex: HexId }
  | { type: 'STEAL'; victim: Seat }
  | { type: 'BUILD_ROAD'; edge: EdgeId }
  | { type: 'BUILD_SETTLEMENT'; vertex: VertexId }
  | { type: 'BUILD_CITY'; vertex: VertexId }
  | { type: 'BUY_DEV' }
  | { type: 'PLAY_KNIGHT' }
  | { type: 'PLAY_ROAD_BUILDING' }
  | { type: 'PLAY_YEAR_OF_PLENTY'; resources: [Resource, Resource] }
  | { type: 'PLAY_MONOPOLY'; resource: Resource }
  /** Trade `ratio` of `give` (ratio determined by ports: 4, 3 or 2) for 1 `get`. */
  | { type: 'MARITIME_TRADE'; give: Resource; get: Resource }
  | {
      type: 'OFFER_TRADE';
      give: ResourceCounts;
      want: ResourceCounts;
      to: Seat[] | null;
      counterTo: number | null;
    }
  | { type: 'RESPOND_TRADE'; offerId: number; response: 'accept' | 'reject' }
  /** Offer creator finalises with a seat that accepted. */
  | { type: 'CONFIRM_TRADE'; offerId: number; with: Seat }
  | { type: 'CANCEL_TRADE'; offerId: number }
  | { type: 'END_TURN' }
  | { type: 'PASS_SPECIAL_BUILD' }
  // Open Seas ('seafarers'):
  /** Setup: the piece after a settlement may be a ship instead of a road. */
  | { type: 'PLACE_SHIP'; edge: EdgeId }
  /** Build a ship (main / specialBuild), or place a free one during roadBuilding. */
  | { type: 'BUILD_SHIP'; edge: EdgeId }
  /** Move the open-ended ship on `from` to `to` (once per turn, after rolling). */
  | { type: 'MOVE_SHIP'; from: EdgeId; to: EdgeId }
  /** In moveRobber with allowPirate: move the pirate to a sea hex instead of the robber. */
  | { type: 'MOVE_PIRATE'; hex: HexId }
  /** In goldChoice: the resources picked; total must equal the seat's pending count. */
  | { type: 'CHOOSE_GOLD'; resources: ResourceCounts };

export type ActionType = Action['type'];

// ---------------------------------------------------------------- events (for log/animation)

export type GameEvent =
  | { type: 'setupPlaced'; seat: Seat; kind: 'settlement' | 'road' | 'ship'; at: string }
  /** `gold`: resources still to choose from adjacent gold hexes (goldChoice follows); absent if 0. */
  | { type: 'setupResources'; seat: Seat; resources: ResourceCounts; gold?: number }
  | { type: 'rolled'; seat: Seat; dice: [number, number]; total: number }
  /**
   * Per-seat gains from a production roll. Keys are seats as strings. `gold`: gold-hex yields
   * each seat must still choose (goldChoice phase follows); absent when there are none.
   */
  | { type: 'produced'; gains: Record<string, ResourceCounts>; gold?: Record<string, number> }
  | { type: 'discardRequired'; pending: Record<string, number> }
  | { type: 'discarded'; seat: Seat; resources: ResourceCounts }
  | { type: 'robberMoved'; seat: Seat; hex: HexId }
  /** `resource` is null in views of players other than thief and victim. */
  | { type: 'stole'; thief: Seat; victim: Seat; resource: Resource | null }
  | { type: 'built'; seat: Seat; kind: 'road' | 'settlement' | 'city' | 'ship'; at: string }
  /** `card` is null in views of other players. */
  | { type: 'boughtDev'; seat: Seat; card: DevCardType | null }
  | { type: 'playedDev'; seat: Seat; card: DevCardType }
  | { type: 'monopoly'; seat: Seat; resource: Resource; taken: Record<string, number> }
  | { type: 'yearOfPlenty'; seat: Seat; resources: [Resource, Resource] }
  | { type: 'maritimeTrade'; seat: Seat; give: Resource; giveCount: number; get: Resource }
  | { type: 'tradeOffered'; offer: TradeOffer }
  | { type: 'tradeResponded'; offerId: number; seat: Seat; response: 'accept' | 'reject' }
  | {
      type: 'traded';
      offerId: number;
      a: Seat;
      b: Seat;
      aGave: ResourceCounts;
      bGave: ResourceCounts;
    }
  | { type: 'tradeCancelled'; offerId: number }
  | { type: 'awardChanged'; award: 'longestRoad' | 'largestArmy'; holder: Seat | null }
  | { type: 'turnStarted'; seat: Seat; turn: number }
  | { type: 'specialBuildTurn'; seat: Seat }
  | { type: 'shipMoved'; seat: Seat; from: EdgeId; to: EdgeId }
  | { type: 'pirateMoved'; seat: Seat; hex: HexId }
  | { type: 'goldChosen'; seat: Seat; resources: ResourceCounts }
  /** First settlement of `seat` on a non-home island (BoardGraph.islandOf index). */
  | { type: 'islandBonus'; seat: Seat; island: number; vp: number }
  | { type: 'gameOver'; winner: Seat; vp: number[] };

// ---------------------------------------------------------------- results & errors

export type EngineErrorCode =
  | 'NOT_YOUR_TURN'
  | 'WRONG_PHASE'
  | 'ILLEGAL_LOCATION'
  | 'INSUFFICIENT_RESOURCES'
  | 'NO_PIECES_LEFT'
  | 'BANK_EMPTY'
  | 'DECK_EMPTY'
  | 'DEV_CARD_NOT_PLAYABLE'
  | 'INVALID_TRADE'
  | 'INVALID_ACTION'
  | 'GAME_OVER'
  | 'NOT_IMPLEMENTED';

export interface EngineError {
  code: EngineErrorCode;
  message: string;
}

export type ApplyResult =
  { ok: true; state: GameState; events: GameEvent[] } | { ok: false; error: EngineError };

// ---------------------------------------------------------------- legal-move summary (UI highlights + bot)

export interface LegalSummary {
  /** Action types this seat may submit right now. */
  actions: ActionType[];
  /** Valid vertices for PLACE_SETTLEMENT / BUILD_SETTLEMENT (ignores affordability for BUILD_*: see canAfford). */
  settlementVertices: VertexId[];
  /** Valid edges for PLACE_ROAD / BUILD_ROAD / road-building. */
  roadEdges: EdgeId[];
  /** Own settlements that can be upgraded. */
  cityVertices: VertexId[];
  robberHexes: HexId[];
  stealVictims: Seat[];
  /** Cards this seat must discard (0 if none). */
  discardCount: number;
  /** Best maritime ratio per resource (4, 3 or 2). */
  maritimeRatios: ResourceCounts;
  /** Dev card types this seat could play now. */
  playableDev: DevCardType[];
  /** Valid edges for PLACE_SHIP / BUILD_SHIP (ignores affordability for BUILD_SHIP). */
  shipEdges: EdgeId[];
  /** Movable ship edge -> edges it may move to (MOVE_SHIP). */
  shipMoves: Record<EdgeId, EdgeId[]>;
  /** Valid hexes for MOVE_PIRATE. */
  pirateHexes: HexId[];
  /** Resources this seat must choose from gold (0 if none). */
  goldCount: number;
  /** Affordability only (pieces left and locations are in the lists above). */
  canAfford: {
    road: boolean;
    settlement: boolean;
    city: boolean;
    devCard: boolean;
    ship: boolean;
  };
}

// ---------------------------------------------------------------- redacted views

export interface PublicPlayer {
  seat: Seat;
  resourceCount: number;
  devCardCount: number;
  playedKnights: number;
  roadsLeft: number;
  settlementsLeft: number;
  citiesLeft: number;
  longestRoadLength: number;
  shipsLeft: number;
  /** Island-bonus VP (already included in publicVP). */
  bonusVP: number;
  /** VP visible to everyone (excludes hidden VP cards until game over). */
  publicVP: number;
  /** Only present for the viewer themself, or for everyone once the game is over. */
  resources?: ResourceCounts;
  devCards?: DevCardType[];
  newDevCards?: DevCardType[];
  /** Total VP incl. hidden cards; only for viewer or after game over. */
  totalVP?: number;
}

export interface PlayerView {
  viewer: Seat | null;
  version: number;
  config: GameConfig;
  board: Board;
  robber: HexId;
  buildings: Record<VertexId, Building>;
  roads: Record<EdgeId, Seat>;
  ships: Record<EdgeId, Seat>;
  pirate: HexId | null;
  islandBonus: Record<string, Seat[]>;
  players: PublicPlayer[];
  bank: ResourceCounts;
  devDeckCount: number;
  setupOrder: Seat[];
  turn: TurnState;
  phase: Phase;
  trades: TradeOffer[];
  longestRoad: Seat | null;
  largestArmy: Seat | null;
  winner: Seat | null;
  /** Seats that must/may act right now. */
  pendingActors: Seat[];
  /** Legal moves for the viewer (null for spectators). */
  legal: LegalSummary | null;
}
