/** Random legal play driven by getLegal — used by property tests and available to other packages. */
import { createGame, normalizeConfig } from '../game';
import { getLegal } from '../legal';
import { getPendingActors } from '../pending';
import { applyAction } from '../reducer';
import { hasResources, resourcesOf, single } from '../resources';
import { nextFloat, seedRng } from '../rng';
import { bankCanPay } from '../rules/devcards';
import { confirmablePartners, tradeExecutable } from '../rules/trade';
import {
  RESOURCES,
  type Action,
  type ActionType,
  type GameEvent,
  type GameState,
  type LegalSummary,
  type Resource,
  type Seat,
} from '../types';

/** A source of floats in [0, 1). */
export type Rnd = () => number;

export function seededRandom(seed: string): Rnd {
  const s = seedRng(seed);
  return () => nextFloat(s);
}

export const pick = <T>(rnd: Rnd, items: readonly T[]): T =>
  items[Math.floor(rnd() * items.length)]!;

/** Relative likelihood of choosing each legal action type (default 10). Biased towards building. */
const WEIGHTS: Partial<Record<ActionType, number>> = {
  BUILD_CITY: 40,
  BUILD_SETTLEMENT: 40,
  BUILD_ROAD: 8,
  BUY_DEV: 10,
  PLAY_KNIGHT: 6,
  PLAY_ROAD_BUILDING: 6,
  PLAY_YEAR_OF_PLENTY: 6,
  PLAY_MONOPOLY: 6,
  MARITIME_TRADE: 6,
  OFFER_TRADE: 1,
  RESPOND_TRADE: 5,
  CONFIRM_TRADE: 8,
  CANCEL_TRADE: 1,
  END_TURN: 6,
};

function handCards(state: GameState, seat: Seat): Resource[] {
  const hand = state.players[seat]!.resources;
  return RESOURCES.flatMap((r) => Array<Resource>(hand[r]).fill(r));
}

/**
 * A random payload for `type`, valid for `seat` in `state`, or null if none can be built.
 * Only meaningful for types listed in getLegal(state, seat).actions.
 */
export function buildAction(
  state: GameState,
  seat: Seat,
  type: ActionType,
  rnd: Rnd,
  legal: LegalSummary = getLegal(state, seat),
): Action | null {
  const hand = state.players[seat]!.resources;
  const own = state.trades.filter((t) => t.from === seat);
  const addressed = state.trades.filter((t) => Object.hasOwn(t.responses, String(seat)));
  const oneOf = <T>(items: readonly T[], f: (x: T) => Action): Action | null =>
    items.length > 0 ? f(pick(rnd, items)) : null;

  switch (type) {
    case 'PLACE_SETTLEMENT':
    case 'BUILD_SETTLEMENT':
      return oneOf(legal.settlementVertices, (vertex) => ({ type, vertex }));
    case 'PLACE_ROAD':
    case 'BUILD_ROAD':
      return oneOf(legal.roadEdges, (edge) => ({ type, edge }));
    case 'BUILD_CITY':
      return oneOf(legal.cityVertices, (vertex) => ({ type, vertex }));
    case 'MOVE_ROBBER':
      return oneOf(legal.robberHexes, (hex) => ({ type, hex }));
    case 'STEAL':
      return oneOf(legal.stealVictims, (victim) => ({ type, victim }));
    // Open Seas actions: ENG adds payload builders together with the rules.
    case 'PLACE_SHIP':
    case 'BUILD_SHIP':
    case 'MOVE_SHIP':
    case 'MOVE_PIRATE':
    case 'CHOOSE_GOLD':
      return null;
    case 'ROLL':
    case 'BUY_DEV':
    case 'PLAY_KNIGHT':
    case 'PLAY_ROAD_BUILDING':
    case 'END_TURN':
    case 'PASS_SPECIAL_BUILD':
      return { type };
    case 'DISCARD': {
      const cards = handCards(state, seat);
      const resources = resourcesOf({});
      for (let i = 0; i < legal.discardCount && cards.length > 0; i++) {
        const [r] = cards.splice(Math.floor(rnd() * cards.length), 1);
        resources[r!]++;
      }
      return { type, resources };
    }
    case 'PLAY_YEAR_OF_PLENTY': {
      const pairs = RESOURCES.flatMap((a) =>
        RESOURCES.map((b): [Resource, Resource] => [a, b]),
      ).filter((p) => bankCanPay(state.bank, p));
      return oneOf(pairs, (resources) => ({ type, resources }));
    }
    case 'PLAY_MONOPOLY':
      return { type, resource: pick(rnd, RESOURCES) };
    case 'MARITIME_TRADE': {
      const options = RESOURCES.flatMap((give) =>
        hand[give] >= legal.maritimeRatios[give]
          ? RESOURCES.filter((get) => get !== give && state.bank[get] > 0).map((get) => ({
              give,
              get,
            }))
          : [],
      );
      return oneOf(options, (o) => ({ type, ...o }));
    }
    case 'OFFER_TRADE': {
      const cards = handCards(state, seat);
      if (cards.length === 0) return null;
      const give = pick(rnd, cards);
      const want = pick(
        rnd,
        RESOURCES.filter((r) => r !== give),
      );
      if (seat === state.turn.current) {
        const others = state.players.map((p) => p.seat).filter((s) => s !== seat);
        const to = rnd() < 0.5 ? null : [pick(rnd, others)];
        return { type, give: single(give), want: single(want), to, counterTo: null };
      }
      const targets = addressed.filter(
        (t) => t.from === state.turn.current && t.counterTo === null,
      );
      return oneOf(targets, (t) => ({
        type,
        give: single(give),
        want: single(want),
        to: null,
        counterTo: t.id,
      }));
    }
    case 'RESPOND_TRADE':
      return oneOf(addressed, (t) => {
        const canAccept =
          t.counterTo === null ? hasResources(hand, t.want) : tradeExecutable(state, t, seat);
        const response = canAccept && rnd() < 0.6 ? 'accept' : 'reject';
        return { type, offerId: t.id, response };
      });
    case 'CONFIRM_TRADE': {
      const ready = own.filter((t) => confirmablePartners(state, t).length > 0);
      return oneOf(ready, (t) => ({
        type,
        offerId: t.id,
        with: pick(rnd, confirmablePartners(state, t)),
      }));
    }
    case 'CANCEL_TRADE':
      return oneOf(own, (t) => ({ type, offerId: t.id }));
  }
}

/** Pick a random legal action for `seat` (weighted towards building), or null if it has none. */
export function randomLegalAction(state: GameState, seat: Seat, rnd: Rnd): Action | null {
  const legal = getLegal(state, seat);
  if (legal.actions.length === 0) return null;
  const weights = legal.actions.map((t) => WEIGHTS[t] ?? 10);
  let x = rnd() * weights.reduce((a, b) => a + b, 0);
  let i = 0;
  while (i < weights.length - 1 && x >= weights[i]!) x -= weights[i++]!;
  return buildAction(state, seat, legal.actions[i]!, rnd, legal);
}

export interface Step {
  seat: Seat;
  action: Action;
}

export interface RandomGame {
  initial: GameState;
  state: GameState;
  log: Step[];
  events: GameEvent[];
}

/**
 * Play random legal actions from a fresh game until game over or `maxSteps`.
 * Throws if a pending actor has no legal action or a chosen action is rejected.
 * `onStep` sees every intermediate state (after each action).
 */
export function playRandomGame(
  seed: string,
  players: number,
  maxSteps: number,
  onStep?: (state: GameState, step: Step) => void,
): RandomGame {
  const initial = createGame(normalizeConfig({ players }), seed);
  const rnd = seededRandom(`${seed}/play`);
  const log: Step[] = [];
  const events: GameEvent[] = [];
  let state = initial;
  while (log.length < maxSteps && state.phase.kind !== 'gameOver') {
    const actors = getPendingActors(state);
    if (actors.length === 0) throw new Error(`No pending actor in ${state.phase.kind}`);
    const seat = pick(rnd, actors);
    const action = randomLegalAction(state, seat, rnd);
    if (!action) throw new Error(`Seat ${seat} has no legal action in ${state.phase.kind}`);
    const res = applyAction(state, seat, action);
    if (!res.ok) {
      throw new Error(`Rejected ${JSON.stringify(action)} by ${seat}: ${res.error.message}`);
    }
    state = res.state;
    events.push(...res.events);
    const step = { seat, action };
    log.push(step);
    onStep?.(state, step);
  }
  return { initial, state, log, events };
}
