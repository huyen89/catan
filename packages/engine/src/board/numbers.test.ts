import { describe, expect, it } from 'vitest';
import { seedRng } from '../rng';
import { isRedToken, placeRandomTokens } from './numbers';

const sorted = (xs: readonly number[]): number[] => [...xs].sort((a, b) => a - b);

/** Adjacent slot pairs violating `bad`. */
function clashes(
  neighbors: ReadonlyArray<readonly number[]>,
  tokens: readonly number[],
  bad: (a: number, b: number) => boolean,
): number {
  let n = 0;
  neighbors.forEach((ns, i) => ns.forEach((j) => i < j && bad(tokens[i]!, tokens[j]!) && n++));
  return n;
}
const red = (a: number, b: number): boolean => isRedToken(a) && isRedToken(b);

describe('placeRandomTokens', () => {
  it('satisfies the strict constraint when it is achievable', () => {
    // Path 0-1-2-3: only arrangements like 5,6,5,8 work.
    const path = [[1], [0, 2], [1, 3], [2]];
    for (let s = 0; s < 200; s++) {
      const out = placeRandomTokens(path, [5, 5, 6, 8], seedRng(`path-${s}`));
      expect(sorted(out)).toEqual([5, 5, 6, 8]);
      expect(clashes(path, out, (a, b) => a === b || red(a, b))).toBe(0);
    }
  });

  it('relaxes to 6/8-only when equal numbers cannot be kept apart', () => {
    // Triangle: the two 5s must touch.
    const triangle = [
      [1, 2],
      [0, 2],
      [0, 1],
    ];
    const out = placeRandomTokens(triangle, [5, 5, 6], seedRng('triangle'));
    expect(sorted(out)).toEqual([5, 5, 6]);

    // Square 0-1-2-3-0 with chord 0-2: slots 1 and 3 are the only non-adjacent pair, so the reds
    // must take them and the two 4s are forced onto the touching slots 0 and 2.
    const square = [
      [1, 2, 3],
      [0, 2],
      [0, 1, 3],
      [0, 2],
    ];
    for (let s = 0; s < 50; s++) {
      const tokens = placeRandomTokens(square, [6, 8, 4, 4], seedRng(`square-${s}`));
      expect(sorted(tokens)).toEqual([4, 4, 6, 8]);
      expect(clashes(square, tokens, red)).toBe(0);
      expect(isRedToken(tokens[1]!) && isRedToken(tokens[3]!)).toBe(true);
    }
  });

  it('still terminates with a permutation when 6/8 cannot be kept apart', () => {
    const pair = [[1], [0]];
    expect(sorted(placeRandomTokens(pair, [6, 8], seedRng('pair')))).toEqual([6, 8]);
  });

  it('is deterministic and rejects a token/slot count mismatch', () => {
    const ring = Array.from({ length: 12 }, (_, i) => [(i + 11) % 12, (i + 1) % 12]);
    const tokens = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 6, 8];
    expect(placeRandomTokens(ring, tokens, seedRng('d'))).toEqual(
      placeRandomTokens(ring, tokens, seedRng('d')),
    );
    expect(() => placeRandomTokens(ring, [5], seedRng('d'))).toThrow();
  });
});
