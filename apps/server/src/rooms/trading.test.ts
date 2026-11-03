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
 * Scripted bots (one instance per seat, remembering whether it already offered this turn): on
 * its turn a bot offers once, confirms with whoever accepted, otherwise withdraws and ends the
 * turn. Bots always reject offers made to them.
 */
function tradingBots(): BotFactory {
  return () => {
    let offeredTurn = -1;
    return {
      decide(view: PlayerView): Action {
        const me = view.viewer!;
        const ask = view.trades.find((t) => t.responses[String(me)] === 'pending');
        if (ask) return { type: 'RESPOND_TRADE', offerId: ask.id, response: 'reject' };
        const own = view.trades.find((t) => t.from === me);
        if (own) {
          const yes = Object.entries(own.responses).find(([, r]) => r === 'accept');
          return yes
            ? { type: 'CONFIRM_TRADE', offerId: own.id, with: Number(yes[0]) }
            : { type: 'CANCEL_TRADE', offerId: own.id };
        }
        if (offeredTurn !== view.turn.number) {
          offeredTurn = view.turn.number;
          return {
            type: 'OFFER_TRADE',
            give: res({ wool: 1 }),
            want: res({ ore: 1 }),
            to: null,
            counterTo: null,
          };
        }
        return { type: 'END_TURN' };
      },
    };
  };
}

/** Host on seat 0, bots on seats 1 and 2; the host ends turn 1 so bot seat 1 opens an offer. */
async function botOffers(srv: TestServer, turnTimerSec = 0) {
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

describe('bot instances', () => {
  it('keeps one bot per seat and a fresh one each time a human seat is covered', async () => {
    const fake = createFakeBot();
    const srv = await boot({ reconnectGraceMs: 50 }, { bots: fake.bots });
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

    // B leaves: their seat is covered by a new bot; returning and leaving again makes another.
    const covered = () =>
      next(host.socket, 'room:state', (r) => r.seats[1]!.controller === 'bot', 3000);
    let c = covered();
    await ok(b.socket, 'room:leave', {});
    await c;
    await round(false);
    await round(false);
    expect(fake.created).toEqual(['hard', 'normal']);

    await ok(b.socket, 'room:join', { code: room.code });
    c = covered();
    await ok(b.socket, 'room:leave', {});
    await c;
    await round(false);
    expect(fake.created).toEqual(['hard', 'normal', 'normal']);
  });
});
