import { io, type Socket } from 'socket.io-client';
import type {
  C2SAckData,
  C2SEvent,
  C2SPayload,
  ClientToServerEvents,
  ServerToClientEvents,
} from '@hexhaven/shared';
import { emitAckOn, type AckEmitter } from './emit';

export type HexClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: HexClientSocket | null = null;

/** Singleton same-origin socket (cookie auth). Owned by workstream W; used by voice (V). */
export function getSocket(): HexClientSocket {
  socket ??= io({ withCredentials: true, autoConnect: true });
  return socket;
}

/** Typed request/ack over the shared socket. Rejects with AckFailure on `{ok:false}`. */
export function emitAck<E extends C2SEvent>(
  event: E,
  payload: C2SPayload<E>,
): Promise<C2SAckData[E]> {
  return emitAckOn(getSocket() as unknown as AckEmitter, event, payload);
}
