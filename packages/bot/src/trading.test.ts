import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  getPendingActors,
  normalizeConfig,
  resourcesOf,
  toPlayerView,
  type Action,
  type GameState,
  type PlayerView,
  type ResourceCounts,
  type Seat,
} from '@hexhaven/engine';
import {
  awaitingResponses,
  BotPlayer,
  decide,
  MAX_BOT_OFFERS_PER_TURN,
  type BotDifficulty,
} from './index';

const rnd = () => 0.42;

/** Let bots play until seat 0 has just rolled on a regular turn. */
function playUntilMain(seed: string): GameState {
  let s = createGame(normalizeConfig({ players: 4 }), seed);
  for (let i = 0; i < 2000; i++) {
    if (s.phase.kind === 'main' && s.turn.current === 0) return s;
    const actor = getPendingActors(s)[0]!;
    const r = applyAction(
      s,
      actor,
      decide(toPlayerView(s, actor), { difficulty: 'normal', random: rnd }),
    );
    if (!r.ok) throw new Error(r.error.message);
    s = r.state;
  }
  throw new Error('never reached main for seat 0');
}

/** Hand that targets a city and is exactly one grain short, with two spare wool. */
const ONE_GRAIN_SHORT: Partial<ResourceCounts> = { ore: 3, grain: 1, wool: 2 };

/**
 * Seat 0 is in its main phase holding `hand`; everyone else holds some cards. Dev cards are
 * cleared so the bot's choice depends only on trading.
 */
function scenario(hand: Partial<ResourceCounts> = ONE_GRAIN_SHORT): GameState {
  const s = structuredClone(playUntilMain('bot-trading'));
  for (const p of s.players) {
    p.devCards = [];
    p.newDevCards = [];
    p.resources = resourcesOf(p.seat === 0 ? hand : { brick: 1, lumber: 1, grain: 1 });
  }
  return s;
}

function apply(s: GameState, seat: Seat, action: Action): GameState {
  const r = applyAction(s, seat, action);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message} for ${JSON.stringify(action)}`);
  return r.state;
}

/** Every seat still asked about an offer answers it the same way. */
function answerAll(s: GameState, response: 'accept' | 'reject'): GameState {
  for (const t of [...s.trades])
    for (const [seat, r] of Object.entries(t.responses))
      if (r === 'pending')
        s = apply(s, Number(seat), { type: 'RESPOND_TRADE', offerId: t.id, response });
  return s;
}

/** Run seat 0's turn with everyone rejecting its offers; returns its actions up to END_TURN. */
function playTurnRejectingOffers(next: (view: PlayerView) => Action): Action[] {
  let s = scenario();
  const actions: Action[] = [];
  for (let i = 0; i < 40; i++) {
    const action = next(toPlayerView(s, 0));
    actions.push(action);
    if (action.type === 'END_TURN') return actions;
    s = answerAll(apply(s, 0, action), 'reject');
  }
  throw new Error(`turn never ended: ${JSON.stringify(actions.map((a) => a.type))}`);
}

const offers = (actions: Action[]) =>
  actions.filter((a): a is Extract<Action, { type: 'OFFER_TRADE' }> => a.type === 'OFFER_TRADE');

describe('bot player trading', () => {
  it('proposes a 1-for-1 offer when one resource short of its target', () => {
    for (const difficulty of ['normal', 'hard'] as BotDifficulty[]) {
      const action = decide(toPlayerView(scenario(), 0), { difficulty, random: rnd });
      expect(action).toEqual({
        type: 'OFFER_TRADE',
        give: resourcesOf({ wool: 1 }),
        want: resourcesOf({ grain: 1 }),
        to: null,
        counterTo: null,
      });
    }
  });

  it('does not offer when it can already afford its target', () => {
    const s = scenario({ ore: 3, grain: 2, wool: 2 });
    const action = decide(toPlayerView(s, 0), { difficulty: 'normal', random: rnd });
    expect(action.type).not.toBe('OFFER_TRADE');
  });

  it('never exceeds the per-turn offer cap or repeats a rejected offer', () => {
    const bot = new BotPlayer({ difficulty: 'normal', random: rnd });
    const actions = playTurnRejectingOffers((v) => bot.decide(v));
    expect(actions.slice(-3).map((a) => a.type)).toEqual([
      'CANCEL_TRADE',
      'CANCEL_TRADE',
      'END_TURN',
    ]);
    const made = offers(actions);
    expect(made).toHaveLength(MAX_BOT_OFFERS_PER_TURN);
    expect(made[1]!.give).toEqual(resourcesOf({ wool: 2 })); // falls back to 2-for-1
    const keys = made.map((o) => JSON.stringify([o.give, o.want]));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('stays within the cap and still ends its turn without a memo', () => {
    const actions = playTurnRejectingOffers((v) =>
      decide(v, { difficulty: 'normal', random: rnd }),
    );
    expect(offers(actions).length).toBeLessThanOrEqual(MAX_BOT_OFFERS_PER_TURN);
    expect(actions.at(-1)!.type).toBe('END_TURN');
  });

  it('cancels its open offers before ending the turn', () => {
    const bot = new BotPlayer({ difficulty: 'normal', random: rnd });
    let s = scenario();
    for (let i = 0; i < 40; i++) {
      const action = bot.decide(toPlayerView(s, 0));
      if (action.type === 'END_TURN') {
        expect(s.trades).toEqual([]);
        return;
      }
      s = answerAll(apply(s, 0, action), 'reject');
    }
    throw new Error('turn never ended');
  });

  it('starts a fresh memo on its next turn', () => {
    const bot = new BotPlayer({ difficulty: 'normal', random: rnd });
    const s = scenario();
    const first = bot.decide(toPlayerView(s, 0));
    expect(first.type).toBe('OFFER_TRADE');
    s.turn.number += 4;
    expect(bot.decide(toPlayerView(s, 0))).toEqual(first);
  });

  it('confirms with the accepting seat that has the fewest VP', () => {
    let s = scenario();
    s = apply(s, 0, decide(toPlayerView(s, 0), { difficulty: 'normal', random: rnd }));
    s = answerAll(s, 'accept');
    const view = toPlayerView(s, 0);
    view.players[1]!.publicVP = 5;
    view.players[2]!.publicVP = 2;
    view.players[3]!.publicVP = 4;
    const action = decide(view, { difficulty: 'normal', random: rnd });
    expect(action).toEqual({ type: 'CONFIRM_TRADE', offerId: s.trades[0]!.id, with: 2 });
    expect(applyAction(s, 0, action).ok).toBe(true);
  });

  it('never confirms with a player about to win', () => {
    let s = scenario();
    s = apply(s, 0, decide(toPlayerView(s, 0), { difficulty: 'normal', random: rnd }));
    s = answerAll(s, 'accept');
    const view = toPlayerView(s, 0);
    for (const p of view.players) if (p.seat !== 0) p.publicVP = view.config.vpToWin - 2;
    expect(decide(view, { difficulty: 'normal', random: rnd }).type).not.toBe('CONFIRM_TRADE');
  });

  it('normal and hard bots never offer to a player close to winning', () => {
    const view = toPlayerView(scenario(), 0);
    view.players[2]!.publicVP = view.config.vpToWin - 2;
    for (const difficulty of ['normal', 'hard'] as BotDifficulty[]) {
      const action = decide(view, { difficulty, random: rnd });
      expect(action).toMatchObject({ type: 'OFFER_TRADE', to: [1, 3] });
    }
  });

  it('reports when its own offer still awaits answers', () => {
    let s = scenario();
    expect(awaitingResponses(toPlayerView(s, 0), 0)).toBe(false);
    s = apply(s, 0, decide(toPlayerView(s, 0), { difficulty: 'normal', random: rnd }));
    expect(awaitingResponses(toPlayerView(s, 0), 0)).toBe(true);
    expect(awaitingResponses(s, 1)).toBe(false);
    s = answerAll(s, 'reject');
    expect(awaitingResponses(toPlayerView(s, 2), 0)).toBe(false);
  });

  it('skips a partner it already traded with this turn and prefers ones with cards to spare', () => {
    // Hard, two grain short: it trades for one grain at a time.
    const bot = new BotPlayer({ difficulty: 'hard', random: rnd });
    let s = scenario({ ore: 3, grain: 0, wool: 4 });
    // Seat 2 holds just the one grain asked for; seats 1 and 3 have more.
    s.players[2]!.resources = resourcesOf({ grain: 1 });
    s.players[3]!.resources = resourcesOf({ grain: 3 });
    s = apply(s, 0, bot.decide(toPlayerView(s, 0)));
    s = answerAll(s, 'accept');
    const view = toPlayerView(s, 0);
    view.players[1]!.publicVP = 4;
    view.players[2]!.publicVP = 2;
    view.players[3]!.publicVP = 3;
    const first = bot.decide(view);
    expect(first).toMatchObject({ type: 'CONFIRM_TRADE', with: 3 });
    s = apply(s, 0, first);
    // A second offer: seat 3 accepts again but has already traded with us this turn.
    s = apply(s, 0, bot.decide(toPlayerView(s, 0)));
    s = answerAll(s, 'accept');
    const again = bot.decide(toPlayerView(s, 0));
    expect(again).toMatchObject({ type: 'CONFIRM_TRADE', with: 1 });
  });

  it('easy bots offer rarely, only 1-for-1, with one roll per turn', () => {
    const view = toPlayerView(scenario(), 0);
    let luck = 0.9;
    const unlucky = new BotPlayer({ difficulty: 'easy', random: () => luck });
    expect(unlucky.decide(view).type).not.toBe('OFFER_TRADE');
    luck = 0.1; // asking again in the same turn doesn't re-roll
    expect(unlucky.decide(view).type).not.toBe('OFFER_TRADE');
    const lucky = new BotPlayer({ difficulty: 'easy', random: () => 0.1 });
    expect(lucky.decide(view)).toMatchObject({
      type: 'OFFER_TRADE',
      give: resourcesOf({ wool: 1 }),
    });
    // Stateless: the roll comes from the turn, so repeated calls agree.
    const a = decide(view, { difficulty: 'easy', random: () => 0.1 });
    expect(decide(view, { difficulty: 'easy', random: () => 0.9 })).toEqual(a);
  });

  it('easy bots use the bank for the last card of a city', () => {
    const view = toPlayerView(scenario({ ore: 3, grain: 1, wool: 4 }), 0);
    const action = decide(view, { difficulty: 'easy', random: () => 0.9 });
    expect(action).toMatchObject({ type: 'MARITIME_TRADE', get: 'grain' });
  });
});

describe('bot responses to offers', () => {
  /** Seat 0 offers `give` for `want`; seat 1 holds a city hand one grain short. */
  function offerToSeat1(give: Partial<ResourceCounts>, want: Partial<ResourceCounts>): GameState {
    const s = scenario({ grain: 2, brick: 2, ore: 1 });
    s.players[1]!.resources = resourcesOf(ONE_GRAIN_SHORT);
    return apply(s, 0, {
      type: 'OFFER_TRADE',
      give: resourcesOf(give),
      want: resourcesOf(want),
      to: [1],
      counterTo: null,
    });
  }

  it('accepts a fair trade that advances its goal', () => {
    const s = offerToSeat1({ grain: 1 }, { wool: 1 });
    for (const difficulty of ['normal', 'hard'] as BotDifficulty[]) {
      const action = decide(toPlayerView(s, 1), { difficulty, random: rnd });
      expect(action).toEqual({ type: 'RESPOND_TRADE', offerId: 1, response: 'accept' });
    }
  });

  it('rejects a trade that would help a player close to winning', () => {
    const s = offerToSeat1({ grain: 1 }, { wool: 1 });
    const view = toPlayerView(s, 1);
    view.players[0]!.publicVP = view.config.vpToWin - 2;
    for (const difficulty of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      const action = decide(view, { difficulty, random: () => 0.01 });
      expect(action).toEqual({ type: 'RESPOND_TRADE', offerId: 1, response: 'reject' });
    }
  });

  it('rejects an unfair 2-for-1 against it', () => {
    const s = offerToSeat1({ grain: 1 }, { wool: 2 });
    const action = decide(toPlayerView(s, 1), { difficulty: 'normal', random: rnd });
    expect(action).toEqual({ type: 'RESPOND_TRADE', offerId: 1, response: 'reject' });
  });

  it('hard bots counter with a spare card, then reject the original', () => {
    // Seat 0 wants ore, which seat 1 needs for its city; it also asks the table for wool.
    let s = offerToSeat1({ grain: 1 }, { ore: 1 });
    s = apply(s, 0, {
      type: 'OFFER_TRADE',
      give: resourcesOf({ brick: 1 }),
      want: resourcesOf({ wool: 1 }),
      to: [1],
      counterTo: null,
    });
    expect(decide(toPlayerView(s, 1), { difficulty: 'normal', random: rnd })).toEqual({
      type: 'RESPOND_TRADE',
      offerId: 1,
      response: 'reject',
    });

    const counter = decide(toPlayerView(s, 1), { difficulty: 'hard', random: rnd });
    expect(counter).toEqual({
      type: 'OFFER_TRADE',
      give: resourcesOf({ wool: 1 }),
      want: resourcesOf({ grain: 1 }),
      to: [0],
      counterTo: 1,
    });
    s = apply(s, 1, counter);
    const next = decide(toPlayerView(s, 1), { difficulty: 'hard', random: rnd });
    expect(next).toEqual({ type: 'RESPOND_TRADE', offerId: 1, response: 'reject' });
    s = apply(s, 1, next);

    // Seat 0 rejects the counter; before answering its next offer seat 1 withdraws it.
    const counterId = s.trades.find((t) => t.counterTo === 1)!.id;
    s = apply(s, 0, { type: 'RESPOND_TRADE', offerId: counterId, response: 'reject' });
    expect(decide(toPlayerView(s, 1), { difficulty: 'hard', random: rnd })).toEqual({
      type: 'CANCEL_TRADE',
      offerId: counterId,
    });
  });

  it('hard bots only substitute a card the offerer has asked for', () => {
    // Same as above but without seat 0's wool request: no counter.
    const s = offerToSeat1({ grain: 1 }, { ore: 1 });
    expect(decide(toPlayerView(s, 1), { difficulty: 'hard', random: rnd })).toEqual({
      type: 'RESPOND_TRADE',
      offerId: 1,
      response: 'reject',
    });
  });
});
