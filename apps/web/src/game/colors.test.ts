import { PLAYER_COLORS } from '@hexhaven/shared';
import { describe, expect, it } from 'vitest';
import { SEAT_COLORS, seatColor } from './colors';

describe('seat colours', () => {
  it('mirror the shared palette', () => {
    expect([...SEAT_COLORS]).toEqual([...PLAYER_COLORS]);
    expect(seatColor(7)).toBe(PLAYER_COLORS[1]);
  });
});
