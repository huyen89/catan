import type { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@hexhaven/shared';

/** Per-socket data set by the auth middleware (workstream S). Voice handlers rely on it. */
export interface SocketData {
  userId: string;
  name: string;
  /** Room the socket currently belongs to, null when in no room. */
  roomId: string | null;
}

export type HexServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;
export type HexSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

/** Socket.IO room naming conventions (contract between S and V). */
export const ioRooms = {
  /** Every socket of a user joins this. */
  user: (userId: string) => `user:${userId}`,
  /** Every socket in a game room (lobby + game). */
  room: (roomId: string) => `room:${roomId}`,
  /** Sockets currently in the voice channel of a room. */
  voice: (roomId: string) => `voice:${roomId}`,
};
