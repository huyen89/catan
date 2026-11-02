import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ack, VoicePeer } from '@hexhaven/shared';
import type { HexClientSocket } from '../net/socket';
import { ICE_DISCONNECTED_GRACE_MS } from './logic';
import type { VoiceState } from './store';
import { VoiceManager } from './VoiceManager';

type Fn = (...args: unknown[]) => void;
type JoinAck = Ack<{ peers: VoicePeer[] }>;

/** Minimal Socket.IO client stand-in: records emits and answers voice:join with queued acks. */
class FakeSocket {
  connected = true;
  readonly handlers = new Map<string, Set<Fn>>();
  readonly emitted: Array<{ ev: string; payload: unknown }> = [];
  readonly joinAcks: JoinAck[] = [];

  on(ev: string, fn: Fn) {
    if (!this.handlers.has(ev)) this.handlers.set(ev, new Set());
    this.handlers.get(ev)!.add(fn);
    return this;
  }
  off(ev: string, fn: Fn) {
    this.handlers.get(ev)?.delete(fn);
    return this;
  }
  emit(ev: string, payload: unknown, ack?: Fn) {
    this.emitted.push({ ev, payload });
    ack?.({ ok: true, data: undefined });
    return this;
  }
  timeout() {
    return {
      emitWithAck: (ev: string, payload: unknown) => {
        this.emitted.push({ ev, payload });
        return Promise.resolve(this.joinAcks.shift() ?? { ok: true, data: { peers: [] } });
      },
    };
  }
  fire(ev: string, ...args: unknown[]) {
    for (const fn of [...(this.handlers.get(ev) ?? [])]) fn(...args);
  }
  count(ev: string) {
    return this.emitted.filter((e) => e.ev === ev).length;
  }
}

class FakePC {
  static all: FakePC[] = [];
  connectionState: RTCPeerConnectionState = 'new';
  iceConnectionState: RTCIceConnectionState = 'new';
  signalingState: RTCSignalingState = 'stable';
  onicecandidate: Fn | null = null;
  onnegotiationneeded: Fn | null = null;
  onconnectionstatechange: Fn | null = null;
  oniceconnectionstatechange: Fn | null = null;
  ontrack: Fn | null = null;
  stats: Array<Record<string, unknown>> = [];
  readonly restartIce = vi.fn();
  readonly close = vi.fn();

  constructor(public config: RTCConfiguration) {
    FakePC.all.push(this);
  }
  addTransceiver() {}
  getTransceivers() {
    return [];
  }
  getConfiguration() {
    return this.config;
  }
  setConfiguration(c: RTCConfiguration) {
    this.config = c;
  }
  getStats() {
    return Promise.resolve(new Map(this.stats.map((s) => [s.id as string, s])));
  }
  setIce(state: RTCIceConnectionState) {
    this.iceConnectionState = state;
    this.oniceconnectionstatechange?.();
  }
}

function fakeElement() {
  return {
    dataset: {} as Record<string, string>,
    hidden: false,
    volume: 1,
    autoplay: false,
    srcObject: null as unknown,
    setAttribute() {},
    append() {},
    remove() {},
    pause() {},
    play: () => Promise.resolve(),
  };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

let socket: FakeSocket;
let state: Partial<VoiceState>;
let manager: VoiceManager;

beforeEach(() => {
  FakePC.all = [];
  socket = new FakeSocket();
  state = { peers: {} };
  vi.stubGlobal('RTCPeerConnection', FakePC);
  vi.stubGlobal('document', { createElement: fakeElement, body: { append() {} } });
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ iceServers: [{ urls: 'stun:stun.example.com' }], ttl: 3600 }),
      }),
    ),
  );
  manager = new VoiceManager({
    getSocket: () => socket as unknown as HexClientSocket,
    setState: (p) => {
      state = { ...state, ...(typeof p === 'function' ? p(state as VoiceState) : p) };
    },
  });
});

afterEach(() => {
  manager.leave();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const peersOf = () => state.peers ?? {};

describe('VoiceManager join', () => {
  it("takes peers' mute state from the join ack", async () => {
    socket.joinAcks.push({
      ok: true,
      data: {
        peers: [
          { userId: 'bob', muted: false },
          { userId: 'carol', muted: true },
        ],
      },
    });
    await manager.join('alice');
    expect(state.joined).toBe(true);
    expect(peersOf().bob?.muted).toBe(false);
    expect(peersOf().carol?.muted).toBe(true);
    expect(FakePC.all).toHaveLength(2);

    // Later voice:state updates still apply.
    socket.fire('voice:state', { userId: 'carol', muted: false, inVoice: true });
    expect(peersOf().carol?.muted).toBe(false);
  });

  it('shows a friendly message when the channel is full', async () => {
    socket.joinAcks.push({ ok: false, error: { code: 'voice_full', message: 'full' } });
    await manager.join('alice');
    expect(state.joined).toBe(false);
    expect(state.joining).toBe(false);
    expect(state.error).toMatch(/full/);
  });
});

describe('VoiceManager ICE restart', () => {
  async function joinWithBob(): Promise<FakePC> {
    socket.joinAcks.push({ ok: true, data: { peers: [{ userId: 'bob', muted: true }] } });
    await manager.join('alice');
    return FakePC.all[0]!;
  }

  it('restarts at once when ICE fails', async () => {
    const pc = await joinWithBob();
    pc.setIce('failed');
    await flush();
    expect(pc.restartIce).toHaveBeenCalledTimes(1);
    // A second failure during the same attempt does not stack restarts.
    pc.setIce('failed');
    await flush();
    expect(pc.restartIce).toHaveBeenCalledTimes(1);
  });

  it('restarts only after ICE stays disconnected for the grace period', async () => {
    vi.useFakeTimers();
    const pc = await joinWithBob();
    pc.setIce('disconnected');
    vi.advanceTimersByTime(ICE_DISCONNECTED_GRACE_MS - 1);
    expect(pc.restartIce).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await flush();
    expect(pc.restartIce).toHaveBeenCalledTimes(1);
  });

  it('cancels the pending restart when ICE recovers', async () => {
    vi.useFakeTimers();
    const pc = await joinWithBob();
    pc.setIce('disconnected');
    vi.advanceTimersByTime(2000);
    pc.setIce('connected');
    vi.advanceTimersByTime(ICE_DISCONNECTED_GRACE_MS * 2);
    await flush();
    expect(pc.restartIce).not.toHaveBeenCalled();
  });

  it('retries when a restart has not reconnected after a while', async () => {
    vi.useFakeTimers();
    const pc = await joinWithBob();
    pc.setIce('failed');
    await flush();
    expect(pc.restartIce).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    await flush();
    expect(pc.restartIce).toHaveBeenCalledTimes(2);
  });

  it('records the selected route once connected', async () => {
    const pc = await joinWithBob();
    pc.stats = [
      { id: 'L', type: 'local-candidate', candidateType: 'relay', relayProtocol: 'udp' },
      { id: 'R', type: 'remote-candidate', candidateType: 'srflx' },
      { id: 'P', type: 'candidate-pair', localCandidateId: 'L', remoteCandidateId: 'R' },
      { id: 'T', type: 'transport', selectedCandidatePairId: 'P' },
    ];
    pc.setIce('connected');
    await flush();
    expect(peersOf().bob?.route).toEqual({ local: 'relay', remote: 'srflx', relayProtocol: 'udp' });
  });
});

describe('VoiceManager socket reconnect', () => {
  it('re-joins voice after the socket reconnects and the room is restored', async () => {
    socket.joinAcks.push({ ok: true, data: { peers: [{ userId: 'bob', muted: false }] } });
    await manager.join('alice');
    const firstPc = FakePC.all[0]!;

    socket.connected = false;
    socket.fire('disconnect');
    expect(state.joined).toBe(false);
    expect(state.joining).toBe(true);
    expect(firstPc.close).toHaveBeenCalled();
    expect(peersOf()).toEqual({});

    socket.joinAcks.push({ ok: true, data: { peers: [{ userId: 'bob', muted: true }] } });
    socket.connected = true;
    socket.fire('connect');
    expect(socket.count('voice:join')).toBe(1);
    socket.fire('room:state', {});
    await flush();
    expect(socket.count('voice:join')).toBe(2);
    expect(state.joined).toBe(true);
    expect(state.joining).toBe(false);
    expect(FakePC.all).toHaveLength(2);
    expect(peersOf().bob?.muted).toBe(true);
  });

  it('falls back to a timer when no room:state arrives', async () => {
    vi.useFakeTimers();
    await manager.join('alice');
    socket.fire('disconnect');
    socket.fire('connect');
    vi.advanceTimersByTime(1500);
    await flush();
    expect(socket.count('voice:join')).toBe(2);
    expect(state.joined).toBe(true);
  });

  it('does not re-join after leaving', async () => {
    await manager.join('alice');
    manager.leave();
    socket.fire('disconnect');
    socket.fire('connect');
    socket.fire('room:state', {});
    await flush();
    expect(socket.count('voice:join')).toBe(1);
    expect(socket.count('voice:leave')).toBe(1);
  });
});
