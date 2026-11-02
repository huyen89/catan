import type { Ack, C2SAckData, C2SEvent, C2SPayload } from '@hexhaven/shared';

/** Error raised when the server acks with `{ok:false}`, or the ack never arrives. */
export class AckFailure extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'AckFailure';
    this.code = code;
  }
}

/** The bit of a Socket.IO client that emitAck needs (lets tests pass a fake). */
export interface AckEmitter {
  /** When false the request is rejected immediately instead of being buffered. */
  readonly connected?: boolean;
  emit(event: string, payload: unknown, ack: (res: unknown) => void): unknown;
}

export const ACK_TIMEOUT_MS = 10_000;

function isAck(v: unknown): v is Ack<unknown> {
  return typeof v === 'object' && v !== null && typeof (v as { ok?: unknown }).ok === 'boolean';
}

/**
 * Emit a client→server event and resolve with the ack's `data`.
 * Rejects with AckFailure on `{ok:false}`, a malformed ack, or a timeout.
 * While the socket is disconnected it rejects with NOT_CONNECTED right away: Socket.IO would
 * otherwise buffer the emit and send it on reconnect, so a user retry after a timeout could
 * submit the same request twice.
 */
export function emitAckOn<E extends C2SEvent>(
  socket: AckEmitter,
  event: E,
  payload: C2SPayload<E>,
  timeoutMs = ACK_TIMEOUT_MS,
): Promise<C2SAckData[E]> {
  return new Promise((resolve, reject) => {
    if (socket.connected === false) {
      reject(
        new AckFailure('NOT_CONNECTED', 'Not connected to the server. Try again in a moment.'),
      );
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new AckFailure('TIMEOUT', 'The server did not respond. Check your connection.'));
    }, timeoutMs);
    socket.emit(event, payload, (res: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!isAck(res)) {
        reject(new AckFailure('BAD_ACK', 'Unexpected response from the server'));
      } else if (res.ok) {
        resolve(res.data as C2SAckData[E]);
      } else {
        const e = res.error ?? { code: 'ERROR', message: 'Request failed' };
        reject(new AckFailure(e.code || 'ERROR', e.message || 'Request failed'));
      }
    });
  });
}

/** Human-readable message for any thrown value. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return 'Something went wrong';
}

export type Settled<T> = { ok: true; data: T } | { ok: false; error: string };

/** Turn a promise into a discriminated result; failures are reported through `onError`. */
export async function settle<T>(
  p: Promise<T>,
  onError: (message: string) => void = () => {},
): Promise<Settled<T>> {
  try {
    return { ok: true, data: await p };
  } catch (e) {
    const error = errorMessage(e);
    onError(error);
    return { ok: false, error };
  }
}
