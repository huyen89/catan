import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { GameListResponse, ReplayResponse, StatsResponse } from '@hexhaven/shared';
import { createFakeEngine } from '../testing/fakeEngine';
import { disconnectAll, next, ok, player, startServer, type TestServer } from '../testing/harness';
import { computeStats } from './history';

let srv: TestServer | null = null;
afterEach(async () => {
  disconnectAll();
  await srv?.close();
  srv = null;
});

const get = (path: string, cookie?: string) =>
  fetch(`${srv!.url}${path}`, { headers: cookie ? { cookie } : {} });

/**
 * Host (seat 0) and B (seat 1) play a fake 3-turn game against a bot (seat 2). The host buys
 * two cards (fake final VP = cards held) and B one; the bot ends turn 3 and wins.
 */
async function playFinishedGame(s: TestServer) {
  const host = await player(s.url, 'Host');
  const room = await ok(host.socket, 'room:create', { settings: { maxSeats: 3 } });
  const b = await player(s.url, 'B');
  await ok(b.socket, 'room:join', { code: room.code });
  await ok(b.socket, 'room:sit', { seat: 1 });
  await ok(b.socket, 'room:ready', { ready: true });
  await ok(host.socket, 'room:addBot', { seat: 2, difficulty: 'easy' });
  await ok(host.socket, 'room:start', {});
  const gameId = s.server.rooms.get(room.id)!.gameId!;
  return { host, b, room, gameId };
}

async function finish(h: Awaited<ReturnType<typeof playFinishedGame>>) {
  const done = next(h.host.socket, 'room:state', (r) => r.status === 'finished');
  let v = (
    await ok(h.host.socket, 'game:action', { expectedVersion: 0, action: { type: 'BUY_DEV' } })
  ).version;
  v = (await ok(h.host.socket, 'game:action', { expectedVersion: v, action: { type: 'BUY_DEV' } }))
    .version;
  v = (await ok(h.host.socket, 'game:action', { expectedVersion: v, action: { type: 'END_TURN' } }))
    .version;
  v = (await ok(h.b.socket, 'game:action', { expectedVersion: v, action: { type: 'BUY_DEV' } }))
    .version;
  await ok(h.b.socket, 'game:action', { expectedVersion: v, action: { type: 'END_TURN' } });
  await done;
}

describe('history REST', () => {
  it('requires a session', async () => {
    srv = await startServer();
    expect((await get('/api/games')).status).toBe(401);
    expect((await get('/api/stats')).status).toBe(401);
    expect((await get(`/api/games/${randomUUID()}/replay`)).status).toBe(401);
  });

  it('lists games, serves replays only to participants of finished games, and aggregates stats', async () => {
    srv = await startServer({}, { engine: createFakeEngine({ turnsToWin: 3 }) });
    const h = await playFinishedGame(srv);
    const outsider = await player(srv.url, 'Outsider');

    // Active game: listed without VP, replay refused.
    const active = (await (await get('/api/games', h.host.cookie)).json()) as GameListResponse;
    expect(active.games).toHaveLength(1);
    expect(active.games[0]).toMatchObject({
      gameId: h.gameId,
      roomCode: h.room.code,
      status: 'active',
      mySeat: 0,
      winner: null,
      turns: 1,
      finishedAt: null,
    });
    expect(active.games[0]!.players.every((p) => p.vp === null)).toBe(true);
    const early = await get(`/api/games/${h.gameId}/replay`, h.host.cookie);
    expect(early.status).toBe(403);
    expect(await early.json()).toMatchObject({ error: { code: 'GAME_NOT_FINISHED' } });

    await finish(h);

    const list = (await (await get('/api/games', h.b.cookie)).json()) as GameListResponse;
    expect(list.games).toHaveLength(1);
    const g = list.games[0]!;
    expect(g).toMatchObject({
      status: 'finished',
      winner: 2,
      mySeat: 1,
      turns: 3,
      variant: 'base',
    });
    expect(g.finishedAt).toBeGreaterThanOrEqual(g.createdAt);
    expect(g.players).toEqual([
      { seat: 0, name: 'Host', kind: 'human', userId: h.host.userId, vp: 2 },
      { seat: 1, name: 'B', kind: 'human', userId: h.b.userId, vp: 1 },
      { seat: 2, name: 'Bot 3', kind: 'bot', userId: null, vp: 0 },
    ]);
    expect(
      ((await (await get('/api/games', outsider.cookie)).json()) as GameListResponse).games,
    ).toEqual([]);

    const replayRes = await get(`/api/games/${h.gameId}/replay`, h.host.cookie);
    expect(replayRes.status).toBe(200);
    const replay = (await replayRes.json()) as ReplayResponse;
    expect(replay.seed).toBe(srv.server.repos.games.get(h.gameId)!.seed);
    expect(replay.summary.mySeat).toBe(0);
    expect(replay.config.players).toBe(3);
    expect(replay.actions.map((a) => [a.seat, a.action.type])).toEqual([
      [0, 'BUY_DEV'],
      [0, 'BUY_DEV'],
      [0, 'END_TURN'],
      [1, 'BUY_DEV'],
      [1, 'END_TURN'],
      [2, 'END_TURN'],
    ]);
    // Replaying the log with the engine reproduces the final state.
    const engine = createFakeEngine({ turnsToWin: 3 });
    let state = engine.createGame(replay.config, replay.seed);
    for (const a of replay.actions) {
      const r = engine.applyAction(state, a.seat, a.action);
      if (!r.ok) throw new Error(r.error.code);
      state = r.state;
    }
    expect(state.phase).toEqual({ kind: 'gameOver', winner: 2 });

    const denied = await get(`/api/games/${h.gameId}/replay`, outsider.cookie);
    expect(denied.status).toBe(404);
    expect((await get(`/api/games/${randomUUID()}/replay`, h.host.cookie)).status).toBe(404);
    expect((await get('/api/games/not-a-uuid/replay', h.host.cookie)).status).toBe(400);

    const stats = (await (await get('/api/stats', h.host.cookie)).json()) as StatsResponse;
    expect(stats).toEqual({
      played: 1,
      won: 0,
      avgVp: 2,
      byVariant: { base: { played: 1, won: 0 } },
      opponents: [{ userId: h.b.userId, name: 'B', games: 1, yourWins: 0, theirWins: 0 }],
    });
    expect(await (await get('/api/stats', outsider.cookie)).json()).toEqual({
      played: 0,
      won: 0,
      avgVp: 0,
      byVariant: {},
      opponents: [],
    });
  });

  it('caps the list at 50 games, newest first', async () => {
    srv = await startServer();
    const me = await player(srv.url, 'Me');
    const { repos } = srv.server;
    repos.rooms.save({
      id: 'r1',
      code: 'ABCDEF',
      hostUserId: me.userId,
      status: 'finished',
      settings: (await ok(me.socket, 'room:create', {})).settings,
      updatedAt: 1,
      seats: [],
    });
    for (let i = 0; i < 55; i++) {
      repos.games.create(
        {
          id: randomUUID(),
          roomId: 'r1',
          config: createFakeEngine().normalizeConfig({ players: 3 }),
          seed: `s${i}`,
          engineVersion: 0,
          createdAt: 1000 + i,
          turns: 1,
        },
        [{ seat: 0, kind: 'human', userId: me.userId, name: 'Me' }],
      );
    }
    const list = (await (await get('/api/games', me.cookie)).json()) as GameListResponse;
    expect(list.games).toHaveLength(50);
    expect(list.games[0]!.createdAt).toBe(1054);
    expect(list.games[49]!.createdAt).toBe(1005);
  });
});

describe('computeStats', () => {
  const config = createFakeEngine().normalizeConfig({ players: 3 });
  const game = (
    id: string,
    winner: number,
    variant: 'base' | 'ext56',
    players: Array<[string | null, number]>,
    status: 'finished' | 'active' = 'finished',
  ) => ({
    id,
    roomId: 'r',
    roomCode: 'ABCDEF',
    config: { ...config, variant },
    seed: 's',
    status,
    winner,
    engineVersion: 0,
    createdAt: 0,
    finishedAt: 1,
    turns: 10,
    players: players.map(([userId, vp], seat) => ({
      seat,
      kind: userId ? ('human' as const) : ('bot' as const),
      userId,
      name: userId ?? `Bot ${seat + 1}`,
      vp,
    })),
  });

  it('aggregates wins, VP, variants and head-to-head', () => {
    const s = computeStats(
      [
        game('1', 0, 'base', [
          ['me', 10],
          ['ann', 7],
          [null, 5],
        ]),
        game('2', 1, 'base', [
          ['me', 6],
          ['ann', 10],
          ['bob', 4],
        ]),
        game('3', 2, 'ext56', [
          ['me', 8],
          ['bob', 3],
          [null, 10],
        ]),
        game(
          '4',
          0,
          'base',
          [
            ['me', 10],
            ['ann', 2],
          ],
          'active',
        ),
      ],
      'me',
      (id) => (id === 'ann' ? 'Ann (renamed)' : null),
    );
    expect(s.played).toBe(3);
    expect(s.won).toBe(1);
    expect(s.avgVp).toBe(8);
    expect(s.byVariant).toEqual({ base: { played: 2, won: 1 }, ext56: { played: 1, won: 0 } });
    expect(s.opponents).toEqual([
      { userId: 'ann', name: 'Ann (renamed)', games: 2, yourWins: 1, theirWins: 1 },
      { userId: 'bob', name: 'bob', games: 2, yourWins: 0, theirWins: 0 },
    ]);
  });
});
