import type { Server as HttpServer } from 'node:http';
import fastifyCookie from '@fastify/cookie';
import type { FastifyBaseLogger } from 'fastify';
import { Server } from 'socket.io';
import { SESSION_COOKIE, type SessionService } from '../auth/sessions';
import type { Config } from '../config';
import type { RoomManager } from '../rooms/RoomManager';
import { registerChatHandlers } from './handlers/chat';
import { registerGameHandlers } from './handlers/game';
import { registerLobbyHandlers } from './handlers/lobby';
import { registerVoiceHandlers } from './handlers/voice';
import { messageBucket } from './rateLimit';
import { ioRooms, type HexServer, type HexSocket } from './types';

export interface SocketServer {
  io: HexServer;
  /** Wire event handlers once the room manager exists. */
  attach(rooms: RoomManager): void;
  /** Drop every socket authenticated with this session (after logout). */
  disconnectSession(tokenHash: string): void;
}

export function createSocketServer(
  httpServer: HttpServer,
  opts: { config: Config; sessions: SessionService; log: FastifyBaseLogger },
): SocketServer {
  const { config, sessions, log } = opts;
  const io: HexServer = new Server(httpServer, {
    path: '/socket.io',
    serveClient: false,
    // voice:signal SDP may be up to 20k chars; everything else is tiny.
    maxHttpBufferSize: 100_000,
  });
  const bySession = new Map<string, Set<HexSocket>>();

  io.use((socket, next) => {
    const origin = socket.handshake.headers.origin;
    if (config.publicOrigin && origin && origin !== config.publicOrigin) {
      next(new Error('FORBIDDEN_ORIGIN'));
      return;
    }
    const token = fastifyCookie.parse(socket.handshake.headers.cookie ?? '')[SESSION_COOKIE];
    const user = sessions.userFor(token);
    if (!user || !token) {
      next(new Error('UNAUTHENTICATED'));
      return;
    }
    socket.data = { userId: user.id, name: user.name, roomId: null };
    const hash = sessions.hash(token);
    let set = bySession.get(hash);
    if (!set) bySession.set(hash, (set = new Set()));
    set.add(socket);
    socket.once('disconnect', () => {
      set.delete(socket);
      if (set.size === 0) bySession.delete(hash);
    });
    next();
  });

  return {
    io,
    attach(rooms) {
      io.on('connection', (socket) => {
        void socket.join(ioRooms.user(socket.data.userId));
        const bucket = messageBucket();
        socket.use((packet, next) => {
          if (bucket.take()) {
            next();
            return;
          }
          const ack = packet[packet.length - 1];
          if (packet.length > 1 && typeof ack === 'function') {
            ack({ ok: false, error: { code: 'RATE_LIMITED', message: 'Too many messages' } });
          }
        });
        registerLobbyHandlers(socket, rooms, log);
        registerGameHandlers(socket, rooms, log);
        registerChatHandlers(socket, rooms, log);
        registerVoiceHandlers(io, socket, rooms.voiceHooks);
        socket.on('disconnect', () => rooms.disconnected(socket));
      });
    },
    disconnectSession(hash) {
      for (const s of bySession.get(hash) ?? []) s.disconnect(true);
    },
  };
}
