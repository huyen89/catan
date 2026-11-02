import { describe, expect, it } from 'vitest';
import { seedRng } from '../rng';
import { randomPortPositions } from './ports';

/** Smallest cyclic gap between consecutive positions. */
function minGap(positions: number[], len: number): number {
  const s = [...positions].sort((a, b) => a - b);
  return Math.min(...s.map((p, i) => (i + 1 < s.length ? s[i + 1]! - p : s[0]! + len - p)));
}

describe('randomPortPositions', () => {
  it('keeps one free edge between ports and reaches every edge roughly evenly', () => {
    for (const [len, count] of [
      [30, 9],
      [38, 11],
    ] as const) {
      const hits = new Array<number>(len).fill(0);
      const rng = seedRng(`ports-${len}`);
      const draws = 5000;
      for (let i = 0; i < draws; i++) {
        const pos = randomPortPositions(len, count, rng);
        expect(new Set(pos).size).toBe(count);
        expect(minGap(pos, len)).toBeGreaterThanOrEqual(2);
        pos.forEach((p) => hits[p]!++);
      }
      const mean = (draws * count) / len;
      for (const h of hits) expect(Math.abs(h - mean)).toBeLessThan(mean * 0.15);
    }
  });

  it('handles tight and degenerate coastlines', () => {
    const rng = seedRng('tight');
    expect(randomPortPositions(10, 0, rng)).toEqual([]);
    // Exactly fits with gap 2: alternate edges.
    expect(minGap(randomPortPositions(10, 5, rng), 10)).toBe(2);
    // Too tight for gap 2: falls back to distinct edges.
    expect(new Set(randomPortPositions(9, 5, rng)).size).toBe(5);
    expect(new Set(randomPortPositions(5, 5, rng)).size).toBe(5);
    expect(() => randomPortPositions(4, 5, rng)).toThrow();
  });
});
