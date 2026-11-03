/**
 * Open Seas parts of the /dev/board fixture: a demo position with ships, the pirate and an
 * island bonus, plus dialog "scenes" (gold choice, robber-or-pirate, pirate steal, setup ship).
 *
 * `seasLegal` hand-crafts the Open Seas fields of the legal summary (ship edges, ship moves,
 * pirate hexes, gold) ONLY while the engine's getLegal leaves them empty, so the UI can be
 * checked before the rules land. Real rules always come from the engine.
 */
import {
  COSTS,
  SCENARIO_IDS,
  graphFor,
  hasResources,
  type ActionType,
  type EdgeId,
  type GameState,
  type LegalSummary,
  type ScenarioId,
  type Seat,
  type VertexId,
} from '@hexhaven/engine';

export type DevScenario = ScenarioId;
export const DEV_SCENES = ['main', 'setup', 'gold', 'pirate', 'stealPirate'] as const;
export type DevScene = (typeof DEV_SCENES)[number];

export const isDevScenario = (v: string | null): v is DevScenario =>
  v !== null && (SCENARIO_IDS as readonly string[]).includes(v);
export const isDevScene = (v: string | null): v is DevScene =>
  v !== null && (DEV_SCENES as readonly string[]).includes(v);

function seaInfo(state: GameState) {
  const g = graphFor(state.board);
  const terrain = new Map(state.board.hexes.map((h) => [h.id, h.terrain]));
  const home = new Set(state.board.homeIslands);
  const sea = new Set(g.seaEdges);
  const hexesOf = (v: VertexId) => g.vertexHexes[v] ?? [];
  const islandsOf = (v: VertexId) =>
    hexesOf(v)
      .filter((h) => terrain.get(h) !== 'sea')
      .map((h) => g.islandOf[h]!);
  const coastal = (v: VertexId) =>
    hexesOf(v).some((h) => terrain.get(h) === 'sea') && islandsOf(v).length > 0;
  return { g, terrain, home, sea, islandsOf, coastal };
}

const free = (state: GameState, v: VertexId) => {
  const g = graphFor(state.board);
  return !state.buildings[v] && (g.vertexNeighbors[v] ?? []).every((u) => !state.buildings[u]);
};

/** Follow free sea edges from `from`, placing up to `count` ships for `seat`. */
function sail(state: GameState, seat: Seat, from: VertexId, count: number): void {
  const { g, sea } = seaInfo(state);
  let at = from;
  for (let i = 0; i < count; i++) {
    const e = (g.vertexEdges[at] ?? []).find(
      (x) => sea.has(x) && state.ships[x] === undefined && state.roads[x] === undefined,
    );
    if (!e) return;
    state.ships[e] = seat;
    state.players[seat]!.shipsLeft--;
    const [a, b] = g.edgeVertices[e]!;
    at = a === at ? b : a;
  }
}

/**
 * Mutates `state`: two coastal settlements per player on the home islands, each with a road and
 * a short line of ships, and one settlement of seat 0 on a new island with its bonus.
 */
export function placeSeasDemo(state: GameState): void {
  const { g, terrain, home, islandsOf, coastal } = seaInfo(state);
  const n = state.players.length;
  const homeCoast = g.landVertices.filter(
    (v) => coastal(v) && islandsOf(v).some((i) => home.has(i)),
  );
  const roadSet = new Set(g.roadEdges);

  for (let round = 0; round < 2; round++) {
    for (let seat = 0; seat < n; seat++) {
      const start = Math.floor(((round * n + seat) * homeCoast.length) / (2 * n));
      for (let i = 0; i < homeCoast.length; i++) {
        const v = homeCoast[(start + i) % homeCoast.length]!;
        if (!free(state, v)) continue;
        state.buildings[v] = { owner: seat, kind: 'settlement' };
        state.players[seat]!.settlementsLeft--;
        const roads = (g.vertexEdges[v] ?? []).filter(
          (e) => roadSet.has(e) && state.roads[e] === undefined && state.ships[e] === undefined,
        );
        // Prefer an inland road (both sides land) so the coast stays free for ships.
        const road =
          roads.find((e) => (g.edgeHexes[e] ?? []).every((h) => terrain.get(h) !== 'sea')) ??
          roads[0];
        if (road) {
          state.roads[road] = seat;
          state.players[seat]!.roadsLeft--;
        }
        sail(state, seat, v, seat === 0 && round === 0 ? 3 : round === 0 ? 2 : 1);
        break;
      }
    }
  }

  // Seat 0 has reached another island: settlement there plus the island bonus.
  const away = g.landVertices.find(
    (v) => free(state, v) && islandsOf(v).length > 0 && islandsOf(v).every((i) => !home.has(i)),
  );
  if (away && state.board.islandBonusVP > 0) {
    state.buildings[away] = { owner: 0, kind: 'settlement' };
    state.players[0]!.settlementsLeft--;
    state.players[0]!.bonusVP += state.board.islandBonusVP;
    state.islandBonus[String(islandsOf(away)[0]!)] = [0];
    sail(state, 0, away, 1);
  }
}

/** Put a populated (or, for 'setup', fresh) Open Seas game into one of the demo scenes. */
export function seasScene(state: GameState, scene: DevScene): GameState {
  const n = state.players.length;
  switch (scene) {
    case 'setup': {
      // First player has just placed a coastal settlement: next piece may be a road or a ship.
      const { g, home, islandsOf, coastal } = seaInfo(state);
      const seat = state.setupOrder[0]!;
      const v = g.landVertices.find((x) => coastal(x) && islandsOf(x).some((i) => home.has(i)));
      if (!v) return state;
      state.buildings[v] = { owner: seat, kind: 'settlement' };
      state.players[seat]!.settlementsLeft--;
      state.phase = { kind: 'setup', index: 0, step: 'road', lastSettlement: v };
      state.version = 1;
      return state;
    }
    case 'gold': {
      const pending: Record<string, number> = { '0': 2 };
      if (n > 2) pending['2'] = 1;
      state.phase = { kind: 'goldChoice', pending, resume: { kind: 'main' } };
      state.turn.dice = [2, 2];
      return state;
    }
    case 'pirate':
      state.phase = { kind: 'moveRobber', returnTo: 'main', allowPirate: true };
      state.turn.dice = [3, 4];
      return state;
    case 'stealPirate':
      state.phase = {
        kind: 'steal',
        candidates: Array.from({ length: n - 1 }, (_, i) => i + 1).slice(0, 2),
        returnTo: 'main',
        via: 'pirate',
      };
      state.turn.dice = [6, 1];
      return state;
    case 'main':
      return state;
  }
}

/** Approximate Open Seas legal fields, filled only where the engine's summary is still empty. */
export function seasLegal(state: GameState, seat: Seat, real: LegalSummary): LegalSummary {
  const { g, terrain, sea } = seaInfo(state);
  const p = state.players[seat]!;
  const phase = state.phase;
  const mine = state.turn.current === seat;
  const pirateEdges = new Set(state.pirate ? (g.hexEdges[state.pirate] ?? []) : []);
  const own = (v: VertexId) =>
    state.buildings[v]?.owner === seat ||
    (g.vertexEdges[v] ?? []).some((e) => state.ships[e] === seat);
  const openSea = (e: EdgeId) =>
    sea.has(e) &&
    state.ships[e] === undefined &&
    state.roads[e] === undefined &&
    !pirateEdges.has(e);

  let shipEdges = real.shipEdges;
  if (!shipEdges.length) {
    if (phase.kind === 'setup' && phase.step === 'road' && phase.lastSettlement) {
      const last = phase.lastSettlement;
      shipEdges = (g.vertexEdges[last] ?? []).filter(openSea);
    } else if (phase.kind !== 'setup') {
      shipEdges = g.seaEdges.filter((e) => openSea(e) && g.edgeVertices[e]!.some(own));
    }
  }

  let shipMoves = real.shipMoves;
  if (!Object.keys(shipMoves).length && mine && !state.turn.shipMoved && phase.kind === 'main') {
    shipMoves = {};
    for (const [e, s] of Object.entries(state.ships)) {
      if (s !== seat || state.turn.newShips.includes(e) || pirateEdges.has(e)) continue;
      // Open end: one endpoint has neither an own building nor another own ship.
      const openEnd = g.edgeVertices[e]!.some(
        (v) =>
          state.buildings[v]?.owner !== seat &&
          !(g.vertexEdges[v] ?? []).some((x) => x !== e && state.ships[x] === seat),
      );
      if (openEnd) shipMoves[e] = shipEdges.filter((x) => x !== e);
    }
  }

  const pirateHexes = real.pirateHexes.length
    ? real.pirateHexes
    : phase.kind === 'moveRobber' && phase.allowPirate && mine
      ? state.board.hexes
          .filter((h) => terrain.get(h.id) === 'sea' && h.id !== state.pirate)
          .map((h) => h.id)
      : [];

  const goldCount =
    real.goldCount || (phase.kind === 'goldChoice' ? (phase.pending[String(seat)] ?? 0) : 0);

  const actions = new Set<ActionType>(real.actions);
  if (phase.kind === 'main' && mine) {
    actions.add('BUILD_SHIP');
    if (Object.keys(shipMoves).length) actions.add('MOVE_SHIP');
  }
  if (phase.kind === 'roadBuilding' && mine && shipEdges.length) actions.add('BUILD_SHIP');
  if (phase.kind === 'setup' && phase.step === 'road' && shipEdges.length) {
    if (actions.has('PLACE_ROAD')) actions.add('PLACE_SHIP');
  }
  if (pirateHexes.length) actions.add('MOVE_PIRATE');
  if (goldCount > 0) actions.add('CHOOSE_GOLD');

  // Until the engine knows the robber stays on land, keep the fixture's targets realistic.
  const robberHexes = real.robberHexes.filter((h) => terrain.get(h) !== 'sea');

  return {
    ...real,
    robberHexes,
    actions: [...actions],
    shipEdges: mine || phase.kind === 'setup' ? shipEdges : [],
    shipMoves,
    pirateHexes,
    goldCount,
    canAfford: {
      ...real.canAfford,
      ship: real.canAfford.ship || (hasResources(p.resources, COSTS.ship) && p.shipsLeft > 0),
    },
  };
}
