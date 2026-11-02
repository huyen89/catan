import { C2S, type Ack, type C2SAckData, type C2SEvent, type C2SPayload } from '@hexhaven/shared';
import type { FastifyBaseLogger } from 'fastify';
import { AppError } from '../errors';
import type { HexSocket } from './types';

type Handler<E extends C2SEvent> = (
  payload: C2SPayload<E>,
) => C2SAckData[E] | void | Promise<C2SAckData[E] | void>;

/**
 * Register a client event: validate the payload with its `C2S` zod schema, run the handler and
 * answer with the Ack envelope. Expected failures (AppError) become `{ok:false, error}`;
 * anything else is logged and reported as INTERNAL without details.
 */
export function on<E extends C2SEvent>(
  socket: HexSocket,
  event: E,
  log: FastifyBaseLogger,
  handler: Handler<E>,
): void {
  const listener = async (payload: unknown, ack: unknown) => {
    const reply = (res: Ack<C2SAckData[E]>) => {
      if (typeof ack === 'function') (ack as (r: Ack<C2SAckData[E]>) => void)(res);
    };
    const parsed = C2S[event].safeParse(payload ?? {});
    if (!parsed.success) {
      reply({ ok: false, error: { code: 'BAD_REQUEST', message: `Invalid ${event} payload` } });
      return;
    }
    try {
      const data = (await handler(parsed.data as C2SPayload<E>)) as C2SAckData[E];
      reply({ ok: true, data });
    } catch (e) {
      if (e instanceof AppError) {
        reply({ ok: false, error: e.toAck() });
      } else {
        log.error({ err: e, event, userId: socket.data.userId }, 'socket handler failed');
        reply({ ok: false, error: { code: 'INTERNAL', message: 'Something went wrong' } });
      }
    }
  };
  (socket.on as (ev: string, fn: (...args: unknown[]) => void) => void)(event, (p, a) => {
    // `socket.emit('room:leave', ack)` arrives with the ack in the payload slot.
    void (typeof p === 'function' ? listener(undefined, p) : listener(p, a));
  });
}
