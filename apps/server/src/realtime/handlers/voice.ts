import { C2S, type Ack, type AckError, type VoicePeer } from '@hexhaven/shared';
import { ioRooms, type HexServer, type HexSocket } from '../types';
import { TokenBucket } from '../../voice/rateLimit';
import { VOICE_MAX_PEERS, signalBurstFor } from '../../voice/limits';

/** Callbacks into the room manager so seat badges (inVoice/muted) stay in sync. */
export interface VoiceHooks {
  onVoiceState(roomId: string, userId: string, state: { inVoice: boolean; muted: boolean }): void;
}

/**
 * Signaling burst/sustained limits per socket. A mesh join with trickle ICE needs ~10–12
 * signals per peer, so the burst scales with the voice cap (see signalBurstFor).
 */
export const SIGNAL_BURST = signalBurstFor(VOICE_MAX_PEERS);
export const SIGNAL_PER_SEC = 50;
/** join/state limits per socket. */
export const CONTROL_BURST = 20;
export const CONTROL_PER_SEC = 4;

interface Membership {
  roomId: string;
  muted: boolean;
}

/** Voice membership per socket. Tracked separately from socket.data.roomId so a room change
 * that happens before leaveVoice still cleans up the right voice channel. */
const membership = new WeakMap<HexSocket, Membership>();

const ERR = {
  badRequest: { code: 'bad_request', message: 'Invalid voice payload' },
  notInRoom: { code: 'not_in_room', message: 'Join a room before joining voice' },
  notInVoice: { code: 'not_in_voice', message: 'Not in the voice channel' },
  peerNotInVoice: { code: 'peer_not_in_voice', message: 'That player is not in voice' },
  rateLimited: { code: 'rate_limited', message: 'Too many voice messages' },
  full: { code: 'voice_full', message: 'The voice channel is full' },
} satisfies Record<string, AckError>;

type Reply<T> = (res: Ack<T>) => void;

/** Socket.IO passes (payload, ack); a client may omit either, so accept anything. */
function normalizeArgs<T>(payload: unknown, ack: unknown): { payload: unknown; reply: Reply<T> } {
  if (typeof payload === 'function' && ack === undefined) {
    return { payload: undefined, reply: payload as Reply<T> };
  }
  return { payload, reply: typeof ack === 'function' ? (ack as Reply<T>) : () => {} };
}

function fail(reply: Reply<never>, error: AckError): void {
  reply({ ok: false, error });
}

/** Socket ids in a room's voice channel (local adapter: single-process server). */
function voiceSocketIds(socket: HexSocket, roomId: string): Set<string> {
  return socket.nsp.adapter.rooms.get(ioRooms.voice(roomId)) ?? new Set();
}

function voiceSocketsOfUser(socket: HexSocket, roomId: string, userId: string): string[] {
  const ids: string[] = [];
  for (const id of voiceSocketIds(socket, roomId)) {
    if (socket.nsp.sockets.get(id)?.data.userId === userId) ids.push(id);
  }
  return ids;
}

function notifyState(
  io: HexServer,
  hooks: VoiceHooks,
  roomId: string,
  userId: string,
  state: { inVoice: boolean; muted: boolean },
): void {
  try {
    hooks.onVoiceState(roomId, userId, state);
  } catch (err) {
    console.error('[voice] onVoiceState hook failed:', err);
  }
  io.to(ioRooms.room(roomId)).emit('voice:state', { userId, ...state });
}

/** The socket's voice room, or null. Leaves voice if the socket has since moved rooms. */
function activeVoiceRoom(io: HexServer, socket: HexSocket, hooks: VoiceHooks): string | null {
  const m = membership.get(socket);
  if (!m) return null;
  if (socket.data.roomId !== m.roomId) {
    removeFromVoice(io, socket, hooks, true);
    return null;
  }
  return m.roomId;
}

function removeFromVoice(
  io: HexServer,
  socket: HexSocket,
  hooks: VoiceHooks,
  notifySelf: boolean,
): void {
  const m = membership.get(socket);
  if (!m) return;
  membership.delete(socket);
  const { userId } = socket.data;
  void socket.leave(ioRooms.voice(m.roomId));
  io.to(ioRooms.voice(m.roomId)).except(socket.id).emit('voice:peerLeft', { userId });
  // Tell the client its session ended (room change, voice opened in another tab).
  if (notifySelf && socket.connected) socket.emit('voice:peerLeft', { userId });
  notifyState(io, hooks, m.roomId, userId, { inVoice: false, muted: true });
}

/**
 * Registers voice:join / voice:leave / voice:signal / voice:state for one socket.
 * Signals are relayed ONLY between users in the same room's voice channel.
 * Owned by workstream V. Called by realtime/socket.ts (workstream S) for every connection.
 */
export function registerVoiceHandlers(
  io: HexServer,
  socket: HexSocket,
  hooks: VoiceHooks,
  /** Overrides for tests; production uses VOICE_MAX_PEERS read once at startup. */
  opts: { maxPeers?: number } = {},
): void {
  const maxPeers = opts.maxPeers ?? VOICE_MAX_PEERS;
  const signalBucket = new TokenBucket(signalBurstFor(maxPeers), SIGNAL_PER_SEC);
  const controlBucket = new TokenBucket(CONTROL_BURST, CONTROL_PER_SEC);

  socket.on('voice:join', (rawPayload, rawAck) => {
    const { payload, reply } = normalizeArgs<{ peers: VoicePeer[] }>(rawPayload, rawAck);
    if (!C2S['voice:join'].safeParse(payload).success) return fail(reply, ERR.badRequest);
    if (!controlBucket.take()) return fail(reply, ERR.rateLimited);
    const roomId = socket.data.roomId;
    if (!roomId) return fail(reply, ERR.notInRoom);
    const { userId } = socket.data;

    // Other users already in the channel (this user's own tabs are replaced, so not counted).
    const peers = new Map<string, VoicePeer>();
    for (const id of voiceSocketIds(socket, roomId)) {
      const peerSocket = socket.nsp.sockets.get(id);
      const peerId = peerSocket?.data.userId;
      if (!peerSocket || !peerId || peerId === userId) continue;
      peers.set(peerId, { userId: peerId, muted: membership.get(peerSocket)?.muted ?? true });
    }
    // Checked before touching any existing session, so a refused join changes nothing.
    if (peers.size >= maxPeers) return fail(reply, ERR.full);

    // Re-joining from the same socket restarts the session cleanly for everyone.
    removeFromVoice(io, socket, hooks, false);
    // One voice session per user: a newer tab/window takes over from older ones.
    for (const other of socket.nsp.sockets.values()) {
      if (other !== socket && other.data.userId === userId && membership.has(other)) {
        removeFromVoice(io, other, hooks, true);
      }
    }

    void socket.join(ioRooms.voice(roomId));
    membership.set(socket, { roomId, muted: true });

    reply({ ok: true, data: { peers: [...peers.values()] } });
    socket.to(ioRooms.voice(roomId)).emit('voice:peerJoined', { userId });
    notifyState(io, hooks, roomId, userId, { inVoice: true, muted: true });
  });

  socket.on('voice:leave', (rawPayload, rawAck) => {
    const { payload, reply } = normalizeArgs<undefined>(rawPayload, rawAck);
    if (!C2S['voice:leave'].safeParse(payload).success) return fail(reply, ERR.badRequest);
    // Never rate-limited: leaving must always work, and it is a no-op when not in voice.
    removeFromVoice(io, socket, hooks, false);
    reply({ ok: true, data: undefined });
  });

  socket.on('voice:signal', (rawPayload, rawAck) => {
    const { payload, reply } = normalizeArgs<undefined>(rawPayload, rawAck);
    const parsed = C2S['voice:signal'].safeParse(payload);
    if (!parsed.success) return fail(reply, ERR.badRequest);
    if (!signalBucket.take()) return fail(reply, ERR.rateLimited);
    const roomId = activeVoiceRoom(io, socket, hooks);
    if (!roomId) return fail(reply, ERR.notInVoice);
    const { to, data } = parsed.data;
    if (to === socket.data.userId) return fail(reply, ERR.badRequest);
    // Deliver only to the target's sockets inside this voice channel (not their other tabs).
    const targets = voiceSocketsOfUser(socket, roomId, to);
    if (targets.length === 0) return fail(reply, ERR.peerNotInVoice);
    io.to(targets).emit('voice:signal', { from: socket.data.userId, data });
    reply({ ok: true, data: undefined });
  });

  socket.on('voice:state', (rawPayload, rawAck) => {
    const { payload, reply } = normalizeArgs<undefined>(rawPayload, rawAck);
    const parsed = C2S['voice:state'].safeParse(payload);
    if (!parsed.success) return fail(reply, ERR.badRequest);
    if (!controlBucket.take()) return fail(reply, ERR.rateLimited);
    const roomId = activeVoiceRoom(io, socket, hooks);
    const m = membership.get(socket);
    if (!roomId || !m) return fail(reply, ERR.notInVoice);
    m.muted = parsed.data.muted;
    notifyState(io, hooks, roomId, socket.data.userId, { inVoice: true, muted: m.muted });
    reply({ ok: true, data: undefined });
  });

  socket.on('disconnect', () => leaveVoice(io, socket, hooks));
}

/**
 * Remove a socket from its room's voice channel (if in one) and notify peers.
 * SRV calls this when a socket leaves a room; VOX also calls it on disconnect.
 * The socket itself receives `voice:peerLeft` with its own userId so the client tears down.
 */
export function leaveVoice(io: HexServer, socket: HexSocket, hooks: VoiceHooks): void {
  removeFromVoice(io, socket, hooks, true);
}

/** True when the socket is currently in a voice channel (for diagnostics/tests). */
export function isInVoice(socket: HexSocket): boolean {
  return membership.has(socket);
}
