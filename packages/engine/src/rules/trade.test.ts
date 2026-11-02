import { describe, expect, it } from 'vitest';
import { getLegal } from '../legal';
import { getPendingActors } from '../pending';
import { resourcesOf } from '../resources';
import { give, inPhase, newGame } from '../test/fixtures';
import { eventsOf, expectOk, expectRejected } from '../test/expect';
import type { Action, GameState } from '../types';

const r = resourcesOf;

function tradeState(): GameState {
  const s = inPhase(newGame(4), { kind: 'main' });
  give(s, 0, { brick: 2, wool: 1 });
  give(s, 1, { ore: 2 });
  give(s, 2, { ore: 1 });
  return s;
}

const offer = (extra: Partial<Extract<Action, { type: 'OFFER_TRADE' }>> = {}): Action => ({
  type: 'OFFER_TRADE',
  give: r({ brick: 1 }),
  want: r({ ore: 1 }),
  to: null,
  counterTo: null,
  ...extra,
});

describe('domestic trade (RULES.md#trading)', () => {
  it('offer → accept → confirm executes the trade', () => {
    let s = tradeState();
    const o = expectOk(s, 0, offer());
    s = o.state;
    expect(s.trades).toHaveLength(1);
    expect(s.trades[0]).toMatchObject({
      id: 1,
      from: 0,
      to: null,
      counterTo: null,
      responses: { '1': 'pending', '2': 'pending', '3': 'pending' },
    });
    expect(eventsOf(o.events, 'tradeOffered')[0]!.offer).toEqual(s.trades[0]);
    expect(getPendingActors(s).sort()).toEqual([0, 1, 2, 3]);
    expect(getLegal(s, 1).actions).toEqual(['OFFER_TRADE', 'RESPOND_TRADE']);
    expect(getLegal(s, 3).actions).toEqual(['RESPOND_TRADE']);
    expect(getLegal(s, 0).actions).not.toContain('CONFIRM_TRADE');

    expectRejected(
      s,
      3,
      { type: 'RESPOND_TRADE', offerId: 1, response: 'accept' },
      'INSUFFICIENT_RESOURCES',
    );
    s = expectOk(s, 3, { type: 'RESPOND_TRADE', offerId: 1, response: 'reject' }).state;
    s = expectOk(s, 1, { type: 'RESPOND_TRADE', offerId: 1, response: 'accept' }).state;
    expect(getLegal(s, 0).actions).toContain('CONFIRM_TRADE');
    expectRejected(s, 0, { type: 'CONFIRM_TRADE', offerId: 1, with: 2 }, 'INVALID_TRADE');
    expectRejected(s, 1, { type: 'CONFIRM_TRADE', offerId: 1, with: 1 }, 'NOT_YOUR_TURN');
    const { state, events } = expectOk(s, 0, { type: 'CONFIRM_TRADE', offerId: 1, with: 1 });
    expect(state.players[0]!.resources).toEqual(r({ brick: 1, wool: 1, ore: 1 }));
    expect(state.players[1]!.resources).toEqual(r({ brick: 1, ore: 1 }));
    expect(state.trades).toEqual([]);
    expect(eventsOf(events, 'traded')).toEqual([
      { type: 'traded', offerId: 1, a: 0, b: 1, aGave: r({ brick: 1 }), bGave: r({ ore: 1 }) },
    ]);
  });

  it('validates offers', () => {
    const s = tradeState();
    expectRejected(s, 0, offer({ give: r({}) }), 'INVALID_TRADE');
    expectRejected(s, 0, offer({ want: r({}) }), 'INVALID_TRADE');
    expectRejected(s, 0, offer({ want: r({ brick: 1 }) }), 'INVALID_TRADE');
    expectRejected(s, 0, offer({ give: r({ brick: 3 }) }), 'INSUFFICIENT_RESOURCES');
    expectRejected(s, 0, offer({ give: { ...r({}), brick: -1 } }), 'INVALID_TRADE');
    expectRejected(s, 0, offer({ to: [0] }), 'INVALID_TRADE');
    expectRejected(s, 0, offer({ to: [] }), 'INVALID_TRADE');
    expectRejected(s, 0, offer({ to: [1, 1] }), 'INVALID_TRADE');
    expectRejected(s, 0, offer({ to: [7] }), 'INVALID_TRADE');
    expectRejected(s, 1, offer({ give: r({ ore: 1 }), want: r({ brick: 1 }) }), 'NOT_YOUR_TURN');
    expectRejected(inPhase(structuredClone(s), { kind: 'preRoll' }), 0, offer(), 'WRONG_PHASE');
  });

  it('targeted offers only reach the chosen seats', () => {
    const s = expectOk(tradeState(), 0, offer({ to: [2, 1] })).state;
    expect(s.trades[0]!.to).toEqual([1, 2]);
    expect(Object.keys(s.trades[0]!.responses).sort()).toEqual(['1', '2']);
    expectRejected(
      s,
      3,
      { type: 'RESPOND_TRADE', offerId: 1, response: 'reject' },
      'NOT_YOUR_TURN',
    );
    expect(getLegal(s, 3).actions).toEqual([]);
  });

  it('hands are revalidated at confirm', () => {
    let s = expectOk(tradeState(), 0, offer()).state;
    s = expectOk(s, 2, { type: 'RESPOND_TRADE', offerId: 1, response: 'accept' }).state;
    // Seat 2 loses its ore before the confirm.
    s.players[2]!.resources.ore = 0;
    s.bank.ore++;
    expect(getLegal(s, 0).actions).not.toContain('CONFIRM_TRADE');
    expectRejected(s, 0, { type: 'CONFIRM_TRADE', offerId: 1, with: 2 }, 'INSUFFICIENT_RESOURCES');
  });

  it('counter-offers go to the active player and execute on accept', () => {
    let s = expectOk(tradeState(), 0, offer()).state;
    const counter = offer({ give: r({ ore: 2 }), want: r({ brick: 1, wool: 1 }), counterTo: 1 });
    expectRejected(s, 0, counter, 'INVALID_TRADE'); // active player can't counter
    expectRejected(s, 1, { ...counter, counterTo: 99 } as Action, 'INVALID_TRADE');
    expectRejected(s, 1, { ...counter, to: [2] } as Action, 'INVALID_TRADE');
    expectRejected(s, 2, counter, 'INSUFFICIENT_RESOURCES');
    s = expectOk(s, 1, counter).state;
    const c = s.trades[1]!;
    expect(c).toMatchObject({
      id: 2,
      from: 1,
      to: [0],
      counterTo: 1,
      responses: { '0': 'pending' },
    });
    expect(getLegal(s, 0).actions).toContain('RESPOND_TRADE');
    expect(getLegal(s, 1).actions).toContain('CANCEL_TRADE');
    expectRejected(
      s,
      2,
      { type: 'RESPOND_TRADE', offerId: 2, response: 'accept' },
      'NOT_YOUR_TURN',
    );
    expectRejected(s, 1, { type: 'CONFIRM_TRADE', offerId: 2, with: 0 }, 'INVALID_TRADE');
    // A counter to a counter is not allowed.
    expectRejected(
      s,
      2,
      offer({ give: r({ ore: 1 }), want: r({ brick: 1 }), counterTo: 2 }),
      'INVALID_TRADE',
    );

    const { state, events } = expectOk(s, 0, {
      type: 'RESPOND_TRADE',
      offerId: 2,
      response: 'accept',
    });
    expect(state.players[0]!.resources).toEqual(r({ brick: 1, ore: 2 }));
    expect(state.players[1]!.resources).toEqual(r({ brick: 1, wool: 1 }));
    expect(state.trades.map((t) => t.id)).toEqual([1]);
    expect(eventsOf(events, 'traded')[0]).toMatchObject({ offerId: 2, a: 1, b: 0 });
  });

  it('the active player may have at most 3 open offers', () => {
    let s = tradeState();
    for (let i = 0; i < 3; i++) s = expectOk(s, 0, offer()).state;
    expect(getLegal(s, 0).actions).not.toContain('OFFER_TRADE');
    expectRejected(s, 0, offer(), 'INVALID_TRADE');
    s = expectOk(s, 0, { type: 'CANCEL_TRADE', offerId: 2 }).state;
    expect(getLegal(s, 0).actions).toContain('OFFER_TRADE');
    expectOk(s, 0, offer());
  });

  it('a new counter-offer replaces the same seat’s previous counter to that offer', () => {
    let s = expectOk(tradeState(), 0, offer()).state;
    const counter = (n: number) =>
      offer({ give: r({ ore: n }), want: r({ brick: 1 }), counterTo: 1 });
    s = expectOk(s, 1, counter(1)).state;
    s = expectOk(s, 2, counter(1)).state;
    const { state, events } = expectOk(s, 1, counter(2));
    expect(state.trades.map((t) => [t.id, t.from])).toEqual([
      [1, 0],
      [3, 2],
      [4, 1],
    ]);
    expect(state.trades[2]!.give.ore).toBe(2);
    expect(eventsOf(events, 'tradeCancelled')).toEqual([{ type: 'tradeCancelled', offerId: 2 }]);
  });

  it('cancel and end of turn close offers', () => {
    let s = expectOk(tradeState(), 0, offer()).state;
    expectRejected(s, 1, { type: 'CANCEL_TRADE', offerId: 1 }, 'NOT_YOUR_TURN');
    expectRejected(s, 0, { type: 'CANCEL_TRADE', offerId: 5 }, 'INVALID_TRADE');
    const c = expectOk(s, 0, { type: 'CANCEL_TRADE', offerId: 1 });
    expect(c.state.trades).toEqual([]);
    expect(c.events).toEqual([{ type: 'tradeCancelled', offerId: 1 }]);

    s = expectOk(s, 0, offer({ give: r({ wool: 1 }) })).state;
    const end = expectOk(s, 0, { type: 'END_TURN' });
    expect(end.state.trades).toEqual([]);
    expect(eventsOf(end.events, 'tradeCancelled').map((e) => e.offerId)).toEqual([1, 2]);
  });
});
