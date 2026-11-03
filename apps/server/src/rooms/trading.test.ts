import { afterEach, describe, expect, it } from 'vitest';
import type { Action, GameEvent, PlayerView } from '@hexhaven/engine';
import type { GameStatePayload } from '@hexhaven/shared';
import type { ServerDeps } from '../app';
import type { Config } from '../config';
import { createFakeBot } from '../testing/fakeEngine';
import {
  disconnectAll,
  next,
  ok,
  player,
  sleep,
  startServer,
  type TestServer,
} from '../testing/harness';
import type { BotFactory } from './engineApi';

let servers: TestServer[] = [];
afterEach(async () => {
  disconnectAll();
  for (const s of servers) await s.close().catch(() => undefined);
  servers = [];
});

async function boot(overrides: Partial<Config> = {}, deps: ServerDeps = {}) {
  const s = await startServer(overrides, deps);
  servers.push(s);
  return s;
}

const res = (r: Partial<Record<'brick' | 'lumber' | 'wool' | 'grain' | 'ore', number>>) => ({
  brick: 0,
  lumber: 0,
  wool: 0,
  grain: 0,
  ore: 0,
  ...r,
});

/**
 * Scripted bots (one instance per seat, remembering how many offers it made this turn): on its
 * turn a bot opens `offersPerTurn` offers, confirms with whoever accepted, otherwise withdraws
 * its newest offer, then ends the turn. Bots reject offers made to them but accept counters.
 */
function tradingBots(offersPerTurn = 1): BotFactory {
  return () => {
    let turn = -1;
    let offered = 0;
    return {
      decide(view: PlayerView): Action {
        const me = view.viewer!;
        if (turn !== view.turn.number) {
          turn = view.turn.number;
          offered = 0;
        }
        const ask = view.trades.find((t) => t.responses[String(me)] === 'pending');
        if (ask) {
          const response = ask.counterTo !== null ? 'accept' : 'reject';
          return { type: 'RESPOND_TRADE', offerId: ask.id, response };
        }
        const own = view.trades.filter((t) => t.from === me && t.counterTo === null);
        for (const t of own) {
          const yes = Object.entries(t.responses).find(([, r]) => r === 'accept');
          if (yes) return { type: 'CONFIRM_TRADE', offerId: t.id, with: Number(yes[0]) };
        }
        if (offered < offersPerTurn) {
          offered++;
          return {
            type: 'OFFER_TRADE',
            give: res({ wool: offered }),
            want: res({ ore: 1 }),
            to: null,
            counterTo: null,
          };
        }
        const newest = own.at(-1);
        if (newest) return { type: 'CANCEL_TRADE', offerId: newest.id };
        return { type: 'END_TURN' };
      },
    };
  };
}

/** Host on seat 0, bots on seats 1 and 2; the host ends turn 1 so bot seat 1 opens an offer. */
async function botOffers(srv: TestServer, turnTimerSec = 0) {
  // (seat 1 opens its offer as soon as the host ends turn 1)
  const host = await player(srv.url, 'Host');
  await ok(host.socket, 'room:create', { settings: { maxSeats: 3, turnTimerSec } });
  await ok(host.socket, 'room:addBot', { seat: 1, difficulty: 'normal' });
  await ok(host.socket, 'room:addBot', { seat: 2, difficulty: 'normal' });
  const first = next(host.socket, 'game:state');
  await ok(host.socket, 'room:start', {});
  await first;
  // Seat 2 (a bot) rejects at once; only the host's answer is outstanding.
  const waiting = next(host.socket, 'game:state', (p) =>
    p.view.trades.some(
      (t) => t.from === 1 && t.responses['2'] === 'reject' && t.responses['0'] === 'pending',
    ),
  );
  await ok(host.socket, 'game:action', { expectedVersion: 0, action: { type: 'END_TURN' } });
  return { host, waiting: await waiting, at: Date.now() };
}

const hasEvent = (type: GameEvent['type']) => (p: GameStatePayload) =>
  p.events.some((e) => e.type === type);

describe('active bot waits for answers to its offer', () => {
  it('holds while a human may still answer; accepting completes the trade', async () => {
    const srv = await boot({ tradeResponseMs: 10_000 }, { bots: tradingBots() });
    const { host, waiting } = await botOffers(srv);
    await sleep(150);
    // Held: the bot neither withdrew nor ended its turn.
    expect((await ok(host.socket, 'game:sync', {})).version).toBe(waiting.version);

    const traded = next(host.socket, 'game:state', hasEvent('traded'), 3000);
    const offer = waiting.view.trades[0]!;
    await ok(host.socket, 'game:action', {
      expectedVersion: waiting.version,
      action: { type: 'RESPOND_TRADE', offerId: offer.id, response: 'accept' },
    });
    const done = await traded;
    expect(done.events.find((e) => e.type === 'traded')).toMatchObject({ a: 1, b: 0 });
  });

  it('moves on after the response window when the human ignores the offer', async () => {
    const srv = await boot({ tradeResponseMs: 400 }, { bots: tradingBots() });
    const { host, at } = await botOffers(srv);
    const cancelled = await next(host.socket, 'game:state', hasEvent('tradeCancelled'), 3000);
    expect(Date.now() - at).toBeGreaterThanOrEqual(300);
    expect(cancelled.view.turn.current).toBe(1);
    // Seat 2 then gets the same treatment, and the turn comes back to the host.
    const back = await next(host.socket, 'game:state', (p) => p.view.turn.current === 0, 4000);
    expect(back.view.turn.number).toBe(4);
    const actors = srv.server.repos.games
      .actionsFrom(back.gameId, 0)
      .map((a) => `${a.seat}:${a.action.type}`);
    expect(actors).toEqual([
      '0:END_TURN',
      '1:OFFER_TRADE',
      '2:RESPOND_TRADE',
      '1:CANCEL_TRADE',
      '1:END_TURN',
      '2:OFFER_TRADE',
      '1:RESPOND_TRADE',
      '2:CANCEL_TRADE',
      '2:END_TURN',
    ]);
  });

  it('never waits past the turn deadline', async () => {
    const srv = await boot({ tradeResponseMs: 60_000 }, { bots: tradingBots() });
    const { host } = await botOffers(srv, 1);
    const cancelled = await next(host.socket, 'game:state', hasEvent('tradeCancelled'), 2500);
    expect(cancelled.view.turn.current).toBe(1);
  });

  it('does not wait at all when the window is 0 (TEST_MODE default)', async () => {
    const srv = await boot({}, { bots: tradingBots() });
    expect(srv.config.tradeResponseMs).toBe(0);
    const host = await player(srv.url, 'Host');
    await ok(host.socket, 'room:create', { settings: { maxSeats: 3 } });
    await ok(host.socket, 'room:addBot', { seat: 1, difficulty: 'normal' });
    await ok(host.socket, 'room:addBot', { seat: 2, difficulty: 'normal' });
    await ok(host.socket, 'room:start', {});
    const cancelled = next(host.socket, 'game:state', hasEvent('tradeCancelled'), 2000);
    await ok(host.socket, 'game:action', { expectedVersion: 0, action: { type: 'END_TURN' } });
    await cancelled;
  });
});

describe('trade hold edge cases', () => {
  it('a human counter counts as an answer, and the bot answers the counter at once', async () => {
    const srv = await boot({ tradeResponseMs: 10_000 }, { bots: tradingBots() });
    const { host, waiting, at } = await botOffers(srv);
    const offer = waiting.view.trades[0]!;
    const answered = next(
      host.socket,
      'game:state',
      (p) => p.events.some((e) => e.type === 'tradeResponded' && e.seat === 1),
      3000,
    );
    const moved = next(host.socket, 'game:state', hasEvent('tradeCancelled'), 3000);
    await ok(host.socket, 'game:action', {
      expectedVersion: waiting.version,
      action: {
        type: 'OFFER_TRADE',
        give: res({ ore: 1 }),
        want: res({ wool: 2 }),
        to: [1],
        counterTo: offer.id,
      },
    });
    expect((await answered).events.find((e) => e.type === 'tradeResponded')).toMatchObject({
      response: 'accept',
    });
    // The original offer's only open answer was the countering human: no further wait.
    await moved;
    expect(Date.now() - at).toBeLessThan(5000);
  });

  it('waits on each offer once per turn, not again after another offer closes', async () => {
    const srv = await boot({ tradeResponseMs: 400 }, { bots: tradingBots(2) });
    const { host } = await botOffers(srv);
    const back = await next(host.socket, 'game:state', (p) => p.view.turn.current === 2, 5000);
    const log = srv.server.repos.games
      .actionsFrom(back.gameId, 0)
      .filter((a) => a.seat === 1)
      .map((a) => ({ type: a.action.type, ts: a.ts }));
    expect(log.map((a) => a.type)).toEqual([
      'OFFER_TRADE', // A: waited on
      'OFFER_TRADE', // B: waited on
      'CANCEL_TRADE', // B withdrawn: A is still unanswered, but its window already ran
      'CANCEL_TRADE',
      'END_TURN',
    ]);
    expect(log[1]!.ts - log[0]!.ts).toBeGreaterThanOrEqual(350);
    expect(log[2]!.ts - log[1]!.ts).toBeGreaterThanOrEqual(350);
    expect(log[3]!.ts - log[2]!.ts).toBeLessThan(300);
  });
});

describe('bot instances', () => {
  it('keeps one bot per seat and a fresh one each time a human seat is covered', async () => {
    const fake = createFakeBot();
    const srv = await boot({ reconnectGraceMs: 50, botDelayMs: 250 }, { bots: fake.bots });
    const host = await player(srv.url, 'Host');
    const room = await ok(host.socket, 'room:create', { settings: { maxSeats: 3 } });
    const b = await player(srv.url, 'B');
    await ok(b.socket, 'room:join', { code: room.code });
    await ok(b.socket, 'room:sit', { seat: 1 });
    await ok(b.socket, 'room:ready', { ready: true });
    await ok(host.socket, 'room:addBot', { seat: 2, difficulty: 'hard' });
    await ok(host.socket, 'room:start', {});
    /** Host ends its turn (and B, while B plays); resolves when it is the host's turn again. */
    const round = async (withB: boolean) => {
      const v = (await ok(host.socket, 'game:sync', {})).version;
      const back = next(
        host.socket,
        'game:state',
        (p) => p.version > v && p.view.turn.current === 0,
      );
      await ok(host.socket, 'game:action', { expectedVersion: v, action: { type: 'END_TURN' } });
      if (withB)
        await ok(b.socket, 'game:action', { expectedVersion: v + 1, action: { type: 'END_TURN' } });
      await back;
    };
    for (let i = 0; i < 3; i++) await round(true);
    expect(fake.created).toEqual(['hard']); // seat 2's bot reused for all three turns

    // B leaves: their seat is covered by a new bot, reused while it stays covered.
    const covered = () =>
      next(host.socket, 'room:state', (r) => r.seats[1]!.controller === 'bot', 3000);
    let c = covered();
    await ok(b.socket, 'room:leave', {});
    await c;
    await round(false);
    await round(false);
    expect(fake.created).toEqual(['hard', 'normal']);

    // Back and gone again during the seat's own turn: the same bot (and its turn memory) resumes.
    const v = (await ok(host.socket, 'game:sync', {})).version;
    const back = next(host.socket, 'game:state', (p) => p.version > v && p.view.turn.current === 0);
    await ok(host.socket, 'game:action', { expectedVersion: v, action: { type: 'END_TURN' } });
    await ok(b.socket, 'room:join', { code: room.code }); // before the bot's delay runs out
    c = covered();
    await ok(b.socket, 'room:leave', {});
    await c;
    await back;
    expect(fake.created).toEqual(['hard', 'normal']);

    // Back for a turn of their own, then gone again: a fresh bot takes over.
    await ok(b.socket, 'room:join', { code: room.code });
    await round(true);
    c = covered();
    await ok(b.socket, 'room:leave', {});
    await c;
    await round(false);
    expect(fake.created).toEqual(['hard', 'normal', 'normal']);
  });
});
