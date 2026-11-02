import { describe, expect, it } from 'vitest';
import { simulateGame } from './simulate';

describe('bot simulation', () => {
  for (const players of [3, 4, 5, 6]) {
    it(`bots finish ${players}-player games with only legal moves`, () => {
      for (let i = 0; i < 5; i++) {
        const r = simulateGame(`unit-${players}-${i}`, players);
        expect(r.finished).toBe(true);
        expect(Math.max(...r.vp)).toBeGreaterThanOrEqual(10);
      }
    });
  }

  it('is deterministic for a seed', () => {
    expect(simulateGame('det', 4)).toEqual(simulateGame('det', 4));
  });
});
