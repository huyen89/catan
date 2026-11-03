import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ServerDeps } from '../app';
import type { Config } from '../config';
import { createFakeEngine } from '../testing/fakeEngine';
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
import type { StatsResponse } from '@hexhaven/shared';
import type { EngineApi } from './engineApi';

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

/** Host (seat 0) + human B (seat 1) + bot (seat 2), 3-turn fake game. */
async function lobbyOfThree(srv: TestServer) {
  const host = await player(srv.url, 'Host');
  const room = await ok(host.socket, 'room:create', { settings: { maxSeats: 3 } });
  const b = await player(srv.url, 'B');
  await ok(b.socket, 'room:join', { code: room.code });
  await ok(b.socket, 'room:sit', { seat: 1 });
  await ok(b.socket, 'room:ready', { ready: true });
  await ok(host.socket, 'room:addBot', { seat: 2, difficulty: 'easy' });
  return { host, b, room };
}

describe('room:rematch', () => {
  it('returns a finished room to the lobby with the same seats and starts a new game', async () => {
    const srv = await boot({}, { engine: createFakeEngine({ turnsToWin: 3 }) });
    const { host, b, room } = await lobbyOfThree(srv);

    expect(await emit(host.socket, 'room:rematch', {})).toMatchObject({
      ok: false,
      error: { code: 'ALREADY_IN_LOBBY' },
    });

    await ok(host.socket, 'room:start', {});
    expect(await emit(host.socket, 'room:rematch', {})).toMatchObject({
      ok: false,
      error: { code: 'GAME_NOT_OVER' },
    });

    const finished = next(host.socket, 'room:state', (r) => r.status === 'finished');
    await ok(host.socket, 'game:action', { expectedVersion: 0, action: { type: 'END_TURN' } });
    const s1 = await ok(b.socket, 'game:sync', {});
    await ok(b.socket, 'game:action', {
      expectedVersion: s1.version,
      action: { type: 'END_TURN' },
    });
    const done = await finished;
    const firstGame = done.gameId!;

    expect(await emit(b.socket, 'room:rematch', {})).toMatchObject({
      ok: false,
      error: { code: 'NOT_HOST' },
    });

    const bSees = next(b.socket, 'room:state', (r) => r.status === 'lobby');
    await ok(host.socket, 'room:rematch', {});
    const lobby = await bSees;
    expect(lobby.gameId).toBeNull();
    expect(lobby.seats.map((s) => [s.kind, s.userId, s.ready])).toEqual([
      ['human', host.userId, false],
      ['human', b.userId, false],
      ['bot', null, false],
    ]);
    expect(srv.server.repos.rooms.byId(room.id)!.status).toBe('lobby');
    expect(await emit(host.socket, 'game:sync', {})).toMatchObject({
      ok: false,
      error: { code: 'NO_GAME' },
    });

    // Humans must ready up again.
    expect(await emit(host.socket, 'room:start', {})).toMatchObject({
      ok: false,
      error: { code: 'NOT_READY' },
    });
    await ok(b.socket, 'room:ready', { ready: true });
    const fresh = next(b.socket, 'game:state', (p) => p.gameId !== firstGame);
    await ok(host.socket, 'room:start', {});
    const p = await fresh;
    expect(p.version).toBe(0);
    expect(srv.server.repos.games.get(firstGame)!.status).toBe('finished');
    expect(srv.server.repos.games.activeForRoom(room.id)!.id).toBe(p.gameId);
  });

  it('keeps game history when an idle rematch lobby is dropped', async () => {
    const srv = await boot({}, { engine: createFakeEngine({ turnsToWin: 1 }), lobbyIdleMs: 50 });
    const host = await player(srv.url, 'Host');
    const room = await ok(host.socket, 'room:create', { settings: { maxSeats: 3 } });
    await ok(host.socket, 'room:addBot', { seat: 1, difficulty: 'easy' });
    await ok(host.socket, 'room:addBot', { seat: 2, difficulty: 'easy' });
    await ok(host.socket, 'room:start', {});
    const finished = next(host.socket, 'room:state', (r) => r.status === 'finished');
    await ok(host.socket, 'game:action', { expectedVersion: 0, action: { type: 'END_TURN' } });
    const { gameId } = await finished;
    await ok(host.socket, 'room:rematch', {});
    await ok(host.socket, 'room:leave', {});
    await new Promise((r) => setTimeout(r, 150));
    expect(srv.server.rooms.get(room.id)).toBeUndefined();
    expect(srv.server.repos.games.get(gameId!)!.status).toBe('finished');
    expect(srv.server.repos.rooms.byId(room.id)!.status).toBe('finished');

    // The finished room can be reopened by code and rematched again.
    const again = await ok(host.socket, 'room:join', { code: room.code });
    expect(again.status).toBe('finished');
    await ok(host.socket, 'room:rematch', {});
  });
});

describe('rematch and kicks: review fixes', () => {
  /** Host END_TURN, then seats 1 and 2 are bot-driven: the 3-turn fake game ends on its own. */
  async function hostEndsFirstTurn(host: { socket: Parameters<typeof ok>[0] }) {
    const finished = next(host.socket, 'room:state', (r) => r.status === 'finished');
    await ok(host.socket, 'game:action', { expectedVersion: 0, action: { type: 'END_TURN' } });
    return finished;
  }

  it('opens the seats of humans who left before the rematch', async () => {
    const srv = await boot({}, { engine: createFakeEngine({ turnsToWin: 3 }) });
    const { host, b } = await lobbyOfThree(srv);
    await ok(host.socket, 'room:start', {});
    await ok(b.socket, 'room:leave', {}); // seat 1 is now driven by the bot
    await hostEndsFirstTurn(host);

    const lobby = next(host.socket, 'room:state', (r) => r.status === 'lobby');
    await ok(host.socket, 'room:rematch', {});
    expect((await lobby).seats.map((s) => s.kind)).toEqual(['human', 'open', 'bot']);
    // The departed player was not banned: they can come back and sit again.
    await ok(b.socket, 'room:join', { code: (await lobby).code });
    await ok(b.socket, 'room:sit', { seat: 1 });
    await ok(b.socket, 'room:ready', { ready: true });
    await ok(host.socket, 'room:start', {});
  });

  it("a kick mid-game hands the seat's result to the bot in history and stats", async () => {
    const srv = await boot({}, { engine: createFakeEngine({ turnsToWin: 3 }) });
    const { host, b, room } = await lobbyOfThree(srv);
    await ok(host.socket, 'room:start', {});
    const gameId = srv.server.rooms.get(room.id)!.gameId!;
    await ok(host.socket, 'room:kick', { userId: b.userId });
    expect(srv.server.repos.games.players(gameId)[1]).toMatchObject({
      kind: 'bot',
      userId: null,
      name: 'Bot 2',
    });
    await hostEndsFirstTurn(host);

    const get = (path: string, cookie: string) =>
      fetch(`${srv.url}${path}`, { headers: { cookie } });
    expect(await (await get('/api/games', b.cookie)).json()).toEqual({ games: [] });
    expect((await get(`/api/games/${gameId}/replay`, b.cookie)).status).toBe(404);
    const stats = (await (await get('/api/stats', host.cookie)).json()) as StatsResponse;
    expect(stats.played).toBe(1);
    expect(stats.opponents).toEqual([]);
  });

  it('a finished room loaded only for a rejected join does not stay in memory', async () => {
    const srv = await boot({}, { engine: createFakeEngine({ turnsToWin: 3 }), lobbyIdleMs: 50 });
    const { host, b, room } = await lobbyOfThree(srv);
    await ok(host.socket, 'room:kick', { userId: b.userId });
    await ok(host.socket, 'room:addBot', { seat: 1, difficulty: 'easy' });
    await ok(host.socket, 'room:start', {});
    await hostEndsFirstTurn(host);
    await ok(host.socket, 'room:leave', {});
    await sleep(150);
    expect(srv.server.rooms.get(room.id)).toBeUndefined();

    expect(await emit(b.socket, 'room:join', { code: room.code })).toMatchObject({
      ok: false,
      error: { code: 'KICKED' },
    });
    expect(srv.server.rooms.get(room.id)).toBeDefined();
    await sleep(150);
    expect(srv.server.rooms.get(room.id)).toBeUndefined();
  });

  it('a rematch lobby that survives a restart is marked finished, keeping its history', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hexhaven-'));
    const dbPath = join(dir, 'rematch.sqlite');
    try {
      const first = await boot({ dbPath }, { engine: createFakeEngine({ turnsToWin: 3 }) });
      const { host, b, room } = await lobbyOfThree(first);
      await ok(host.socket, 'room:start', {});
      const gameId = first.server.rooms.get(room.id)!.gameId!;
      await ok(host.socket, 'room:kick', { userId: b.userId });
      await hostEndsFirstTurn(host);
      await ok(host.socket, 'room:rematch', {});
      expect(first.server.repos.rooms.byId(room.id)!.status).toBe('lobby');
      await first.close();
      servers = servers.filter((s) => s !== first);

      const second = await boot({ dbPath });
      expect(second.server.repos.rooms.byId(room.id)!.status).toBe('finished');
      expect(second.server.repos.games.get(gameId)!.status).toBe('finished');
      const socket = await connect(second.url, host.cookie);
      expect((await ok(socket, 'room:join', { code: room.code })).status).toBe('finished');
      await ok(socket, 'room:rematch', {});
    } finally {
      for (const s of servers) await s.close().catch(() => undefined);
      servers = [];
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('kick list persistence', () => {
  it('kicked users cannot rejoin after a restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hexhaven-'));
    const dbPath = join(dir, 'kick.sqlite');
    try {
      const first = await boot({ dbPath });
      const host = await player(first.url, 'Host');
      const room = await ok(host.socket, 'room:create', { settings: { maxSeats: 3 } });
      const bad = await player(first.url, 'Bad');
      await ok(bad.socket, 'room:join', { code: room.code });
      await ok(bad.socket, 'room:sit', { seat: 1 });
      await ok(host.socket, 'room:kick', { userId: bad.userId });
      expect(first.server.repos.rooms.kicksOf(room.id)).toEqual([bad.userId]);
      await first.close();
      servers = servers.filter((s) => s !== first);

      const second = await boot({ dbPath });
      const socket = await connect(second.url, bad.cookie);
      expect(await emit(socket, 'room:join', { code: room.code })).toMatchObject({
        ok: false,
        error: { code: 'KICKED' },
      });
      const hostAgain = await connect(second.url, host.cookie);
      const info = await ok(hostAgain, 'room:join', { code: room.code });
      expect(info.seats[1]!.kind).toBe('open');
    } finally {
      for (const s of servers) await s.close().catch(() => undefined);
      servers = [];
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('broadcast fan-out', () => {
  it('redacts once per seat per version, shared by spectators, syncs and bots', async () => {
    const base = createFakeEngine();
    const calls: Array<{ version: number; viewer: number | null }> = [];
    const engine: EngineApi = {
      ...base,
      toPlayerView: (state, viewer) => {
        calls.push({ version: state.version, viewer });
        return base.toPlayerView(state, viewer);
      },
    };
    const srv = await boot({}, { engine });
    const { host, b, room } = await lobbyOfThree(srv);
    const spectators = await Promise.all(
      [1, 2, 3, 4].map(async (i) => {
        const s = await player(srv.url, `Spec${i}`);
        await ok(s.socket, 'room:join', { code: room.code });
        return s;
      }),
    );

    // Every member gets version 2 (bot seat 2 has just played) and the right view.
    const v2 = [host, b, ...spectators].map((m) =>
      next(m.socket, 'game:state', (p) => p.version === 2),
    );
    await ok(host.socket, 'room:start', {});
    await ok(host.socket, 'game:action', { expectedVersion: 0, action: { type: 'END_TURN' } });
    await ok(b.socket, 'game:action', { expectedVersion: 1, action: { type: 'END_TURN' } });
    const payloads = await Promise.all(v2);
    expect(payloads.map((p) => p.view.viewer)).toEqual([0, 1, null, null, null, null]);

    for (const s of spectators) await ok(s.socket, 'game:sync', {});
    await ok(host.socket, 'game:sync', {});

    const perVersion = new Map<number, Array<number | null>>();
    for (const c of calls)
      perVersion.set(c.version, [...(perVersion.get(c.version) ?? []), c.viewer]);
    for (const [, viewers] of perVersion) {
      // Never more than one redaction per (version, viewer seat).
      expect(new Set(viewers).size).toBe(viewers.length);
    }
    // Four spectators at version 0 shared a single spectator view.
    expect(perVersion.get(0)!.filter((v) => v === null)).toHaveLength(1);
    // Version 2 is the bot's turn: its view was computed once for the bot.
    expect(perVersion.get(2)!.filter((v) => v === 2)).toHaveLength(1);
  });
});
