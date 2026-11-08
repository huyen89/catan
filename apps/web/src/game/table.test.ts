import { describe, expect, it } from 'vitest';
import { tableSlots } from './table';

describe('tableSlots', () => {
  it('puts the viewer bottom-left and the others clockwise', () => {
    expect([...tableSlots(4, 2)]).toEqual([
      [2, 'bl'],
      [3, 'tl'],
      [0, 'tr'],
      [1, 'br'],
    ]);
  });

  it('uses seat 0 as the anchor for spectators', () => {
    expect(tableSlots(3, null).get(0)).toBe('bl');
  });

  it('gives every seat its own slot for 3 to 6 players', () => {
    for (let n = 3; n <= 6; n++) {
      for (let v = 0; v < n; v++) {
        const slots = tableSlots(n, v);
        expect(slots.size).toBe(n);
        expect(new Set(slots.values()).size).toBe(n);
      }
    }
  });
});
