import { describe, expect, it } from 'vitest';
import { getLegal } from '../legal';
import { graphFor } from '../hex/topology';
import { totalResources } from '../resources';
import { act, finishSetup, newGame } from '../test/fixtures';
import { eventsOf, expectOk, expectRejected } from '../test/expect';
import type { GameState } from '../types';
import { TERRAIN_RESOURCE } from '../types';

/** Place settlement + road for the setup actor using the first legal choices. */
function placePair(state: GameState): GameState {
  const ph = state.phase;
  if (ph.kind !== 'setup') throw new Error('not in setup');
  const seat = state.setupOrder[ph.index]!;
  const v = getLegal(state, seat).settlementVertices[0]!;
  state = act(state, seat, { type: 'PLACE_SETTLEMENT', vertex: v }).state;
  const e = getLegal(state, seat).roadEdges[0]!;
  return act(state, seat, { type: 'PLACE_ROAD', edge: e }).state;
}

describe('setup (RULES.md#setup)', () => {
  it('follows the snake order 0..n-1, n-1..0', () => {
    let s = newGame(4);
    const actors: number[] = [];
    while (s.phase.kind === 'setup') {
      actors.push(s.setupOrder[s.phase.index]!);
      s = placePair(s);
    }
    expect(actors).toEqual([0, 1, 2, 3, 3, 2, 1, 0]);
  });

  it('rejects out-of-turn, wrong-step and illegal placements without touching state', () => {
    const s = newGame(4);
    const v = getLegal(s, 0).settlementVertices[0]!;
    expectRejected(s, 1, { type: 'PLACE_SETTLEMENT', vertex: v }, 'NOT_YOUR_TURN');
    expectRejected(s, 0, { type: 'PLACE_ROAD', edge: '0,0,NE' }, 'WRONG_PHASE');
    expectRejected(s, 0, { type: 'PLACE_SETTLEMENT', vertex: 'nope' }, 'ILLEGAL_LOCATION');
    expectRejected(s, 0, { type: 'ROLL' }, 'WRONG_PHASE');
    expectRejected(s, 0, { type: 'BUILD_SETTLEMENT', vertex: v }, 'WRONG_PHASE');
  });

  it('enforces the distance rule', () => {
    let s = newGame(4);
    const g = graphFor(s.board);
    const v = '0,0,N';
    s = expectOk(s, 0, { type: 'PLACE_SETTLEMENT', vertex: v }).state;
    s = expectOk(s, 0, { type: 'PLACE_ROAD', edge: g.vertexEdges[v]![0]! }).state;
    expectRejected(s, 1, { type: 'PLACE_SETTLEMENT', vertex: v }, 'ILLEGAL_LOCATION');
    for (const n of g.vertexNeighbors[v]!) {
      expectRejected(s, 1, { type: 'PLACE_SETTLEMENT', vertex: n }, 'ILLEGAL_LOCATION');
    }
    expect(getLegal(s, 1).settlementVertices).not.toContain(v);
  });

  it('requires the road to touch the settlement just placed', () => {
    let s = newGame(4);
    const g = graphFor(s.board);
    s = expectOk(s, 0, { type: 'PLACE_SETTLEMENT', vertex: '0,0,N' }).state;
    const far = g.edges.find((e) => !g.edgeVertices[e]!.includes('0,0,N'))!;
    expectRejected(s, 0, { type: 'PLACE_ROAD', edge: far }, 'ILLEGAL_LOCATION');
    expect(getLegal(s, 0).roadEdges.sort()).toEqual([...g.vertexEdges['0,0,N']!].sort());
  });

  it('gives resources only for the second settlement', () => {
    let s = newGame(3);
    for (let i = 0; i < 3; i++) s = placePair(s);
    expect(s.players.every((p) => totalResources(p.resources) === 0)).toBe(true);
    // Seat 2 places its second settlement now.
    const v = getLegal(s, 2).settlementVertices[0]!;
    const { state, events } = expectOk(s, 2, { type: 'PLACE_SETTLEMENT', vertex: v });
    const g = graphFor(s.board);
    const expected = g.vertexHexes[v]!.map(
      (h) => TERRAIN_RESOURCE[s.board.hexes.find((x) => x.id === h)!.terrain],
    ).filter(Boolean).length;
    expect(totalResources(state.players[2]!.resources)).toBe(expected);
    expect(eventsOf(events, 'setupResources')).toHaveLength(1);
    expect(eventsOf(events, 'setupResources')[0]!.resources).toEqual(state.players[2]!.resources);
  });

  it('starts turn 1 for setupOrder[0] after the final road', () => {
    let s = newGame(3);
    while (s.phase.kind === 'setup') {
      const last = s.phase.index === s.setupOrder.length - 1 && s.phase.step === 'road' ? s : null;
      if (last) {
        const seat = s.setupOrder[s.phase.index]!;
        const { state, events } = expectOk(s, seat, {
          type: 'PLACE_ROAD',
          edge: getLegal(s, seat).roadEdges[0]!,
        });
        expect(state.phase).toEqual({ kind: 'preRoll' });
        expect(state.turn).toMatchObject({ current: 0, number: 1, dice: null });
        expect(eventsOf(events, 'turnStarted')).toEqual([
          { type: 'turnStarted', seat: 0, turn: 1 },
        ]);
        s = state;
      } else s = placePair(s);
    }
    expect(Object.keys(s.buildings)).toHaveLength(6);
    expect(Object.keys(s.roads)).toHaveLength(6);
  });

  it('works for 6 players', () => {
    const s = finishSetup(newGame(6));
    expect(s.phase.kind).toBe('preRoll');
    expect(s.players.every((p) => p.settlementsLeft === 3 && p.roadsLeft === 13)).toBe(true);
  });
});
