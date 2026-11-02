import { afterEach, describe, expect, it, vi } from 'vitest';
import { AckFailure, emitAckOn, errorMessage, type AckEmitter } from './emit';
import { apiErrorMessage } from './api';

function fake(reply: ((ack: (res: unknown) => void) => void) | null) {
  const calls: Array<{ event: string; payload: unknown }> = [];
  const socket: AckEmitter = {
    emit(event, payload, ack) {
      calls.push({ event, payload });
      reply?.(ack);
    },
  };
  return { socket, calls };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('emitAckOn', () => {
  it('resolves with data on ok:true and forwards the payload', async () => {
    const { socket, calls } = fake((ack) => ack({ ok: true, data: { version: 4 } }));
    const action = { type: 'ROLL' } as const;
    await expect(emitAckOn(socket, 'game:action', { expectedVersion: 3, action })).resolves.toEqual(
      { version: 4 },
    );
    expect(calls).toEqual([{ event: 'game:action', payload: { expectedVersion: 3, action } }]);
  });

  it('rejects with the server error code and message on ok:false', async () => {
    const { socket } = fake((ack) =>
      ack({ ok: false, error: { code: 'NOT_YOUR_TURN', message: 'Wait for your turn' } }),
    );
    const p = emitAckOn(socket, 'room:start', {});
    await expect(p).rejects.toBeInstanceOf(AckFailure);
    await expect(p).rejects.toMatchObject({ code: 'NOT_YOUR_TURN', message: 'Wait for your turn' });
  });

  it('rejects malformed acks', async () => {
    const { socket } = fake((ack) => ack('nope'));
    await expect(emitAckOn(socket, 'room:leave', {})).rejects.toMatchObject({ code: 'BAD_ACK' });
  });

  it('times out when no ack arrives, and ignores a late ack', async () => {
    vi.useFakeTimers();
    let late: ((res: unknown) => void) | null = null;
    const { socket } = fake((ack) => {
      late = ack;
    });
    const p = emitAckOn(socket, 'room:leave', {}, 1000);
    vi.advanceTimersByTime(1001);
    await expect(p).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(() => late!({ ok: true, data: undefined })).not.toThrow();
  });
});

describe('error messages', () => {
  it('extracts readable messages', () => {
    expect(errorMessage(new AckFailure('X', 'boom'))).toBe('boom');
    expect(errorMessage('plain')).toBe('plain');
    expect(errorMessage(42)).toBe('Something went wrong');
  });
  it('parses REST error bodies', () => {
    expect(apiErrorMessage({ error: { code: 'X', message: 'Bad invite' } }, 403)).toBe(
      'Bad invite',
    );
    expect(apiErrorMessage({ error: 'Nope' }, 400)).toBe('Nope');
    expect(apiErrorMessage({ message: 'Hm' }, 400)).toBe('Hm');
    expect(apiErrorMessage(null, 502)).toBe('Request failed (502)');
  });
});
