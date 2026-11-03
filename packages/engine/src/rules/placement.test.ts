import { describe, expect, it } from 'vitest';
import { graphFor } from '../hex/topology';
import { playRandomGame } from '../test/randomPlay';
import {
  buildableRoadEdges,
  buildableSettlementVertices,
  canBuildRoadAt,
  canBuildSettlementAt,
} from './placement';

describe('buildable spots (network-local scan)', () => {
  it('match a brute-force scan of every edge and vertex on random game states', () => {
    let checked = 0;
    for (const players of [3, 4, 5, 6]) {
      playRandomGame(`placement-${players}`, players, 1500, (s) => {
        if (s.version % 7 !== 0) return;
        const g = graphFor(s.board);
        for (const p of s.players) {
          expect(buildableRoadEdges(s, g, p.seat)).toEqual(
            g.edges.filter((e) => canBuildRoadAt(s, g, p.seat, e)),
          );
          expect(buildableSettlementVertices(s, g, p.seat)).toEqual(
            g.vertices.filter((v) => canBuildSettlementAt(s, g, p.seat, v)),
          );
          checked++;
        }
      });
    }
    expect(checked).toBeGreaterThan(500);
  });

  it('ignore pieces whose ids are not on this board', () => {
    const game = playRandomGame('placement-junk', 4, 40);
    const s = structuredClone(game.state);
    const g = graphFor(s.board);
    s.roads['99,99,NE'] = 0;
    s.buildings['99,99,N'] = { owner: 0, kind: 'settlement' };
    expect(buildableRoadEdges(s, g, 0)).toEqual(g.edges.filter((e) => canBuildRoadAt(s, g, 0, e)));
    expect(buildableSettlementVertices(s, g, 0)).toEqual(
      g.vertices.filter((v) => canBuildSettlementAt(s, g, 0, v)),
    );
  });
});
