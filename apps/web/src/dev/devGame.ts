/**
 * Local, server-less game used by the /dev/board route: a real engine game, optionally populated
 * with a mid-game "demo" position so every board element and panel can be checked visually.
 */
import {
  COSTS,
  RESOURCES,
  applyAction,
  createGame,
  getLegal,
  graphFor,
  hasResources,
  normalizeConfig,
  redactEvent,
  resourcesOf,
  toPlayerView,
  type Action,
  type ActionType,
  type DevCardType,
  type GameEvent,
  type GameState,
  type LegalSummary,
  type PlayerView,
  type ResourceCounts,
  type Seat,
} from '@hexhaven/engine';
import type { GameStatePayload, RoomInfo, SeatInfo } from '@hexhaven/shared';
import { seatColor } from '../game/colors';

export const DEV_NAMES = ['Alice', 'Bruno', 'Chen', 'Dana', 'Emeka', 'Freya'];

export function createDevGame(players: number, seed: string, demo: boolean): GameState {
  const state = createGame(normalizeConfig({ players }), seed);
  return demo ? populateDemo(state) : state;
}

function take(state: GameState, seat: Seat, r: Partial<ResourceCounts>): void {
  const full = resourcesOf(r);
  for (const k of RESOURCES) {
    const n = Math.min(full[k], state.bank[k]);
    state.players[seat]!.resources[k] += n;
    state.bank[k] -= n;
  }
}

/** Mutates and returns `state`: two settlements + roads per player, cards, an open trade. */
export function populateDemo(state: GameState): GameState {
  const g = graphFor(state.board);
  const n = state.players.length;
  const free = (v: string) =>
    !state.buildings[v] && (g.vertexNeighbors[v] ?? []).every((u) => !state.buildings[u]);
  const vertices = [...g.vertices];

  for (let round = 0; round < 2; round++) {
    for (let seat = 0; seat < n; seat++) {
      const start = Math.floor(((round * n + seat) * vertices.length) / (2 * n));
      for (let i = 0; i < vertices.length; i++) {
        const v = vertices[(start + i) % vertices.length]!;
        if (!free(v)) continue;
        state.buildings[v] = { owner: seat, kind: 'settlement' };
        state.players[seat]!.settlementsLeft--;
        let at = v;
        for (let len = 0; len < (seat === 0 && round === 0 ? 3 : 1); len++) {
          const e = (g.vertexEdges[at] ?? []).find((x) => state.roads[x] === undefined);
          if (!e) break;
          state.roads[e] = seat;
          state.players[seat]!.roadsLeft--;
          const [a, b] = g.edgeVertices[e]!;
          at = a === at ? b : a;
        }
        break;
      }
    }
  }
  const firstOwn = Object.entries(state.buildings).find(([, b]) => b.owner === 0);
  if (firstOwn) {
    firstOwn[1].kind = 'city';
    state.players[0]!.citiesLeft--;
    state.players[0]!.settlementsLeft++;
  }

  take(state, 0, { brick: 2, lumber: 3, wool: 1, grain: 3, ore: 3 });
  for (let s = 1; s < n; s++) take(state, s, { brick: s % 3, wool: 2, grain: (s + 1) % 4, ore: 1 });

  const deal = (seat: Seat, cards: DevCardType[], fresh: DevCardType[] = []) => {
    const p = state.players[seat]!;
    p.devCards.push(...cards);
    p.newDevCards.push(...fresh);
    state.devDeck.splice(0, cards.length + fresh.length);
  };
  deal(0, ['knight', 'monopoly', 'victoryPoint'], ['yearOfPlenty']);
  deal(1, ['knight', 'knight']);
  state.players[1]!.playedKnights = 3;
  state.largestArmy = 1;

  const robberHex = state.board.hexes.find((h) => h.token === 8) ?? state.board.hexes[0]!;
  state.robber = robberHex.id;

  state.phase = { kind: 'main' };
  state.turn = {
    current: 0,
    number: 7,
    dice: [3, 5],
    devPlayed: false,
    shipMoved: false,
    newShips: [],
  };
  const responses: Record<string, 'pending' | 'accept' | 'reject'> = {};
  for (let s = 1; s < n; s++)
    responses[String(s)] = s === 1 ? 'accept' : s === 2 ? 'reject' : 'pending';
  state.trades = [
    {
      id: 1,
      from: 0,
      give: resourcesOf({ lumber: 1 }),
      want: resourcesOf({ ore: 1 }),
      to: null,
      responses,
      counterTo: null,
    },
  ];
  state.nextTradeId = 2;
  state.version = 12;
  return state;
}

const MAIN_ACTIONS: ActionType[] = [
  'BUILD_ROAD',
  'BUILD_SETTLEMENT',
  'BUILD_CITY',
  'BUY_DEV',
  'MARITIME_TRADE',
  'OFFER_TRADE',
  'CONFIRM_TRADE',
  'CANCEL_TRADE',
  'END_TURN',
  'PLAY_KNIGHT',
  'PLAY_MONOPOLY',
  'PLAY_YEAR_OF_PLENTY',
  'PLAY_ROAD_BUILDING',
];

/**
 * Approximate legal summary used ONLY in demo mode while the engine's getLegal is still a stub,
 * so highlights and enabled controls can be checked visually. Real rules come from the engine.
 */
export function approximateLegal(state: GameState, seat: Seat): LegalSummary {
  const real = getLegal(state, seat);
  if (real.actions.length > 0 || state.phase.kind !== 'main') return real;
  const g = graphFor(state.board);
  const p = state.players[seat]!;
  const mine = state.turn.current === seat;
  const touchesOwn = (v: string) =>
    state.buildings[v]?.owner === seat ||
    (g.vertexEdges[v] ?? []).some((e) => state.roads[e] === seat);

  const settlementVertices = g.vertices.filter(
    (v) =>
      !state.buildings[v] &&
      (g.vertexNeighbors[v] ?? []).every((u) => !state.buildings[u]) &&
      (g.vertexEdges[v] ?? []).some((e) => state.roads[e] === seat),
  );
  const roadEdges = g.edges.filter(
    (e) => state.roads[e] === undefined && g.edgeVertices[e]!.some(touchesOwn),
  );
  const cityVertices = Object.entries(state.buildings)
    .filter(([, b]) => b.owner === seat && b.kind === 'settlement')
    .map(([v]) => v);

  const ratios = resourcesOf({ brick: 4, lumber: 4, wool: 4, grain: 4, ore: 4 });
  for (const port of state.board.ports) {
    if (!port.vertices.some((v) => state.buildings[v]?.owner === seat)) continue;
    if (port.type === 'any') for (const r of RESOURCES) ratios[r] = Math.min(ratios[r], 3);
    else ratios[port.type] = 2;
  }
  const playable = state.turn.devPlayed
    ? []
    : [...new Set(p.devCards.filter((c) => c !== 'victoryPoint'))];
  const offeredToMe = state.trades.some((t) => t.responses[String(seat)] === 'pending');

  return {
    ...real,
    actions: mine ? MAIN_ACTIONS : offeredToMe ? ['RESPOND_TRADE', 'OFFER_TRADE'] : [],
    settlementVertices: mine ? settlementVertices : [],
    roadEdges: mine ? roadEdges : [],
    cityVertices: mine ? cityVertices : [],
    maritimeRatios: ratios,
    playableDev: mine ? playable : [],
    canAfford: {
      road: hasResources(p.resources, COSTS.road),
      settlement: hasResources(p.resources, COSTS.settlement),
      city: hasResources(p.resources, COSTS.city),
      devCard: hasResources(p.resources, COSTS.devCard),
      ship: false,
    },
  };
}

export function devView(state: GameState, seat: Seat, demo: boolean): PlayerView {
  const view = toPlayerView(state, seat);
  if (demo && view.legal) view.legal = approximateLegal(state, seat);
  return view;
}

export function devPayload(
  state: GameState,
  seat: Seat,
  demo: boolean,
  events: GameEvent[],
  gameId: string,
): GameStatePayload {
  const now = Date.now();
  return {
    roomId: 'dev',
    gameId,
    version: state.version,
    view: devView(state, seat, demo),
    events: events.map((e) => redactEvent(e, seat)).filter((e): e is GameEvent => e !== null),
    deadline: now + 90_000,
    serverNow: now,
  };
}

export function devRoom(players: number): RoomInfo {
  const seats: SeatInfo[] = Array.from({ length: players }, (_, i) => ({
    index: i,
    kind: i === 0 ? 'human' : i % 2 ? 'bot' : 'human',
    userId: `dev-${i}`,
    name: DEV_NAMES[i]!,
    avatarUrl: null,
    color: seatColor(i),
    ready: true,
    connected: i !== 2,
    controller: i === 0 || i % 2 === 0 ? 'human' : 'bot',
    botDifficulty: 'normal',
    inVoice: i < 3,
    muted: i === 1,
  }));
  return {
    id: 'dev',
    code: 'DEV000',
    hostUserId: 'dev-0',
    status: 'in_game',
    settings: {
      maxSeats: players,
      variant: 'auto',
      vpToWin: 10,
      discardLimit: 7,
      numberMode: 'random',
      portMode: 'fixed',
      turnTimerSec: 90,
    },
    seats,
    gameId: 'dev-game',
    paused: false,
    spectators: [],
  };
}

export type DevApplyResult =
  { ok: true; state: GameState; events: GameEvent[] } | { ok: false; message: string };

export function devApply(state: GameState, seat: Seat, action: Action): DevApplyResult {
  const res = applyAction(state, seat, action);
  return res.ok
    ? { ok: true, state: res.state, events: res.events }
    : { ok: false, message: `${res.error.code}: ${res.error.message}` };
}
