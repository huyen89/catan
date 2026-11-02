import { describe, expect, it } from 'vitest';
import { getLegal } from '../legal';
import { getPendingActors } from '../pending';
import { resourcesOf, totalResources } from '../resources';
import { give, inPhase, newGame, putBuilding } from '../test/fixtures';
import { eventsOf, expectOk, expectRejected } from '../test/expect';
import type { GameState } from '../types';

function discardState(): GameState {
  const s = inPhase(newGame(4), { kind: 'discard', pending: { '1': 4, '2': 5 } });
  give(s, 1, { brick: 8 });
  give(s, 2, { ore: 6, wool: 4 });
  return s;
}

describe('discard (RULES.md#turn)', () => {
  it('validates count, ownership and seat', () => {
    const s = discardState();
    expectRejected(
      s,
      1,
      { type: 'DISCARD', resources: resourcesOf({ brick: 3 }) },
      'INVALID_ACTION',
    );
    expectRejected(
      s,
      1,
      { type: 'DISCARD', resources: resourcesOf({ ore: 4 }) },
      'INSUFFICIENT_RESOURCES',
    );
    expectRejected(s, 0, { type: 'DISCARD', resources: resourcesOf({}) }, 'NOT_YOUR_TURN');
    expectRejected(
      s,
      1,
      { type: 'DISCARD', resources: { ...resourcesOf({ brick: 4 }), wool: -1 } },
      'INVALID_ACTION',
    );
    expectRejected(inPhase(newGame(4), { kind: 'main' }), 1, {
      type: 'DISCARD',
      resources: resourcesOf({}),
    });
  });

  it('happens simultaneously in any order, then the roller moves the robber', () => {
    let s = discardState();
    expect(getPendingActors(s).sort()).toEqual([1, 2]);
    expect(getLegal(s, 2).discardCount).toBe(5);
    expect(getLegal(s, 2).actions).toEqual(['DISCARD']);
    expect(getLegal(s, 0).actions).toEqual([]);
    const r = expectOk(s, 2, { type: 'DISCARD', resources: resourcesOf({ ore: 3, wool: 2 }) });
    s = r.state;
    expect(eventsOf(r.events, 'discarded')[0]).toMatchObject({ seat: 2 });
    expect(s.phase).toEqual({ kind: 'discard', pending: { '1': 4 } });
    expect(totalResources(s.players[2]!.resources)).toBe(5);
    expectRejected(s, 2, { type: 'DISCARD', resources: resourcesOf({ ore: 1 }) }, 'NOT_YOUR_TURN');
    s = expectOk(s, 1, { type: 'DISCARD', resources: resourcesOf({ brick: 4 }) }).state;
    expect(s.phase).toEqual({ kind: 'moveRobber', returnTo: 'main' });
    expect(s.bank.brick).toBe(19 - 4);
  });
});

describe('robber and steal (RULES.md#turn)', () => {
  const robberState = (returnTo: 'main' | 'preRoll' = 'main') =>
    inPhase(newGame(4), { kind: 'moveRobber', returnTo });

  it('must move to a different land hex, by the current player', () => {
    const s = robberState();
    expectRejected(s, 0, { type: 'MOVE_ROBBER', hex: s.robber }, 'ILLEGAL_LOCATION');
    expectRejected(s, 0, { type: 'MOVE_ROBBER', hex: '9,9' }, 'ILLEGAL_LOCATION');
    expectRejected(s, 1, { type: 'MOVE_ROBBER', hex: '0,0' }, 'NOT_YOUR_TURN');
    expect(getLegal(s, 0).robberHexes).toHaveLength(18);
    expect(getLegal(s, 0).robberHexes).not.toContain(s.robber);
  });

  it('skips the steal with no eligible victim', () => {
    const s = robberState('preRoll');
    s.robber = '1,0';
    putBuilding(s, 0, '0,0,N'); // own building
    putBuilding(s, 1, '0,0,S'); // opponent with no cards
    const { state, events } = expectOk(s, 0, { type: 'MOVE_ROBBER', hex: '0,0' });
    expect(state.robber).toBe('0,0');
    expect(state.phase).toEqual({ kind: 'preRoll' });
    expect(eventsOf(events, 'stole')).toHaveLength(0);
    expect(eventsOf(events, 'robberMoved')[0]).toEqual({
      type: 'robberMoved',
      seat: 0,
      hex: '0,0',
    });
  });

  it('auto-steals from a single candidate', () => {
    const s = robberState();
    s.robber = '1,0';
    putBuilding(s, 1, '0,0,S');
    give(s, 1, { wool: 1 });
    const { state, events } = expectOk(s, 0, { type: 'MOVE_ROBBER', hex: '0,0' });
    expect(state.phase).toEqual({ kind: 'main' });
    expect(state.players[0]!.resources.wool).toBe(1);
    expect(state.players[1]!.resources.wool).toBe(0);
    expect(eventsOf(events, 'stole')).toEqual([
      { type: 'stole', thief: 0, victim: 1, resource: 'wool' },
    ]);
  });

  it('asks the roller to choose among several candidates', () => {
    let s = robberState();
    s.robber = '1,0';
    putBuilding(s, 1, '0,0,S');
    putBuilding(s, 2, '0,0,N', 'city');
    give(s, 1, { ore: 2 });
    give(s, 2, { grain: 1, lumber: 1 });
    s = expectOk(s, 0, { type: 'MOVE_ROBBER', hex: '0,0' }).state;
    expect(s.phase).toEqual({ kind: 'steal', candidates: [1, 2], returnTo: 'main' });
    expect(getLegal(s, 0).stealVictims).toEqual([1, 2]);
    expectRejected(s, 0, { type: 'STEAL', victim: 3 }, 'INVALID_ACTION');
    expectRejected(s, 0, { type: 'STEAL', victim: 0 }, 'INVALID_ACTION');
    expectRejected(s, 1, { type: 'STEAL', victim: 2 }, 'NOT_YOUR_TURN');
    const { state } = expectOk(s, 0, { type: 'STEAL', victim: 2 });
    expect(totalResources(state.players[0]!.resources)).toBe(1);
    expect(totalResources(state.players[2]!.resources)).toBe(1);
    expect(state.phase).toEqual({ kind: 'main' });
  });
});
