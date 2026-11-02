import type { ActionType, EdgeId, HexId, PlayerView, VertexId } from '@hexhaven/engine';

export type BuildMode = 'buildRoad' | 'buildSettlement' | 'buildCity';
export type UiMode = BuildMode | null;

export interface Highlights {
  vertexAction: 'PLACE_SETTLEMENT' | 'BUILD_SETTLEMENT' | 'BUILD_CITY' | null;
  vertices: VertexId[];
  edgeAction: 'PLACE_ROAD' | 'BUILD_ROAD' | null;
  edges: EdgeId[];
  hexes: HexId[];
}

const NONE: Highlights = {
  vertexAction: null,
  vertices: [],
  edgeAction: null,
  edges: [],
  hexes: [],
};

/** True if the viewer may submit `type` right now according to `view.legal`. */
export function canDo(view: PlayerView | null, type: ActionType): boolean {
  return !!view?.legal?.actions.includes(type);
}

/**
 * Which board spots are clickable, and which action a click submits.
 * Setup, road-building and robber placement are always highlighted when it is the viewer's move;
 * regular building requires the matching build mode.
 */
export function computeHighlights(view: PlayerView | null, mode: UiMode): Highlights {
  const legal = view?.legal;
  if (!view || !legal || view.viewer === null) return NONE;
  const myMove = view.pendingActors.includes(view.viewer);
  const phase = view.phase;
  const has = (t: ActionType) => legal.actions.includes(t);

  const out: Highlights = { ...NONE };

  const setupSettlement =
    phase.kind === 'setup' && phase.step === 'settlement' && myMove && has('PLACE_SETTLEMENT');
  const setupRoad = phase.kind === 'setup' && phase.step === 'road' && myMove && has('PLACE_ROAD');

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

  if (setupRoad) {
    out.edgeAction = 'PLACE_ROAD';
    out.edges = legal.roadEdges;
  } else if (
    has('BUILD_ROAD') &&
    ((phase.kind === 'roadBuilding' && myMove) || mode === 'buildRoad')
  ) {
    out.edgeAction = 'BUILD_ROAD';
    out.edges = legal.roadEdges;
  }

  if (has('MOVE_ROBBER')) out.hexes = legal.robberHexes;
  if (!out.vertexAction) out.vertices = [];
  if (!out.edgeAction) out.edges = [];
  return out;
}

/** Drop a build mode that no longer makes sense (turn passed, piece unaffordable, …). */
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
  }
}
