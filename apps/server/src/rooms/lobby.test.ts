import { afterEach, describe, expect, it } from 'vitest';
import { CODE_ALPHABET, randomRoomCode } from './codes';
import {
  disconnectAll,
  emit,
  next,
  ok,
  player,
  sleep,
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

  it('passes the Open Seas scenario to the engine only for the seafarers variant', async () => {
    srv = await startServer();
    const host = await player(srv.url, 'Host');
    await ok(host.socket, 'room:create', {
      settings: { maxSeats: 3, variant: 'seafarers', scenario: 'archipelago' },
    });
    for (const seat of [1, 2]) await ok(host.socket, 'room:addBot', { seat, difficulty: 'easy' });
    const started = next(host.socket, 'game:state');
    await ok(host.socket, 'room:start', {});
    expect((await started).view.config).toMatchObject({
      players: 3,
      variant: 'seafarers',
      scenario: 'archipelago',
    });

    const other = await player(srv.url, 'Other');
    await ok(other.socket, 'room:create', {
      settings: { maxSeats: 3, variant: 'base', scenario: 'archipelago' },
    });
    for (const seat of [1, 2]) await ok(other.socket, 'room:addBot', { seat, difficulty: 'easy' });
    const plain = next(other.socket, 'game:state');
    await ok(other.socket, 'room:start', {});
    expect(Object.keys((await plain).view.config)).not.toContain('scenario');
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
    srv = await startServer({}, { lobbyIdleMs: 50 });
    const host = await player(srv.url, 'Host');
    const room = await ok(host.socket, 'room:create', {});
    host.socket.disconnect();
    await sleep(20);
    const again = await player(srv.url, 'Other');
    const j = await ok(again.socket, 'room:join', { code: room.code });
    expect(j.seats[0]!.connected).toBe(false);
    again.socket.disconnect();
    await sleep(150);
    expect(srv.server.repos.rooms.byCode(room.code)).toBeNull();
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
