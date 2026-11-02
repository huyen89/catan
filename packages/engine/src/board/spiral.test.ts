import { describe, expect, it } from 'vitest';
import { HEX_DIRECTIONS, hexId, hexNeighbors, parseHexId } from '../hex/coords';
import { BASE_LAYOUT, EXT56_LAYOUT } from './layouts';
import { hexagonRadius, spiralWalk } from './spiral';

describe('spiral', () => {
  it('recognises full hexagons only', () => {
    expect(hexagonRadius(BASE_LAYOUT.hexes)).toBe(2);
    expect(hexagonRadius([{ q: 0, r: 0 }])).toBe(0);
    expect(hexagonRadius(EXT56_LAYOUT.hexes)).toBeNull();
    expect(hexagonRadius(BASE_LAYOUT.hexes.slice(1))).toBeNull();
  });

  it('walks every hex once from an outer corner, stepping between neighbours, ending at the centre', () => {
    const all = BASE_LAYOUT.hexes.map((h) => hexId(h.q, h.r)).sort();
    for (let corner = 0; corner < 6; corner++)
      for (const clockwise of [false, true]) {
        const walk = spiralWalk(2, corner, clockwise);
        expect([...walk].sort()).toEqual(all);
        const [dq, dr] = HEX_DIRECTIONS[corner]!;
        expect(walk[0]).toBe(hexId(2 * dq, 2 * dr));
        expect(walk[12]).toBe(hexId(dq, dr));
        expect(walk.at(-1)).toBe(hexId(0, 0));
        for (let i = 1; i < walk.length; i++) {
          const { q, r } = parseHexId(walk[i - 1]!);
          expect(hexNeighbors(q, r)).toContain(walk[i]);
        }
      }
  });

  it('the two rotation directions mirror each other', () => {
    const ccw = spiralWalk(2, 0, false);
    const cw = spiralWalk(2, 0, true);
    expect(cw[0]).toBe(ccw[0]);
    expect(cw.slice(1, 12)).toEqual(ccw.slice(1, 12).reverse());
  });
});
