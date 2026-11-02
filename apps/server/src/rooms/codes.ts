import { randomInt } from 'node:crypto';

/** Room-code alphabet without look-alikes (no 0/O, 1/I). */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

export function randomRoomCode(): string {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

/** A fresh code that `taken` does not report as in use. */
export function uniqueRoomCode(taken: (code: string) => boolean): string {
  for (let i = 0; i < 100; i++) {
    const code = randomRoomCode();
    if (!taken(code)) return code;
  }
  throw new Error('could not allocate a room code');
}
