import { describe, expect, it } from 'vitest';
import { parseRoute, replayPath, roomPath } from './router';

describe('parseRoute', () => {
  it('matches home, rooms and unknown paths', () => {
    expect(parseRoute('/')).toEqual({ name: 'home' });
    expect(parseRoute('/r/abc123')).toEqual({ name: 'room', code: 'ABC123' });
    expect(parseRoute('/r/ABC123/')).toEqual({ name: 'room', code: 'ABC123' });
    expect(parseRoute('/r/ABC')).toEqual({ name: 'notFound' });
    expect(parseRoute('/nope')).toEqual({ name: 'notFound' });
    expect(roomPath('abc123')).toBe('/r/ABC123');
  });

  it('matches history, stats and replay pages', () => {
    expect(parseRoute('/history')).toEqual({ name: 'history' });
    expect(parseRoute('/history/')).toEqual({ name: 'history' });
    expect(parseRoute('/stats')).toEqual({ name: 'stats' });
    expect(parseRoute('/replay/g_12-ab')).toEqual({ name: 'replay', gameId: 'g_12-ab' });
    expect(parseRoute('/replay/abc/')).toEqual({ name: 'replay', gameId: 'abc' });
    expect(parseRoute('/replay/')).toEqual({ name: 'notFound' });
    expect(parseRoute('/replay/a%2Fb')).toEqual({ name: 'notFound' });
    expect(parseRoute(`/replay/${'x'.repeat(65)}`)).toEqual({ name: 'notFound' });
    expect(replayPath('g_1')).toBe('/replay/g_1');
  });

  it('parses and clamps dev board params', () => {
    expect(parseRoute('/dev/board', '?players=5&seed=x&seat=9')).toEqual({
      name: 'devBoard',
      players: 5,
      seed: 'x',
      demo: true,
      seat: 4,
      scenario: null,
      scene: null,
    });
    expect(parseRoute('/dev/board', '?players=12&demo=0')).toMatchObject({
      players: 6,
      seed: 'dev',
      demo: false,
      seat: 0,
    });
    expect(parseRoute('/dev/board', '?scenario=archipelago&scene=gold')).toMatchObject({
      scenario: 'archipelago',
      scene: 'gold',
    });
  });
});
