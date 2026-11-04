import { afterEach, describe, expect, it, vi } from 'vitest';
import { CODE_ALPHABET, randomRoomCode } from './codes';
import { realEngine } from './engineApi';
import {
  disconnectAll,
  emit,
  next,
  ok,
  player,
  startServer,
  type TestServer,
} from '../testing/harness';

let srv: TestServer | null = null;
afterEach(async () => {
  disconnectAll();
  await srv?.close();
  srv = null;
});

describe('room codes', () => {
  it('uses 6 unambiguous characters', () => {
    for (let i = 0; i < 200; i++) {
      const c = randomRoomCode();
      expect(c).toMatch(/^[A-Z2-9]{6}$/);
      expect(c).not.toMatch(/[01OI]/);
      for (const ch of c) expect(CODE_ALPHABET).toContain(ch);
    }
  });
});

describe('lobby', () => {
  it('creates a room with the creator as host on seat 0, and lets others join', async () => {
    srv = await startServer();
    const host = await player(srv.url, 'Host');
    const room = await ok(host.socket, 'room:create', { settings: { maxSeats: 3 } });
    expect(room.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(room.hostUserId).toBe(host.userId);
    expect(room.status).toBe('lobby');
    expect(room.seats).toHaveLength(3);
    expect(room.seats[0]).toMatchObject({ kind: 'human', userId: host.userId, connected: true });
    expect(room.seats[0]!.color).toBe('#d9480f');
    expect(room.settings.vpToWin).toBe(10);

    const guest = await player(srv.url, 'Guest');
    const hostSees = next(host.socket, 'room:state', (r) => r.spectators.length === 1);
    const history = next(guest.socket, 'chat:history');
    const joined = await ok(guest.socket, 'room:join', { code: room.code.toLowerCase() });
    expect(joined.spectators).toEqual([{ userId: guest.userId, name: 'Guest' }]);
    expect((await hostSees).id).toBe(room.id);
    expect(await history).toEqual([]);

    const bad = await emit(guest.socket, 'room:join', { code: 'ZZZZZZ' });
    expect(bad).toMatchObject({ ok: false, error: { code: 'ROOM_NOT_FOUND' } });
  });

  it('validates payloads and requires a room', async () => {
    srv = await startServer();
    const a = await player(srv.url, 'A');
    expect(await emit(a.socket, 'room:sit', { seat: 9 } as never)).toMatchObject({
      ok: false,
      error: { code: 'BAD_REQUEST' },
    });
    expect(await emit(a.socket, 'room:sit', { seat: 1 })).toMatchObject({
      ok: false,
      error: { code: 'NOT_IN_ROOM' },
    });
    expect(await emit(a.socket, 'room:join', { code: 'ABC' } as never)).toMatchObject({
      ok: false,
      error: { code: 'BAD_REQUEST' },
    });
  });

  it('enforces sit/stand/ready and host-only commands', async () => {
    srv = await startServer();
    const host = await player(srv.url, 'Host');
    const room = await ok(host.socket, 'room:create', { settings: { maxSeats: 3 } });
    const b = await player(srv.url, 'B');
    await ok(b.socket, 'room:join', { code: room.code });

    expect(await emit(b.socket, 'room:sit', { seat: 0 })).toMatchObject({
      ok: false,
      error: { code: 'SEAT_TAKEN' },
    });
    expect(await emit(b.socket, 'room:ready', { ready: true })).toMatchObject({
      ok: false,
      error: { code: 'NOT_SEATED' },
    });
    await ok(b.socket, 'room:sit', { seat: 1 });
    await ok(b.socket, 'room:sit', { seat: 2 }); // move seats
    const state = next(host.socket, 'room:state', (r) => r.seats[2]!.ready);
    await ok(b.socket, 'room:ready', { ready: true });
    const r = await state;
    expect(r.seats[1]!.kind).toBe('open');
    expect(r.seats[2]).toMatchObject({ userId: b.userId, ready: true });

    for (const [ev, payload] of [
      ['room:addBot', { seat: 1, difficulty: 'easy' }],
      ['room:removeBot', { seat: 1 }],
      ['room:settings', { settings: { vpToWin: 12 } }],
      ['room:start', {}],
      ['room:kick', { userId: host.userId }],
    ] as const) {
      expect(await emit(b.socket, ev, payload as never)).toMatchObject({
        ok: false,
        error: { code: 'NOT_HOST' },
      });
    }

    await ok(host.socket, 'room:addBot', { seat: 1, difficulty: 'hard' });
    expect(await emit(host.socket, 'room:addBot', { seat: 1, difficulty: 'hard' })).toMatchObject({
      ok: false,
      error: { code: 'SEAT_TAKEN' },
    });
    expect(await emit(host.socket, 'room:removeBot', { seat: 0 })).toMatchObject({
      ok: false,
      error: { code: 'NOT_A_BOT' },
    });
    await ok(b.socket, 'room:stand', {});
    const after = await ok(b.socket, 'room:join', { code: room.code });
    expect(after.seats.map((s) => s.kind)).toEqual(['human', 'bot', 'open']);
    expect(after.seats[1]).toMatchObject({ botDifficulty: 'hard', controller: 'bot' });
  });

  it('shrinking maxSeats drops seats beyond and resets ready', async () => {
    srv = await startServer();
    const host = await player(srv.url, 'Host');
    const room = await ok(host.socket, 'room:create', { settings: { maxSeats: 5 } });
    const b = await player(srv.url, 'B');
    await ok(b.socket, 'room:join', { code: room.code });
    await ok(b.socket, 'room:sit', { seat: 4 });
    await ok(host.socket, 'room:addBot', { seat: 3, difficulty: 'normal' });
    const st = next(host.socket, 'room:state', (r) => r.settings.maxSeats === 3);
    await ok(host.socket, 'room:settings', { settings: { maxSeats: 3 } });
    const r = await st;
    expect(r.seats).toHaveLength(3);
    expect(r.spectators.map((s) => s.userId)).toEqual([b.userId]);
  });

  it('validates start: all seats filled, humans ready, variant fits', async () => {
    srv = await startServer();
    const host = await player(srv.url, 'Host');
    const room = await ok(host.socket, 'room:create', { settings: { maxSeats: 3 } });
    const b = await player(srv.url, 'B');
    await ok(b.socket, 'room:join', { code: room.code });
    await ok(b.socket, 'room:sit', { seat: 1 });

    expect(await emit(host.socket, 'room:start', {})).toMatchObject({
      ok: false,
      error: { code: 'SEATS_NOT_FILLED' },
    });
    await ok(host.socket, 'room:addBot', { seat: 2, difficulty: 'normal' });
    expect(await emit(host.socket, 'room:start', {})).toMatchObject({
      ok: false,
      error: { code: 'NOT_READY' },
    });
    await ok(b.socket, 'room:ready', { ready: true });

    await ok(host.socket, 'room:settings', { settings: { variant: 'base', maxSeats: 5 } });
    await ok(host.socket, 'room:addBot', { seat: 3, difficulty: 'normal' });
    await ok(host.socket, 'room:addBot', { seat: 4, difficulty: 'normal' });
    await ok(b.socket, 'room:ready', { ready: true });
    expect(await emit(host.socket, 'room:start', {})).toMatchObject({
      ok: false,
      error: { code: 'INVALID_VARIANT' },
    });

    await ok(host.socket, 'room:settings', {
      settings: { variant: 'auto', maxSeats: 3, numberMode: 'spiral' },
    });
    await ok(b.socket, 'room:ready', { ready: true });
    const started = next(b.socket, 'game:state');
    await ok(host.socket, 'room:start', {});
    const gs = await started;
    expect(gs.view.viewer).toBe(1);
    expect(gs.view.config).toMatchObject({ players: 3, variant: 'base', numberMode: 'spiral' });
    expect(await emit(host.socket, 'room:start', {})).toMatchObject({
      ok: false,
      error: { code: 'NOT_IN_LOBBY' },
    });
    expect(await emit(b.socket, 'room:stand', {})).toMatchObject({
      ok: false,
      error: { code: 'NOT_IN_LOBBY' },
    });
  });

  it('uses ext56 with random numbers for 5-6 players on auto', async () => {
    srv = await startServer();
    const host = await player(srv.url, 'Host');
    await ok(host.socket, 'room:create', {
      settings: { maxSeats: 5, numberMode: 'spiral' },
    });
    for (const seat of [1, 2, 3, 4])
      await ok(host.socket, 'room:addBot', { seat, difficulty: 'easy' });
    const started = next(host.socket, 'game:state');
    await ok(host.socket, 'room:start', {});
    expect((await started).view.config).toMatchObject({
      players: 5,
      variant: 'ext56',
      numberMode: 'random',
    });
  });

  it('Open Seas: scenario VP targets follow the settings and the game starts with them', async () => {
    srv = await startServer({}, { engine: realEngine });
    const host = await player(srv.url, 'Host');
    const room = await ok(host.socket, 'room:create', {
      settings: { maxSeats: 3, variant: 'seafarers', scenario: 'archipelago' },
    });
    expect(room.settings.vpToWin).toBe(13);
    const settle = async (settings: Record<string, unknown>) => {
      const st = next(host.socket, 'room:state');
      await ok(host.socket, 'room:settings', { settings });
      return (await st).settings;
    };
    expect((await settle({ scenario: 'newShores' })).vpToWin).toBe(14);
    expect((await settle({ vpToWin: 11 })).vpToWin).toBe(11);
    // Changing something unrelated keeps a custom target.
    expect((await settle({ discardLimit: 9 })).vpToWin).toBe(11);
    expect((await settle({ scenario: 'archipelago', vpToWin: 12 })).vpToWin).toBe(12);
    expect((await settle({ variant: 'base' })).vpToWin).toBe(10);
    expect((await settle({ variant: 'seafarers' })).vpToWin).toBe(13);

    for (const seat of [1, 2]) await ok(host.socket, 'room:addBot', { seat, difficulty: 'easy' });
    const first = next(host.socket, 'game:state');
    await ok(host.socket, 'room:start', {});
    const { view } = await first;
    expect(view.config).toMatchObject({
      variant: 'seafarers',
      scenario: 'archipelago',
      vpToWin: 13,
    });
    expect(view.board.hexes.some((h) => h.terrain === 'sea')).toBe(true);
  });

  it('passes host to the next human when the host leaves; kicked users cannot rejoin', async () => {
    srv = await startServer();
    const host = await player(srv.url, 'Host');
    const room = await ok(host.socket, 'room:create', {});
    const b = await player(srv.url, 'B');
    const c = await player(srv.url, 'C');
    await ok(b.socket, 'room:join', { code: room.code });
    await ok(b.socket, 'room:sit', { seat: 2 });
    await ok(c.socket, 'room:join', { code: room.code });

    const closed = next(c.socket, 'room:closed');
    await ok(host.socket, 'room:kick', { userId: c.userId });
    expect(await closed).toEqual({ reason: 'kicked' });
    expect(await emit(c.socket, 'room:join', { code: room.code })).toMatchObject({
      ok: false,
      error: { code: 'KICKED' },
    });

    const hostMoved = next(b.socket, 'room:state', (r) => r.hostUserId === b.userId);
    await ok(host.socket, 'room:leave', {});
    const r = await hostMoved;
    expect(r.seats[0]!.kind).toBe('open');
  });

  it('keeps a disconnected owner seat and cleans up empty lobbies', async () => {
    // The idle timer starts when the host's disconnect is processed. Logging in a second player
    // inside that window raced it under load (ROOM_NOT_FOUND), so log in first, wait for the
    // disconnect to land and join with a single emit, well inside the idle window.
    const s = (srv = await startServer({}, { lobbyIdleMs: 300 }));
    const host = await player(s.url, 'Host');
    const again = await player(s.url, 'Other');
    const room = await ok(host.socket, 'room:create', {});
    host.socket.disconnect();
    await vi.waitFor(() => expect(s.server.rooms.get(room.id)!.members.size).toBe(0), {
      interval: 5,
    });
    const j = await ok(again.socket, 'room:join', { code: room.code });
    expect(j.seats[0]!.connected).toBe(false);
    again.socket.disconnect();
    await vi.waitFor(() => expect(s.server.repos.rooms.byCode(room.code)).toBeNull(), {
      timeout: 3000,
    });
    expect(s.server.rooms.get(room.id)).toBeUndefined();
  });

  it('chat persists and is replayed on join', async () => {
    srv = await startServer();
    const a = await player(srv.url, 'A');
    const room = await ok(a.socket, 'room:create', {});
    const got = next(a.socket, 'chat:message');
    await ok(a.socket, 'chat:send', { text: '  hello  ' });
    expect(await got).toMatchObject({ text: 'hello', name: 'A', userId: a.userId });
    expect(await emit(a.socket, 'chat:send', { text: '   ' })).toMatchObject({ ok: false });

    const b = await player(srv.url, 'B');
    const hist = next(b.socket, 'chat:history');
    await ok(b.socket, 'room:join', { code: room.code });
    expect((await hist).map((m) => m.text)).toEqual(['hello']);

    // 5 per 10 s per socket
    for (let i = 0; i < 4; i++) await ok(a.socket, 'chat:send', { text: `m${i}` });
    expect(await emit(a.socket, 'chat:send', { text: 'spam' })).toMatchObject({
      ok: false,
      error: { code: 'RATE_LIMITED' },
    });
  });
});
