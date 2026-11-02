import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@hexhaven/shared';

export type HexClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: HexClientSocket | null = null;

/** Singleton same-origin socket (cookie auth). Owned by workstream W; used by voice (V). */
export function getSocket(): HexClientSocket {
  socket ??= io({ withCredentials: true, autoConnect: true });
  return socket;
}
