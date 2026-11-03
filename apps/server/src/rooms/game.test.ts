import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { GameState } from '@hexhaven/engine';
import type { RoomInfo } from '@hexhaven/shared';
import type { Config } from '../config';
import type { ServerDeps } from '../app';
import { createFakeBot, createFakeEngine } from '../testing/fakeEngine';
import { realEngine } from './engineApi';
import {
  connect,
  disconnectAll,
  emit,
  next,
  ok,
  player,
  sleep,
  startServer,
  type TestServer,
} from '../testing/harness';

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

/**
 * Host on seat 0, optional human B on seat 1, bots elsewhere (3 seats). Returns once every
 * player received the first game:state.
 */
async function startGame(srv: TestServer, opts: { withB?: boolean; turnTimerSec?: number } = {}) {
  const host = await player(srv.url, 'Host');
  const room = await ok(host.socket, 'room:create', {
    settings: { maxSeats: 3, turnTimerSec: opts.turnTimerSec ?? 0 },
  });
  const b = opts.withB === false ? null : await player(srv.url, 'B');
  if (b) {
    await ok(b.socket, 'room:join', { code: room.code });
    await ok(b.socket, 'room:sit', { seat: 1 });
    await ok(b.socket, 'room:ready', { ready: true });
  } else {
    await ok(host.socket, 'room:addBot', { seat: 1, difficulty: 'normal' });
  }
  await ok(host.socket, 'room:addBot', { seat: 2, difficulty: 'normal' });
  const first = [next(host.socket, 'game:state'), ...(b ? [next(b.socket, 'game:state')] : [])];
  await ok(host.socket, 'room:start', {});
  await Promise.all(first);
  return { host, b, room };
}

const fullState = async (srv: TestServer, code: string) =>
  (await (await fetch(`${srv.url}/api/test/rooms/${code}/state`)).json()) as GameState;

describe('game runner', () => {
  it('sends each socket its own redacted view and events', async () => {
    const srv = await boot();
    const { host, b, room } = await startGame(srv);
    const spectator = await player(srv.url, 'Spec');
    const specJoin = next(spectator.socket, 'game:state');
    await ok(spectator.socket, 'room:join', { code: room.code });
    expect((await specJoin).view.viewer).toBeNull();

    const hostGs = next(host.socket, 'game:state');
    const bGs = next(b!.socket, 'game:state');
    const specGs = next(spectator.socket, 'game:state');
    expect(
      await ok(host.socket, 'game:action', { expectedVersion: 0, action: { type: 'BUY_DEV' } }),
    ).toEqual({ version: 1 });

    const h = await hostGs;
    const o = await bGs;
    const s = await specGs;
    expect(h.view.viewer).toBe(0);
    expect(o.view.viewer).toBe(1);
    expect(s.view.viewer).toBeNull();
    expect(h.view.players[0]!.devCards).toHaveLength(1);
    expect(o.view.players[0]!.devCards).toBeUndefined();
    expect(o.view.players[1]!.devCards).toEqual([]);
    expect(h.events).toEqual([{ type: 'boughtDev', seat: 0, card: expect.any(String) }]);
    expect(o.events).toEqual([{ type: 'boughtDev', seat: 0, card: null }]);
    expect(s.events).toEqual([{ type: 'boughtDev', seat: 0, card: null }]);
    expect(h.roomId).toBe(room.id);
    expect(typeof h.serverNow).toBe('number');

    const sync = await ok(b!.socket, 'game:sync', {});
    expect(sync.view.viewer).toBe(1);
    expect(sync.version).toBe(1);
  });

  it('rejects acting for another seat, spectators and stale versions', async () => {
    const srv = await boot();
    const { host, b, room } = await startGame(srv);
    expect(
      await emit(b!.socket, 'game:action', { expectedVersion: 0, action: { type: 'END_TURN' } }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_YOUR_TURN' } });

    const spectator = await player(srv.url, 'Spec');
    await ok(spectator.socket, 'room:join', { code: room.code });
    expect(
      await emit(spectator.socket, 'game:action', {
        expectedVersion: 0,
        action: { type: 'END_TURN' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_SEATED' } });

    expect(
      await emit(host.socket, 'game:action', { expectedVersion: 5, action: { type: 'END_TURN' } }),
    ).toMatchObject({ ok: false, error: { code: 'STALE' } });
    expect(
      await emit(host.socket, 'game:action', {
        expectedVersion: 0,
        action: { type: 'TELEPORT' } as never,
      }),
    ).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } });
    expect((await fullState(srv, room.code)).version).toBe(0);
  });

  it('drives bot seats and persists every action in order', async () => {
    const bot = createFakeBot();
    const srv = await boot({}, { bots: bot.bots });
    const { host, b, room } = await startGame(srv);
    await ok(host.socket, 'game:action', { expectedVersion: 0, action: { type: 'END_TURN' } });
    const back = next(host.socket, 'game:state', (p) => p.view.turn.current === 0);
    await ok(b!.socket, 'game:action', { expectedVersion: 1, action: { type: 'END_TURN' } });
    const p = await back;
    expect(p.version).toBe(3);
    expect(bot.calls).toEqual([2]);

    const game = srv.server.repos.games.activeForRoom(room.id)!;
    const actions = srv.server.repos.games.actionsFrom(game.id, 0);
    expect(actions.map((a) => [a.idx, a.seat, a.actor])).toEqual([
      [0, 0, 'human'],
      [1, 1, 'human'],
      [2, 2, 'bot'],
    ]);
    expect(srv.server.repos.games.latestSnapshot(game.id)!.version).toBe(3);
  });

  it('falls back to a safe move when the bot throws', async () => {
    const bot = createFakeBot({ throwFor: [2] });
    const srv = await boot({}, { bots: bot.bots });
    const { host, b } = await startGame(srv);
    await ok(host.socket, 'game:action', { expectedVersion: 0, action: { type: 'END_TURN' } });
    const back = next(host.socket, 'game:state', (p) => p.view.turn.current === 0);
    await ok(b!.socket, 'game:action', { expectedVersion: 1, action: { type: 'END_TURN' } });
    expect((await back).version).toBe(3);
  });

  it('hands a disconnected seat to the bot after grace and back on reconnect', async () => {
    const bot = createFakeBot();
    const srv = await boot({ reconnectGraceMs: 150 }, { bots: bot.bots });
    const { host, b, room } = await startGame(srv);
    await ok(host.socket, 'game:action', { expectedVersion: 0, action: { type: 'END_TURN' } });

    const offline = next(host.socket, 'room:state', (r) => r.seats[1]!.connected === false);
    const takeover = next(host.socket, 'room:state', (r) => r.seats[1]!.controller === 'bot');
    const botMoved = next(host.socket, 'game:state', (p) => p.view.turn.current === 0);
    b!.socket.disconnect();
    expect((await offline).seats[1]!.controller).toBe('human');
    await takeover;
    expect((await botMoved).version).toBe(3);
    expect(bot.calls).toEqual([1, 2]);

    // Reconnect: control returns to the human and the socket gets a sync + chat history.
    const again = await connect(srv.url, b!.cookie);
    const sync = next(again, 'game:state');
    const history = next(again, 'chat:history');
    const back = next(host.socket, 'room:state', (r) => r.seats[1]!.controller === 'human');
    const info = await ok(again, 'room:join', { code: room.code });
    expect(info.seats[1]).toMatchObject({ connected: true, controller: 'human' });
    expect((await sync).version).toBe(3);
    expect((await sync).view.viewer).toBe(1);
    await history;
    await back;
  });

  it('acting while covered by the bot reclaims the seat', async () => {
    const srv = await boot({ reconnectGraceMs: 60_000 });
    const { host, b, room } = await startGame(srv);
    const covered = next(host.socket, 'room:state', (r) => r.seats[1]!.controller === 'bot');
    await ok(b!.socket, 'room:leave', {}); // explicit leave in game: bot covers immediately
    await covered;
    await ok(b!.socket, 'room:join', { code: room.code });
    expect(srv.server.rooms.get(room.id)!.seats[1]!.controller).toBe('human');
  });

  it('pauses when no human is connected and resumes on reconnect', async () => {
    const bot = createFakeBot();
    const srv = await boot({ reconnectGraceMs: 50 }, { bots: bot.bots });
    const { host, room } = await startGame(srv, { withB: false });
    host.socket.disconnect();
    await sleep(250);
    const live = srv.server.rooms.get(room.id)!;
    expect(live.runner!.paused).toBe(true);
    expect(live.info().paused).toBe(true);
    expect(live.seats[0]!.controller).toBe('bot');
    expect(bot.calls).toEqual([]); // frozen: the bot did not play the absent host's turn
    expect(live.runner!.state.version).toBe(0);

    const again = await connect(srv.url, host.cookie);
    const sync = next(again, 'game:state');
    const info = await ok(again, 'room:join', { code: room.code });
    expect(info.paused).toBe(false);
    expect(info.seats[0]).toMatchObject({ controller: 'human', connected: true });
    expect((await sync).version).toBe(0);
    await sleep(50);
    expect(bot.calls).toEqual([]);
  });

  it('times out turns, marks repeat offenders AFK and finishes the game', async () => {
    const srv = await boot({}, { engine: createFakeEngine({ turnsToWin: 12 }) });
    const { host, room } = await startGame(srv, { withB: false, turnTimerSec: 1 });
    const sync = await ok(host.socket, 'game:sync', {});
    expect(sync.deadline).toBeGreaterThan(sync.serverNow);
    expect(sync.deadline! - sync.serverNow).toBeLessThanOrEqual(1000);

    const afk = next(host.socket, 'room:state', (r) => r.seats[0]!.controller === 'bot', 8000);
    const finished = next(host.socket, 'room:state', (r) => r.status === 'finished', 8000);
    await afk;
    const done: RoomInfo = await finished;
    expect(done.status).toBe('finished');

    const game = srv.server.repos.games.get(srv.server.rooms.get(room.id)!.gameId!)!;
    expect(game.status).toBe('finished');
    expect(game.winner).not.toBeNull();
    expect(srv.server.repos.rooms.byId(room.id)!.status).toBe('finished');
    const actors = srv.server.repos.games.actionsFrom(game.id, 0).map((a) => a.actor);
    expect(actors.slice(0, 4)).toEqual(['timeout', 'bot', 'bot', 'timeout']);
    expect(
      await emit(host.socket, 'game:action', {
        expectedVersion: 0,
        action: { type: 'END_TURN' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'GAME_OVER' } });
  });

  it('recovers in-game rooms after a restart at the same version', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hexhaven-'));
    const dbPath = join(dir, 'game.sqlite');
    try {
      const first = await boot({ dbPath });
      const { host, room } = await startGame(first, { withB: false });
      const round = next(host.socket, 'game:state', (p) => p.version === 3);
      await ok(host.socket, 'game:action', { expectedVersion: 0, action: { type: 'END_TURN' } });
      await round;
      // Not snapshotted (only END_TURN is): exercises replay of the action log.
      await ok(host.socket, 'game:action', { expectedVersion: 3, action: { type: 'BUY_DEV' } });
      const before = await fullState(first, room.code);
      expect(before.version).toBe(4);
      await first.close();
      servers = servers.filter((s) => s !== first);

      const second = await boot({ dbPath });
      const live = second.server.rooms.get(room.id)!;
      expect(live.runner!.paused).toBe(true);
      expect(live.seats[0]!.controller).toBe('human');
      expect(await fullState(second, room.code)).toEqual(before);

      const socket = await connect(second.url, host.cookie);
      const sync = next(socket, 'game:state');
      const info = await ok(socket, 'room:join', { code: room.code });
      expect(info.status).toBe('in_game');
      expect(info.paused).toBe(false);
      expect((await sync).version).toBe(4);
      expect(
        await ok(socket, 'game:action', { expectedVersion: 4, action: { type: 'END_TURN' } }),
      ).toEqual({ version: 5 });
    } finally {
      for (const s of servers) await s.close().catch(() => undefined);
      servers = [];
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('test routes seed, give and expose full state', async () => {
    const srv = await boot();
    const host = await player(srv.url, 'Host');
    const room = await ok(host.socket, 'room:create', { settings: { maxSeats: 3 } });
    await ok(host.socket, 'room:addBot', { seat: 1, difficulty: 'easy' });
    await ok(host.socket, 'room:addBot', { seat: 2, difficulty: 'easy' });
    const post = (path: string, body: unknown) =>
      fetch(`${srv.url}/api/test/rooms/${room.code}/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect((await post('seed', { seed: 'fixed-seed' })).status).toBe(200);
    expect((await post('give', { seat: 0, resources: { ore: 2 } })).status).toBe(409);
    await ok(host.socket, 'room:start', {});
    expect(srv.server.repos.games.activeForRoom(room.id)!.seed).toBe('fixed-seed');

    const pushed = next(host.socket, 'game:state', (p) => p.version === 1);
    expect((await post('give', { seat: 0, resources: { ore: 2, wool: 1 } })).status).toBe(200);
    expect((await pushed).view.players[0]!.resources).toMatchObject({ ore: 2, wool: 1 });
    const full = await fullState(srv, room.code);
    expect(full.bank.ore).toBe(17);
    expect(full.devDeck.length).toBeGreaterThan(0); // unredacted
    expect((await post('give', { seat: 9, resources: {} })).status).toBe(400);
  });

  it('starts a real-engine game and never leaks hidden state', async () => {
    const srv = await boot({}, { engine: realEngine });
    const { host, b } = await startGame(srv);
    const sync = await ok(b!.socket, 'game:sync', {});
    expect(sync.view.viewer).toBe(1);
    expect(sync.view.phase.kind).toBe('setup');
    expect(sync.view.pendingActors).toEqual([0]);
    const raw = JSON.stringify(sync);
    expect(raw).not.toContain('"rng"');
    expect(raw).not.toContain('"devDeck"');
    expect(sync.view.players[0]!.resources).toBeUndefined();
    expect((await ok(host.socket, 'game:sync', {})).view.viewer).toBe(0);
  });
});
