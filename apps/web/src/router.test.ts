import { describe, expect, it } from 'vitest';
import { parseRoute, roomPath } from './router';

describe('parseRoute', () => {
  it('matches home, rooms and unknown paths', () => {
    expect(parseRoute('/')).toEqual({ name: 'home' });
    expect(parseRoute('/r/abc123')).toEqual({ name: 'room', code: 'ABC123' });
    expect(parseRoute('/r/ABC123/')).toEqual({ name: 'room', code: 'ABC123' });
    expect(parseRoute('/r/ABC')).toEqual({ name: 'notFound' });
    expect(parseRoute('/nope')).toEqual({ name: 'notFound' });
    expect(roomPath('abc123')).toBe('/r/ABC123');
  });

  it('parses and clamps dev board params', () => {
    expect(parseRoute('/dev/board', '?players=5&seed=x&seat=9')).toEqual({
      name: 'devBoard',
      players: 5,
      seed: 'x',
      demo: true,
      seat: 4,
    });
    expect(parseRoute('/dev/board', '?players=12&demo=0')).toMatchObject({
      players: 6,
      seed: 'dev',
      demo: false,
      seat: 0,
    });
  });
});
