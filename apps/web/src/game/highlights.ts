import type { ActionType, EdgeId, HexId, PlayerView, VertexId } from '@hexhaven/engine';

export type BuildMode = 'buildRoad' | 'buildSettlement' | 'buildCity' | 'buildShip';
/** 'moveShip': pick one of your movable ships, then where it goes (Open Seas). */
export type UiMode = BuildMode | 'moveShip' | null;
/** Which piece a free/setup placement uses when both a road and a ship are possible. */
export type Piece = 'road' | 'ship';

export type EdgeAction = 'PLACE_ROAD' | 'BUILD_ROAD' | 'PLACE_SHIP' | 'BUILD_SHIP' | 'MOVE_SHIP';
export type HexAction = 'MOVE_ROBBER' | 'MOVE_PIRATE';

export interface Highlights {
  vertexAction: 'PLACE_SETTLEMENT' | 'BUILD_SETTLEMENT' | 'BUILD_CITY' | null;
  vertices: VertexId[];
  edgeAction: EdgeAction | null;
  edges: EdgeId[];
  /** Robber targets (MOVE_ROBBER). */
  hexes: HexId[];
  /** Pirate targets (MOVE_PIRATE); disjoint from `hexes` (sea vs land). */
  pirateHexes: HexId[];
  /** Own ships that may be picked for a move (moveShip mode, before one is chosen). */
  ships: EdgeId[];
  /** The ship being moved (MOVE_SHIP `from`), once picked. */
  shipFrom: EdgeId | null;
  /**
   * The pieces the viewer may choose between for this placement (setup's second piece, free
   * Road Building pieces). Two entries mean the UI offers a road/ship toggle.
   */
  pieces: Piece[];
}

const NONE: Highlights = {
  vertexAction: null,
  vertices: [],
  edgeAction: null,
  edges: [],
  hexes: [],
  pirateHexes: [],
  ships: [],
  shipFrom: null,
  pieces: [],
};

export interface HighlightOptions {
  /** Preferred piece when both a road and a ship may be placed (default: road). */
  piece?: Piece;
  /** Ship picked in moveShip mode. */
  shipFrom?: EdgeId | null;
}

/** True if the viewer may submit `type` right now according to `view.legal`. */
export function canDo(view: PlayerView | null, type: ActionType): boolean {
  return !!view?.legal?.actions.includes(type);
}

/** Own ships that can move this turn (keys of `legal.shipMoves` with somewhere to go). */
export function movableShips(view: PlayerView | null): EdgeId[] {
  const moves = view?.legal?.shipMoves ?? {};
  return Object.keys(moves).filter((e) => (moves[e]?.length ?? 0) > 0);
}

/**
 * Which board spots are clickable, and which action a click submits.
 * Setup, road-building and robber/pirate placement are always highlighted when it is the
 * viewer's move; regular building and ship moves require the matching UI mode.
 */
export function computeHighlights(
  view: PlayerView | null,
  mode: UiMode,
  opts: HighlightOptions = {},
): Highlights {
  const legal = view?.legal;
  if (!view || !legal || view.viewer === null) return NONE;
  const myMove = view.pendingActors.includes(view.viewer);
  const phase = view.phase;
  const has = (t: ActionType) => legal.actions.includes(t);

  const out: Highlights = { ...NONE };

  const setupSettlement =
    phase.kind === 'setup' && phase.step === 'settlement' && myMove && has('PLACE_SETTLEMENT');

  if (setupSettlement) {
    out.vertexAction = 'PLACE_SETTLEMENT';
    out.vertices = legal.settlementVertices;
  } else if (mode === 'buildSettlement' && has('BUILD_SETTLEMENT')) {
    out.vertexAction = 'BUILD_SETTLEMENT';
    out.vertices = legal.settlementVertices;
  } else if (mode === 'buildCity' && has('BUILD_CITY')) {
    out.vertexAction = 'BUILD_CITY';
    out.vertices = legal.cityVertices;
  }

  // A placement that may be a road or a ship: offer whichever has spots, prefer `opts.piece`.
  const roadOrShip = (road: 'PLACE_ROAD' | 'BUILD_ROAD', ship: 'PLACE_SHIP' | 'BUILD_SHIP') => {
    const canRoad = has(road) && legal.roadEdges.length > 0;
    const canShip = has(ship) && legal.shipEdges.length > 0;
    out.pieces = canRoad && canShip ? ['road', 'ship'] : canShip ? ['ship'] : ['road'];
    const useShip = canShip && (!canRoad || opts.piece === 'ship');
    if (useShip) {
      out.edgeAction = ship;
      out.edges = legal.shipEdges;
    } else if (has(road)) {
      out.edgeAction = road;
      out.edges = legal.roadEdges;
    } else {
      out.pieces = [];
    }
  };

  if (phase.kind === 'setup' && phase.step === 'road' && myMove) {
    roadOrShip('PLACE_ROAD', 'PLACE_SHIP');
  } else if (phase.kind === 'roadBuilding' && myMove) {
    roadOrShip('BUILD_ROAD', 'BUILD_SHIP');
  } else if (mode === 'buildRoad' && has('BUILD_ROAD')) {
    out.edgeAction = 'BUILD_ROAD';
    out.edges = legal.roadEdges;
  } else if (mode === 'buildShip' && has('BUILD_SHIP')) {
    out.edgeAction = 'BUILD_SHIP';
    out.edges = legal.shipEdges;
  } else if (mode === 'moveShip' && has('MOVE_SHIP')) {
    const from = opts.shipFrom ?? null;
    const targets = from ? legal.shipMoves[from] : undefined;
    if (from && targets?.length) {
      out.edgeAction = 'MOVE_SHIP';
      out.edges = targets;
      out.shipFrom = from;
    }
    out.ships = movableShips(view);
  }

  if (has('MOVE_ROBBER')) out.hexes = legal.robberHexes;
  if (has('MOVE_PIRATE')) out.pirateHexes = legal.pirateHexes;
  if (!out.vertexAction) out.vertices = [];
  if (!out.edgeAction) out.edges = [];
  return out;
}

/** Drop a UI mode that no longer makes sense (turn passed, piece unaffordable, …). */
export function sanitizeMode(view: PlayerView | null, mode: UiMode): UiMode {
  if (!mode || !view?.legal) return null;
  const { actions, canAfford } = view.legal;
  switch (mode) {
    case 'buildRoad':
      return actions.includes('BUILD_ROAD') && canAfford.road ? mode : null;
    case 'buildSettlement':
      return actions.includes('BUILD_SETTLEMENT') && canAfford.settlement ? mode : null;
    case 'buildCity':
      return actions.includes('BUILD_CITY') && canAfford.city ? mode : null;
    case 'buildShip':
      return actions.includes('BUILD_SHIP') && canAfford.ship ? mode : null;
    case 'moveShip':
      return actions.includes('MOVE_SHIP') && movableShips(view).length > 0 ? mode : null;
  }
}

/** Keep a picked ship only while it is still movable in move mode. */
export function sanitizeShipFrom(
  view: PlayerView | null,
  mode: UiMode,
  from: EdgeId | null,
): EdgeId | null {
  if (mode !== 'moveShip' || !from) return null;
  return movableShips(view).includes(from) ? from : null;
}
