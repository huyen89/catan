import { err, type Ctx, type Handler, type HandlerMap } from '../context';
import type { BoardGraph } from '../hex/topology';
import {
  type DevCardType,
  type EdgeId,
  type EngineError,
  type GameState,
  type PhaseKind,
  type Resource,
  type ResourceCounts,
  type Seat,
} from '../types';
import { updateLargestArmy } from './awards';
import { expectSeat, isResource, withVictoryCheck } from './flow';
import { buildableRoadEdges } from './placement';

type PlayableDev = Exclude<DevCardType, 'victoryPoint'>;

/** Phases in which each dev card may be played (RULES.md#turn: only the knight before rolling). */
const PLAY_PHASES: Record<PlayableDev, PhaseKind[]> = {
  knight: ['preRoll', 'main'],
  roadBuilding: ['main'],
  yearOfPlenty: ['main'],
  monopoly: ['main'],
};

/** Can the bank pay out these two resources? */
export function bankCanPay(bank: ResourceCounts, [a, b]: [Resource, Resource]): boolean {
  return a === b ? bank[a] >= 2 : bank[a] >= 1 && bank[b] >= 1;
}

/** Card types `seat` could play right now (ignores payload validity, e.g. an empty bank for YoP). */
export function playableDevCards(state: GameState, seat: Seat): PlayableDev[] {
  if (seat !== state.turn.current || state.turn.devPlayed) return [];
  const hand = state.players[seat]!.devCards;
  return (Object.keys(PLAY_PHASES) as PlayableDev[]).filter(
    (c) => PLAY_PHASES[c].includes(state.phase.kind) && hand.includes(c),
  );
}

/** Remove one `card` from the current player's playable hand, or return why it can't be played. */
function playCard(ctx: Ctx, card: PlayableDev): EngineError | undefined {
  const s = ctx.state;
  if (!PLAY_PHASES[card].includes(s.phase.kind)) {
    return err('WRONG_PHASE', `Cannot play ${card} during ${s.phase.kind}`);
  }
  const notYours = expectSeat(ctx, s.turn.current);
  if (notYours) return notYours;
  if (s.turn.devPlayed) return err('DEV_CARD_NOT_PLAYABLE', 'Already played a card this turn');
  const hand = s.players[ctx.seat]!.devCards;
  const i = hand.indexOf(card);
  if (i < 0) return err('DEV_CARD_NOT_PLAYABLE', `No playable ${card} card`);
  hand.splice(i, 1);
  s.turn.devPlayed = true;
  ctx.events.push({ type: 'playedDev', seat: ctx.seat, card });
  return undefined;
}

const playKnight: Handler<'PLAY_KNIGHT'> = (ctx) => {
  const s = ctx.state;
  const returnTo = s.phase.kind === 'preRoll' ? 'preRoll' : 'main';
  const bad = playCard(ctx, 'knight');
  if (bad) return bad;
  s.players[ctx.seat]!.playedKnights++;
  updateLargestArmy(ctx, ctx.seat);
  s.phase = { kind: 'moveRobber', returnTo };
};

/** Free roads available right now: min(2, roads left), or 0 if no edge is buildable. */
export function roadBuildingCount(
  state: GameState,
  graph: BoardGraph,
  seat: Seat,
  /** The seat's buildable road edges, when the caller has already computed them. */
  roadEdges: () => readonly EdgeId[] = () => buildableRoadEdges(state, graph, seat),
): number {
  const n = Math.min(2, state.players[seat]!.roadsLeft);
  return n > 0 && roadEdges().length > 0 ? n : 0;
}

const playRoadBuilding: Handler<'PLAY_ROAD_BUILDING'> = (ctx) => {
  const bad = playCard(ctx, 'roadBuilding');
  if (bad) return bad;
  // Refuse rather than waste the card when no free road could be placed.
  const remaining = roadBuildingCount(ctx.state, ctx.graph, ctx.seat);
  if (remaining === 0) return err('DEV_CARD_NOT_PLAYABLE', 'No road can be built');
  ctx.state.phase = { kind: 'roadBuilding', remaining };
};

const playYearOfPlenty: Handler<'PLAY_YEAR_OF_PLENTY'> = (ctx, a) => {
  const s = ctx.state;
  const res = a.resources;
  if (!Array.isArray(res) || res.length !== 2 || !res.every(isResource)) {
    return err('INVALID_ACTION', 'Pick exactly two resources');
  }
  const bad = playCard(ctx, 'yearOfPlenty');
  if (bad) return bad;
  if (!bankCanPay(s.bank, res)) return err('BANK_EMPTY', 'The bank cannot pay those resources');
  for (const r of res) {
    s.bank[r]--;
    s.players[ctx.seat]!.resources[r]++;
  }
  ctx.events.push({ type: 'yearOfPlenty', seat: ctx.seat, resources: [res[0], res[1]] });
};

const playMonopoly: Handler<'PLAY_MONOPOLY'> = (ctx, a) => {
  const s = ctx.state;
  if (!isResource(a.resource)) return err('INVALID_ACTION', 'Unknown resource');
  const bad = playCard(ctx, 'monopoly');
  if (bad) return bad;
  const taken: Record<string, number> = {};
  const me = s.players[ctx.seat]!;
  for (const p of s.players) {
    if (p.seat === ctx.seat || p.resources[a.resource] === 0) continue;
    taken[String(p.seat)] = p.resources[a.resource];
    me.resources[a.resource] += p.resources[a.resource];
    p.resources[a.resource] = 0;
  }
  ctx.events.push({ type: 'monopoly', seat: ctx.seat, resource: a.resource, taken });
};

/** PLAY_KNIGHT, PLAY_ROAD_BUILDING, PLAY_YEAR_OF_PLENTY, PLAY_MONOPOLY. */
export const devCardHandlers: HandlerMap = withVictoryCheck({
  PLAY_KNIGHT: playKnight,
  PLAY_ROAD_BUILDING: playRoadBuilding,
  PLAY_YEAR_OF_PLENTY: playYearOfPlenty,
  PLAY_MONOPOLY: playMonopoly,
});
