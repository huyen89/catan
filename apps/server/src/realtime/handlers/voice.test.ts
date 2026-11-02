import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Ack, ClientToServerEvents, ServerToClientEvents } from '@hexhaven/shared';
import { ioRooms, type HexServer, type HexSocket } from '../types';
import { isInVoice, leaveVoice, registerVoiceHandlers, type VoiceHooks } from './voice';

type Client = ClientSocket<ServerToClientEvents, ClientToServerEvents>;
/** Untyped view of a client for sending malformed payloads. */
type RawClient = { emitWithAck(ev: string, ...args: unknown[]): Promise<unknown> };

const OFFER = { description: { type: 'offer' as const, sdp: 'v=0\r\n' } };

let http: HttpServer;
let io: HexServer;
let url: string;
let hookCalls: Array<{ roomId: string; userId: string; inVoice: boolean; muted: boolean }>;
let hooks: VoiceHooks;
const serverSockets = new Map<string, HexSocket>();
const clients: Client[] = [];

beforeEach(async () => {
  hookCalls = [];
  hooks = { onVoiceState: (roomId, userId, s) => hookCalls.push({ roomId, userId, ...s }) };
  http = createServer();
  io = new Server(http);
  // Stand-in for the server workstream's auth middleware.
  io.use((socket, next) => {
    const auth = socket.handshake.auth as { userId: string; roomId?: string; tag?: string };
    socket.data = { userId: auth.userId, name: auth.userId, roomId: auth.roomId ?? null };
    next();
  });
  io.on('connection', (socket) => {
    serverSockets.set((socket.handshake.auth as { tag: string }).tag, socket);
    void socket.join(ioRooms.user(socket.data.userId));
    if (socket.data.roomId) void socket.join(ioRooms.room(socket.data.roomId));
    registerVoiceHandlers(io, socket, hooks);
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.disconnect();
  serverSockets.clear();
  await io.close();
});

async function client(userId: string, roomId: string | null, tag = userId): Promise<Client> {
  const c: Client = connect(url, {
    auth: { userId, roomId: roomId ?? undefined, tag },
    transports: ['websocket'],
    forceNew: true,
  });
  clients.push(c);
  await new Promise<void>((resolve, reject) => {
    c.once('connect', () => resolve());
    c.once('connect_error', reject);
  });
  return c;
}

function next<E extends keyof ServerToClientEvents>(
  c: Client,
  ev: E,
): Promise<Parameters<ServerToClientEvents[E]>[0]> {
  return new Promise((resolve) => {
    c.once(ev, ((p: Parameters<ServerToClientEvents[E]>[0]) => resolve(p)) as never);
  });
}

function record<E extends keyof ServerToClientEvents>(
  c: Client,
  ev: E,
): Array<Parameters<ServerToClientEvents[E]>[0]> {
  const out: Array<Parameters<ServerToClientEvents[E]>[0]> = [];
  c.on(ev, ((p: Parameters<ServerToClientEvents[E]>[0]) => out.push(p)) as never);
  return out;
}

const join = (c: Client) => c.timeout(2000).emitWithAck('voice:join', {});
const signal = (c: Client, to: string, data = OFFER) =>
  c.timeout(2000).emitWithAck('voice:signal', { to, data });
const raw = (c: Client) => c.timeout(2000) as unknown as RawClient;
const settle = () => new Promise((r) => setTimeout(r, 100));

function errCode(ack: Ack<unknown>): string | null {
  return ack.ok ? null : ack.error.code;
}

describe('voice:join', () => {
  it('acks with the other voice members and notifies peers and the room', async () => {
    const a = await client('alice', 'r1');
    const b = await client('bob', 'r1');
    const watcher = await client('carol', 'r1');
    const roomStates = record(watcher, 'voice:state');

    expect(await join(a)).toEqual({ ok: true, data: { peers: [] } });
    const joined = next(a, 'voice:peerJoined');
    expect(await join(b)).toEqual({
      ok: true,
      data: { peers: [{ userId: 'alice', muted: true }] },
    });
    expect(await joined).toEqual({ userId: 'bob' });

    await settle();
    expect(roomStates).toEqual([
      { userId: 'alice', muted: true, inVoice: true },
      { userId: 'bob', muted: true, inVoice: true },
    ]);
    expect(hookCalls).toEqual([
      { roomId: 'r1', userId: 'alice', inVoice: true, muted: true },
      { roomId: 'r1', userId: 'bob', inVoice: true, muted: true },
    ]);
  });

  it('requires being in a room', async () => {
    const a = await client('alice', null);
    expect(errCode(await join(a))).toBe('not_in_room');
    expect(hookCalls).toEqual([]);
  });

  it('a second tab of the same user takes over the voice session', async () => {
    const a = await client('alice', 'r1');
    const b1 = await client('bob', 'r1', 'bob-1');
    const b2 = await client('bob', 'r1', 'bob-2');
    await join(a);
    const firstJoin = next(a, 'voice:peerJoined');
    await join(b1);
    await firstJoin;
    const b1Ended = next(b1, 'voice:peerLeft');
    const aEvents: string[] = [];
    a.on('voice:peerLeft', (p) => aEvents.push(`left:${p.userId}`));
    a.on('voice:peerJoined', (p) => aEvents.push(`joined:${p.userId}`));

    expect(await join(b2)).toEqual({
      ok: true,
      data: { peers: [{ userId: 'alice', muted: true }] },
    });
    expect(await b1Ended).toEqual({ userId: 'bob' });
    await settle();
    expect(aEvents).toEqual(['left:bob', 'joined:bob']);
    expect(isInVoice(serverSockets.get('bob-1')!)).toBe(false);
    expect(isInVoice(serverSockets.get('bob-2')!)).toBe(true);
  });

  it('dedupes peers by user id', async () => {
    const a = await client('alice', 'r1');
    await join(a);
    const b = await client('bob', 'r1');
    expect(await join(b)).toEqual({
      ok: true,
      data: { peers: [{ userId: 'alice', muted: true }] },
    });
  });
});

describe('voice:join mute state and cap', () => {
  const prevMax = process.env.VOICE_MAX_PEERS;
  afterEach(() => {
    if (prevMax === undefined) delete process.env.VOICE_MAX_PEERS;
    else process.env.VOICE_MAX_PEERS = prevMax;
  });

  it("reports each peer's current mic state in the ack", async () => {
    const a = await client('alice', 'r1');
    const b = await client('bob', 'r1');
    await join(a);
    await join(b);
    await a.timeout(2000).emitWithAck('voice:state', { muted: false });
    const c = await client('carol', 'r1');
    const ack = await join(c);
    expect(ack.ok && [...ack.data.peers].sort((x, y) => x.userId.localeCompare(y.userId))).toEqual([
      { userId: 'alice', muted: false },
      { userId: 'bob', muted: true },
    ]);
  });

  it('refuses joins beyond VOICE_MAX_PEERS without disturbing the channel', async () => {
    process.env.VOICE_MAX_PEERS = '2';
    const a = await client('alice', 'r1');
    const b1 = await client('bob', 'r1', 'bob-1');
    const c = await client('carol', 'r1');
    await join(a);
    await join(b1);
    await settle();
    const aEvents = record(a, 'voice:peerJoined');
    hookCalls = [];
    expect(errCode(await join(c))).toBe('voice_full');
    expect(isInVoice(serverSockets.get('carol')!)).toBe(false);

    // Members (and a member's new tab taking over) are not counted against the cap.
    expect((await join(b1)).ok).toBe(true);
    const b2 = await client('bob', 'r1', 'bob-2');
    expect((await join(b2)).ok).toBe(true);
    expect(isInVoice(serverSockets.get('bob-2')!)).toBe(true);

    // Other rooms have their own channel.
    const d = await client('dave', 'r2');
    expect((await join(d)).ok).toBe(true);

    // A slot frees up when someone leaves.
    await a.timeout(2000).emitWithAck('voice:leave', {});
    expect((await join(c)).ok).toBe(true);
    await settle();
    expect(aEvents.map((e) => e.userId)).toEqual(['bob', 'bob']);
    expect(hookCalls.some((h) => h.userId === 'carol' && h.inVoice)).toBe(true);
  });
});

describe('voice:signal', () => {
  it('relays between members of the same voice channel with the sender id', async () => {
    const a = await client('alice', 'r1');
    const b = await client('bob', 'r1');
    await join(a);
    await join(b);
    const got = next(b, 'voice:signal');
    expect(await signal(a, 'bob')).toEqual({ ok: true, data: undefined });
    expect(await got).toEqual({ from: 'alice', data: OFFER });

    const cand = {
      candidate: { candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host', sdpMid: '0' },
    };
    const got2 = next(a, 'voice:signal');
    expect(await b.timeout(2000).emitWithAck('voice:signal', { to: 'alice', data: cand })).toEqual({
      ok: true,
      data: undefined,
    });
    expect(await got2).toEqual({ from: 'bob', data: cand });
  });

  it('never relays to a user in another room', async () => {
    const a = await client('alice', 'r1');
    const c = await client('carol', 'r2');
    await join(a);
    await join(c);
    const received = record(c, 'voice:signal');
    expect(errCode(await signal(a, 'carol'))).toBe('peer_not_in_voice');
    await settle();
    expect(received).toEqual([]);
  });

  it('does not relay to room members who are not in voice', async () => {
    const a = await client('alice', 'r1');
    const b = await client('bob', 'r1');
    await join(a);
    const received = record(b, 'voice:signal');
    expect(errCode(await signal(a, 'bob'))).toBe('peer_not_in_voice');
    await settle();
    expect(received).toEqual([]);
  });

  it('rejects senders who are not in voice', async () => {
    const a = await client('alice', 'r1');
    const b = await client('bob', 'r1');
    await join(b);
    const received = record(b, 'voice:signal');
    expect(errCode(await signal(a, 'bob'))).toBe('not_in_voice');
    await settle();
    expect(received).toEqual([]);
  });

  it("delivers only to the target's voice socket, not their other tabs", async () => {
    const a = await client('alice', 'r1');
    const bVoice = await client('bob', 'r1', 'bob-voice');
    const bOther = await client('bob', 'r1', 'bob-other');
    await join(a);
    await join(bVoice);
    const other = record(bOther, 'voice:signal');
    const got = next(bVoice, 'voice:signal');
    await signal(a, 'bob');
    await got;
    await settle();
    expect(other).toEqual([]);
  });

  it('stops relaying once the sender moved to another room', async () => {
    const a = await client('alice', 'r1');
    const b = await client('bob', 'r1');
    await join(a);
    await join(b);
    const left = next(b, 'voice:peerLeft');
    serverSockets.get('alice')!.data.roomId = 'r2';
    expect(errCode(await signal(a, 'bob'))).toBe('not_in_voice');
    expect(await left).toEqual({ userId: 'alice' });
  });

  it('rejects malformed payloads', async () => {
    const a = await client('alice', 'r1');
    const b = await client('bob', 'r1');
    await join(a);
    await join(b);
    const received = record(b, 'voice:signal');
    const bad: unknown[] = [
      undefined,
      null,
      'hello',
      { to: 'bob' },
      { to: '', data: OFFER },
      { to: 'x'.repeat(65), data: OFFER },
      { to: 'bob', data: { description: { type: 'bogus', sdp: '' } } },
      { to: 'bob', data: { description: { type: 'offer', sdp: 'x'.repeat(20001) } } },
      { to: 'bob', data: { candidate: { candidate: 'x'.repeat(2001) } } },
      { to: 'bob', data: { ...OFFER, extra: 1 } },
      { to: 'bob', data: OFFER, extra: 1 },
      { to: 'bob', data: { description: OFFER.description, candidate: null } },
    ];
    for (const p of bad) {
      expect(errCode((await raw(a).emitWithAck('voice:signal', p)) as Ack<unknown>)).toBe(
        'bad_request',
      );
    }
    expect(errCode(await signal(a, 'alice'))).toBe('bad_request');
    await settle();
    expect(received).toEqual([]);
  });

  it('rate-limits signal floods', async () => {
    const a = await client('alice', 'r1');
    const b = await client('bob', 'r1');
    await join(a);
    await join(b);
    const acks = await Promise.all(Array.from({ length: 160 }, () => signal(a, 'bob')));
    const limited = acks.filter((x) => errCode(x) === 'rate_limited').length;
    expect(limited).toBeGreaterThan(0);
    expect(acks.length - limited).toBeGreaterThanOrEqual(100);
  });
});

describe('voice:state / leave / disconnect', () => {
  it('broadcasts mute changes to the room only while in voice', async () => {
    const a = await client('alice', 'r1');
    const watcher = await client('carol', 'r1');
    const outsider = await client('dave', 'r2');
    const outsideStates = record(outsider, 'voice:state');
    expect(errCode(await a.timeout(2000).emitWithAck('voice:state', { muted: false }))).toBe(
      'not_in_voice',
    );
    const joinedState = next(watcher, 'voice:state');
    await join(a);
    await joinedState;
    const st = next(watcher, 'voice:state');
    expect(await a.timeout(2000).emitWithAck('voice:state', { muted: false })).toEqual({
      ok: true,
      data: undefined,
    });
    expect(await st).toEqual({ userId: 'alice', muted: false, inVoice: true });
    expect(hookCalls.at(-1)).toEqual({
      roomId: 'r1',
      userId: 'alice',
      inVoice: true,
      muted: false,
    });
    expect(
      errCode((await raw(a).emitWithAck('voice:state', { muted: 'no' })) as Ack<unknown>),
    ).toBe('bad_request');
    expect(errCode((await raw(a).emitWithAck('voice:join', { x: 1 })) as Ack<unknown>)).toBe(
      'bad_request',
    );
    await settle();
    expect(outsideStates).toEqual([]);
  });

  it('voice:leave notifies peers and the room hook', async () => {
    const a = await client('alice', 'r1');
    const b = await client('bob', 'r1');
    await join(a);
    await join(b);
    const left = next(a, 'voice:peerLeft');
    const bSelf = record(b, 'voice:peerLeft');
    expect(await b.timeout(2000).emitWithAck('voice:leave', {})).toEqual({
      ok: true,
      data: undefined,
    });
    expect(await left).toEqual({ userId: 'bob' });
    expect(hookCalls.at(-1)).toEqual({ roomId: 'r1', userId: 'bob', inVoice: false, muted: true });
    expect(errCode(await signal(b, 'alice'))).toBe('not_in_voice');
    await settle();
    expect(bSelf).toEqual([]); // voluntary leave: no self notification
  });

  it('disconnect leaves voice', async () => {
    const a = await client('alice', 'r1');
    const b = await client('bob', 'r1');
    await join(a);
    await join(b);
    const left = next(a, 'voice:peerLeft');
    b.disconnect();
    expect(await left).toEqual({ userId: 'bob' });
    expect(hookCalls.at(-1)).toEqual({ roomId: 'r1', userId: 'bob', inVoice: false, muted: true });
  });

  it('leaveVoice (room change by the server) also tells the socket itself', async () => {
    const a = await client('alice', 'r1');
    const b = await client('bob', 'r1');
    await join(a);
    await join(b);
    const aLeft = next(a, 'voice:peerLeft');
    const bSelf = next(b, 'voice:peerLeft');
    leaveVoice(io, serverSockets.get('bob')!, hooks);
    expect(await aLeft).toEqual({ userId: 'bob' });
    expect(await bSelf).toEqual({ userId: 'bob' });
    const calls = hookCalls.length;
    leaveVoice(io, serverSockets.get('bob')!, hooks); // idempotent
    expect(hookCalls.length).toBe(calls);
  });
});
