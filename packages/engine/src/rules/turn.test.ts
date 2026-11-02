import { describe, expect, it } from 'vitest';
import { getLegal } from '../legal';
import { getPendingActors } from '../pending';
import { COSTS, resourcesOf } from '../resources';
import { give, inPhase, newGame, putBuilding, putPath, walk } from '../test/fixtures';
import { graphFor } from '../hex/topology';
import { eventsOf, expectOk, expectRejected } from '../test/expect';
import type { GameState } from '../types';

describe('end of turn (RULES.md#turn)', () => {
  it('passes to the next seat, merges new dev cards and resets the turn', () => {
    const s = inPhase(newGame(4), { kind: 'main' }, 3);
    s.turn.dice = [3, 4];
    s.turn.devPlayed = true;
    s.players[3]!.newDevCards = ['knight'];
    const { state, events } = expectOk(s, 3, { type: 'END_TURN' });
    expect(state.turn).toEqual({ current: 0, number: 2, dice: null, devPlayed: false });
    expect(state.phase).toEqual({ kind: 'preRoll' });
    expect(state.players[3]!.devCards).toEqual(['knight']);
    expect(state.players[3]!.newDevCards).toEqual([]);
    expect(events).toEqual([{ type: 'turnStarted', seat: 0, turn: 2 }]);
  });

  it('rejects END_TURN out of turn or before rolling', () => {
    const s = inPhase(newGame(4), { kind: 'main' }, 1);
    expectRejected(s, 0, { type: 'END_TURN' }, 'NOT_YOUR_TURN');
    expectRejected(
      inPhase(newGame(4), { kind: 'preRoll' }),
      0,
      { type: 'END_TURN' },
      'WRONG_PHASE',
    );
    expectRejected(s, 1, { type: 'PASS_SPECIAL_BUILD' }, 'WRONG_PHASE');
  });

  it('base game has no special building phase', () => {
    const s = give(inPhase(newGame(4), { kind: 'main' }, 0), 2, COSTS.devCard);
    expect(expectOk(s, 0, { type: 'END_TURN' }).state.phase).toEqual({ kind: 'preRoll' });
  });
});

describe('special building phase (RULES.md#five-or-six-players)', () => {
  function sbp(players: number, current: number): GameState {
    return inPhase(newGame(players), { kind: 'main' }, current);
  }

  it('visits the other seats in turn order, skipping those who cannot build', () => {
    let s = sbp(5, 3);
    give(s, 4, COSTS.devCard);
    give(s, 1, COSTS.devCard);
    give(s, 0, { brick: 1 }); // cannot afford anything
    let r = expectOk(s, 3, { type: 'END_TURN' });
    s = r.state;
    expect(s.phase).toEqual({ kind: 'specialBuild', seat: 4, queue: [0, 1, 2] });
    expect(s.turn.current).toBe(3);
    expect(eventsOf(r.events, 'specialBuildTurn')).toEqual([{ type: 'specialBuildTurn', seat: 4 }]);
    expect(getPendingActors(s)).toEqual([4]);
    expect(getLegal(s, 4).actions).toEqual(['BUY_DEV', 'PASS_SPECIAL_BUILD']);
    expect(getLegal(s, 3).actions).toEqual([]);
    expectRejected(s, 3, { type: 'PASS_SPECIAL_BUILD' }, 'NOT_YOUR_TURN');
    expectRejected(s, 3, { type: 'BUY_DEV' }, 'NOT_YOUR_TURN');

    r = expectOk(s, 4, { type: 'PASS_SPECIAL_BUILD' });
    s = r.state;
    expect(s.phase).toEqual({ kind: 'specialBuild', seat: 1, queue: [2] });
    r = expectOk(s, 1, { type: 'PASS_SPECIAL_BUILD' });
    expect(r.state.phase).toEqual({ kind: 'preRoll' });
    expect(r.state.turn.current).toBe(4);
    expect(r.events).toEqual([{ type: 'turnStarted', seat: 4, turn: 2 }]);
  });

  it('6 players: order wraps around from the seat after the active one', () => {
    const s = sbp(6, 4);
    for (const seat of [0, 1, 2, 3, 5]) give(s, seat, COSTS.road);
    const g = graphFor(s.board);
    const starts = ['-2,0,N', '2,-2,S', '-1,2,S', '0,0,N', '1,1,N', '-2,-1,S'];
    for (const seat of [0, 1, 2, 3, 5]) putBuilding(s, seat, starts[seat]!);
    expect(g.vertexEdges[starts[0]!]).toBeDefined();
    let state = expectOk(s, 4, { type: 'END_TURN' }).state;
    const order: number[] = [];
    while (state.phase.kind === 'specialBuild') {
      order.push(state.phase.seat);
      state = expectOk(state, state.phase.seat, { type: 'PASS_SPECIAL_BUILD' }).state;
    }
    expect(order).toEqual([5, 0, 1, 2, 3]);
    expect(state.turn.current).toBe(5);
  });

  it('no trading or dev cards during the phase, but building works', () => {
    const s = inPhase(newGame(5), { kind: 'specialBuild', seat: 1, queue: [] }, 0);
    give(s, 1, { ...COSTS.devCard, brick: 1 });
    s.players[1]!.devCards = ['knight', 'monopoly'];
    expectRejected(s, 1, { type: 'PLAY_KNIGHT' }, 'WRONG_PHASE');
    expectRejected(s, 1, { type: 'PLAY_MONOPOLY', resource: 'ore' }, 'WRONG_PHASE');
    expectRejected(
      s,
      1,
      {
        type: 'OFFER_TRADE',
        give: resourcesOf({ brick: 1 }),
        want: resourcesOf({ ore: 1 }),
        to: null,
        counterTo: null,
      },
      'WRONG_PHASE',
    );
    expectRejected(s, 1, { type: 'MARITIME_TRADE', give: 'brick', get: 'ore' }, 'WRONG_PHASE');
    expectRejected(s, 1, { type: 'END_TURN' }, 'WRONG_PHASE');
    expect(getLegal(s, 1).playableDev).toEqual([]);
    expectOk(s, 1, { type: 'BUY_DEV' });
  });

  it('dev cards bought in the phase are playable on the buyer’s next turn', () => {
    let s = inPhase(newGame(5), { kind: 'specialBuild', seat: 1, queue: [] }, 0);
    give(s, 1, COSTS.devCard);
    s.devDeck.push('knight');
    s = expectOk(s, 1, { type: 'BUY_DEV' }).state;
    s = expectOk(s, 1, { type: 'PASS_SPECIAL_BUILD' }).state;
    expect(s.turn.current).toBe(1);
    expect(s.players[1]!.devCards).toEqual(['knight']);
    expect(getLegal(s, 1).actions).toContain('PLAY_KNIGHT');
  });

  it('skips the phase entirely when nobody can build', () => {
    const { state } = expectOk(sbp(5, 0), 0, { type: 'END_TURN' });
    expect(state.phase).toEqual({ kind: 'preRoll' });
    expect(state.turn.current).toBe(1);
  });
});

describe('winning (RULES.md#winning)', () => {
  /** Seat 0 with 4 cities (8 VP) and a road to an open vertex; vpToWin 10. */
  function nearWin(): { s: GameState; spot: string } {
    const s = inPhase(newGame(4), { kind: 'main' }, 0);
    const g = graphFor(s.board);
    const [a, b, c] = walk(g, '0,0,N', 2) as [string, string, string];
    putBuilding(s, 0, a, 'city');
    putPath(s, 0, [a, b, c]);
    for (const v of ['-2,0,N', '2,-2,S', '-1,2,S']) putBuilding(s, 0, v, 'city');
    return { s, spot: c };
  }

  it('reaching vpToWin on your own turn ends the game immediately', () => {
    const { s, spot } = nearWin();
    s.players[0]!.devCards = ['victoryPoint'];
    give(s, 0, COSTS.settlement);
    const { state, events } = expectOk(s, 0, { type: 'BUILD_SETTLEMENT', vertex: spot });
    expect(state.phase).toEqual({ kind: 'gameOver', winner: 0 });
    expect(state.winner).toBe(0);
    expect(eventsOf(events, 'gameOver')).toEqual([
      { type: 'gameOver', winner: 0, vp: [10, 0, 0, 0] },
    ]);
    expectRejected(state, 1, { type: 'END_TURN' }, 'GAME_OVER');
    expect(getLegal(state, 0).actions).toEqual([]);
    expect(getPendingActors(state)).toEqual([]);
  });

  it('a hidden VP card bought this turn counts', () => {
    const { s } = nearWin();
    s.players[0]!.devCards = ['victoryPoint'];
    give(s, 0, COSTS.devCard);
    s.devDeck.push('victoryPoint');
    const { state } = expectOk(s, 0, { type: 'BUY_DEV' });
    expect(state.winner).toBe(0);
    expect(state.players[0]!.newDevCards).toEqual(['victoryPoint']);
  });

  it('9 VP is not enough', () => {
    const { s, spot } = nearWin();
    give(s, 0, COSTS.settlement);
    const { state } = expectOk(s, 0, { type: 'BUILD_SETTLEMENT', vertex: spot });
    expect(state.phase.kind).toBe('main');
    expect(state.winner).toBeNull();
  });

  it('reaching vpToWin off-turn wins only at the start of your own turn', () => {
    // 5 players: seat 1 ends; seat 2 buys its 10th VP during the special building phase.
    let s = inPhase(newGame(5), { kind: 'main' }, 1);
    for (const v of ['-2,0,N', '2,-2,S', '-1,2,S', '0,0,N']) putBuilding(s, 2, v, 'city');
    s.players[2]!.devCards = ['victoryPoint'];
    give(s, 2, COSTS.devCard);
    s.devDeck.push('victoryPoint');
    s = expectOk(s, 1, { type: 'END_TURN' }).state;
    expect(s.phase).toMatchObject({ kind: 'specialBuild', seat: 2 });
    s = expectOk(s, 2, { type: 'BUY_DEV' }).state;
    expect(s.phase.kind).toBe('specialBuild');
    expect(s.winner).toBeNull();
    const { state, events } = expectOk(s, 2, { type: 'PASS_SPECIAL_BUILD' });
    expect(state.turn.current).toBe(2);
    expect(state.phase).toEqual({ kind: 'gameOver', winner: 2 });
    expect(events.map((e) => e.type)).toEqual(['turnStarted', 'gameOver']);
  });

  it('respects a custom vpToWin', () => {
    const { s, spot } = nearWin();
    s.config.vpToWin = 12;
    s.players[0]!.devCards = ['victoryPoint'];
    give(s, 0, COSTS.settlement);
    expect(expectOk(s, 0, { type: 'BUILD_SETTLEMENT', vertex: spot }).state.winner).toBeNull();
  });
});
