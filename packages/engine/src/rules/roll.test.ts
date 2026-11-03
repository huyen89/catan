import { describe, expect, it } from 'vitest';
import { applyAction } from '../reducer';
import { totalResources } from '../resources';
import { seedRng } from '../rng';
import { give, inPhase, newGame, putBuilding, setHex } from '../test/fixtures';
import { eventsOf, expectOk, expectRejected } from '../test/expect';
import type { GameState } from '../types';

/** Re-seed until the next ROLL by seat 0 yields `total`. */
function rollTo(state: GameState, total: number): GameState {
  for (let i = 0; i < 500; i++) {
    const s = structuredClone(state);
    s.rng = seedRng(`roll-${i}`);
    const res = applyAction(s, s.turn.current, { type: 'ROLL' });
    if (res.ok && res.state.turn.dice![0] + res.state.turn.dice![1] === total) return s;
  }
  throw new Error(`could not find seed for ${total}`);
}

/** Fresh state with every hex blank except 0,0 (hills, token 8); robber on 1,0. */
function productionBoard(players = 4): GameState {
  const s = inPhase(newGame(players), { kind: 'preRoll' });
  for (const h of s.board.hexes) setHex(s, h.id, 'desert', null);
  setHex(s, '0,0', 'hills', 8);
  s.robber = '1,0';
  return s;
}

describe('roll and production (RULES.md#turn)', () => {
  it('only the current player may roll, only in preRoll', () => {
    const s = inPhase(newGame(4), { kind: 'preRoll' });
    expectRejected(s, 1, { type: 'ROLL' }, 'NOT_YOUR_TURN');
    expectRejected(inPhase(newGame(4), { kind: 'main' }), 0, { type: 'ROLL' }, 'WRONG_PHASE');
  });

  it('rolls two dice from the seeded rng and records them', () => {
    const s = inPhase(newGame(4), { kind: 'preRoll' });
    const { state, events } = expectOk(s, 0, { type: 'ROLL' });
    const [a, b] = state.turn.dice!;
    expect(a).toBeGreaterThanOrEqual(1);
    expect(b).toBeLessThanOrEqual(6);
    expect(eventsOf(events, 'rolled')[0]).toMatchObject({ seat: 0, total: a + b });
    expect(state.rng).not.toEqual(s.rng);
  });

  it('settlements get 1, cities 2; the robber blocks its hex', () => {
    const s = rollTo(productionBoard(), 8);
    putBuilding(s, 1, '0,0,N');
    putBuilding(s, 2, '0,0,S', 'city');
    const { state, events } = expectOk(s, 0, { type: 'ROLL' });
    expect(state.phase.kind).toBe('main');
    expect(state.players[1]!.resources.brick).toBe(1);
    expect(state.players[2]!.resources.brick).toBe(2);
    expect(state.bank.brick).toBe(s.bank.brick - 3);
    expect(eventsOf(events, 'produced')[0]!.gains['2']!.brick).toBe(2);

    const blocked = structuredClone(s);
    blocked.robber = '0,0';
    const r2 = expectOk(blocked, 0, { type: 'ROLL' }).state;
    expect(r2.players[1]!.resources.brick).toBe(0);
    expect(r2.players[2]!.resources.brick).toBe(0);
  });

  it('bank shortage: nobody gets a resource the bank cannot cover for everyone', () => {
    const s = rollTo(productionBoard(), 8);
    putBuilding(s, 1, '0,0,N');
    putBuilding(s, 2, '0,0,S', 'city');
    give(s, 3, { brick: s.bank.brick - 2 }); // bank has 2 brick, 3 owed
    const state = expectOk(s, 0, { type: 'ROLL' }).state;
    expect(state.players[1]!.resources.brick).toBe(0);
    expect(state.players[2]!.resources.brick).toBe(0);
    expect(state.bank.brick).toBe(2);
  });

  it('bank shortage exception: a single owed player gets what remains', () => {
    const s = rollTo(productionBoard(), 8);
    putBuilding(s, 2, '0,0,S', 'city');
    give(s, 3, { brick: s.bank.brick - 1 });
    const state = expectOk(s, 0, { type: 'ROLL' }).state;
    expect(state.players[2]!.resources.brick).toBe(1);
    expect(state.bank.brick).toBe(0);
  });

  it('a 7 with no big hands goes straight to moveRobber (returnTo main)', () => {
    const s = rollTo(productionBoard(), 7);
    give(s, 1, { brick: 7 });
    const state = expectOk(s, 0, { type: 'ROLL' }).state;
    expect(state.phase).toEqual({ kind: 'moveRobber', returnTo: 'main', allowPirate: false });
  });

  it('a 7 requires everyone over discardLimit to discard floor(n/2)', () => {
    const s = rollTo(productionBoard(), 7);
    give(s, 1, { brick: 8 });
    give(s, 2, { ore: 5, wool: 4 });
    give(s, 0, { grain: 3 });
    const { state, events } = expectOk(s, 0, { type: 'ROLL' });
    expect(state.phase).toEqual({ kind: 'discard', pending: { '1': 4, '2': 4 } });
    expect(eventsOf(events, 'discardRequired')[0]!.pending).toEqual({ '1': 4, '2': 4 });
  });

  it('respects a custom discardLimit', () => {
    const s = rollTo(productionBoard(), 7);
    s.config.discardLimit = 9;
    give(s, 1, { brick: 9 });
    expect(expectOk(s, 0, { type: 'ROLL' }).state.phase.kind).toBe('moveRobber');
    expect(totalResources(s.players[1]!.resources)).toBe(9);
  });
});
