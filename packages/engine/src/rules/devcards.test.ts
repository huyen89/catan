import { describe, expect, it } from 'vitest';
import { getLegal } from '../legal';
import { graphFor } from '../hex/topology';
import { resourcesOf } from '../resources';
import { edgeBetween, give, inPhase, newGame, putBuilding, putPath, walk } from '../test/fixtures';
import { eventsOf, expectOk, expectRejected } from '../test/expect';
import type { DevCardType, GameState, Phase } from '../types';

function withCards(phase: Phase, cards: DevCardType[], current = 0): GameState {
  const s = inPhase(newGame(4), phase, current);
  s.players[current]!.devCards = [...cards];
  return s;
}

describe('dev cards (RULES.md#development-cards)', () => {
  it('knight in preRoll moves the robber then returns to preRoll', () => {
    let s = withCards({ kind: 'preRoll' }, ['knight']);
    expect(getLegal(s, 0).actions).toEqual(['ROLL', 'PLAY_KNIGHT']);
    expect(getLegal(s, 0).playableDev).toEqual(['knight']);
    const r = expectOk(s, 0, { type: 'PLAY_KNIGHT' });
    s = r.state;
    expect(r.events).toContainEqual({ type: 'playedDev', seat: 0, card: 'knight' });
    expect(s.phase).toEqual({ kind: 'moveRobber', returnTo: 'preRoll', allowPirate: false });
    expect(s.players[0]!.playedKnights).toBe(1);
    expect(s.players[0]!.devCards).toEqual([]);
    s = expectOk(s, 0, { type: 'MOVE_ROBBER', hex: '0,0' === s.robber ? '1,0' : '0,0' }).state;
    expect(s.phase).toEqual({ kind: 'preRoll' });
    expect(s.turn.devPlayed).toBe(true);
  });

  it('knight in main returns to main and can win largest army', () => {
    const s = withCards({ kind: 'main' }, ['knight']);
    s.players[0]!.playedKnights = 2;
    const { state, events } = expectOk(s, 0, { type: 'PLAY_KNIGHT' });
    expect(state.phase).toEqual({ kind: 'moveRobber', returnTo: 'main', allowPirate: false });
    expect(state.largestArmy).toBe(0);
    expect(eventsOf(events, 'awardChanged')).toEqual([
      { type: 'awardChanged', award: 'largestArmy', holder: 0 },
    ]);
  });

  it('only one dev card per turn, never one bought this turn, never VP cards', () => {
    const s = withCards({ kind: 'main' }, ['knight', 'monopoly', 'victoryPoint']);
    s.players[0]!.newDevCards = ['yearOfPlenty'];
    expect(getLegal(s, 0).playableDev).toEqual(['knight', 'monopoly']);
    expectRejected(
      s,
      0,
      { type: 'PLAY_YEAR_OF_PLENTY', resources: ['ore', 'ore'] },
      'DEV_CARD_NOT_PLAYABLE',
    );
    const played = expectOk(s, 0, { type: 'PLAY_MONOPOLY', resource: 'ore' }).state;
    expectRejected(played, 0, { type: 'PLAY_KNIGHT' }, 'DEV_CARD_NOT_PLAYABLE');
    expect(getLegal(played, 0).playableDev).toEqual([]);
    expectRejected(s, 1, { type: 'PLAY_KNIGHT' }, 'NOT_YOUR_TURN');
  });

  it('only the knight may be played before the roll', () => {
    const s = withCards({ kind: 'preRoll' }, ['roadBuilding', 'yearOfPlenty', 'monopoly']);
    expectRejected(s, 0, { type: 'PLAY_ROAD_BUILDING' }, 'WRONG_PHASE');
    expectRejected(
      s,
      0,
      { type: 'PLAY_YEAR_OF_PLENTY', resources: ['ore', 'wool'] },
      'WRONG_PHASE',
    );
    expectRejected(s, 0, { type: 'PLAY_MONOPOLY', resource: 'ore' }, 'WRONG_PHASE');
    expect(getLegal(s, 0).actions).toEqual(['ROLL']);
  });

  it('year of plenty takes two resources the bank has', () => {
    const s = withCards({ kind: 'main' }, ['yearOfPlenty']);
    const { state, events } = expectOk(s, 0, {
      type: 'PLAY_YEAR_OF_PLENTY',
      resources: ['ore', 'wool'],
    });
    expect(state.players[0]!.resources).toEqual(resourcesOf({ ore: 1, wool: 1 }));
    expect(state.bank.ore).toBe(18);
    expect(eventsOf(events, 'yearOfPlenty')[0]!.resources).toEqual(['ore', 'wool']);
    const low = structuredClone(s);
    give(low, 1, { ore: 18 });
    expectRejected(
      low,
      0,
      { type: 'PLAY_YEAR_OF_PLENTY', resources: ['ore', 'ore'] },
      'BANK_EMPTY',
    );
    expectOk(low, 0, { type: 'PLAY_YEAR_OF_PLENTY', resources: ['ore', 'grain'] });
    expectRejected(
      s,
      0,
      { type: 'PLAY_YEAR_OF_PLENTY', resources: ['ore', 'gold'] as never },
      'INVALID_ACTION',
    );
  });

  it('monopoly takes every opponent card of one resource', () => {
    const s = withCards({ kind: 'main' }, ['monopoly']);
    give(s, 0, { grain: 1 });
    give(s, 1, { grain: 2, ore: 1 });
    give(s, 3, { grain: 3 });
    const { state, events } = expectOk(s, 0, { type: 'PLAY_MONOPOLY', resource: 'grain' });
    expect(state.players[0]!.resources.grain).toBe(6);
    expect(state.players[1]!.resources).toEqual(resourcesOf({ ore: 1 }));
    expect(eventsOf(events, 'monopoly')[0]!.taken).toEqual({ '1': 2, '3': 3 });
    expectRejected(s, 0, { type: 'PLAY_MONOPOLY', resource: 'x' as never }, 'INVALID_ACTION');
  });

  it('road building gives two free roads, then back to main', () => {
    const s = withCards({ kind: 'main' }, ['roadBuilding']);
    const g = graphFor(s.board);
    const [a, b, c, d] = walk(g, '0,0,N', 3);
    putBuilding(s, 0, a!);
    let r = expectOk(s, 0, { type: 'PLAY_ROAD_BUILDING' }).state;
    expect(r.phase).toEqual({ kind: 'roadBuilding', remaining: 2 });
    expect(getLegal(r, 0).actions).toEqual(['BUILD_ROAD']);
    expectRejected(r, 0, { type: 'END_TURN' }, 'WRONG_PHASE');
    r = expectOk(r, 0, { type: 'BUILD_ROAD', edge: edgeBetween(g, a!, b!) }).state;
    expect(r.phase).toEqual({ kind: 'roadBuilding', remaining: 1 });
    r = expectOk(r, 0, { type: 'BUILD_ROAD', edge: edgeBetween(g, b!, c!) }).state;
    expect(r.phase).toEqual({ kind: 'main' });
    expect(r.players[0]!.resources).toEqual(resourcesOf({}));
    expect(r.players[0]!.roadsLeft).toBe(13);
    expect(d).toBeDefined();
  });

  it('road building with one road left gives one; it is refused with no road to build', () => {
    const s = withCards({ kind: 'main' }, ['roadBuilding']);
    const g = graphFor(s.board);
    const [a, b] = walk(g, '0,0,N', 1);
    putBuilding(s, 0, a!);
    s.players[0]!.roadsLeft = 1;
    const one = expectOk(s, 0, { type: 'PLAY_ROAD_BUILDING' }).state;
    expect(one.phase).toEqual({ kind: 'roadBuilding', remaining: 1 });
    expect(
      expectOk(one, 0, { type: 'BUILD_ROAD', edge: edgeBetween(g, a!, b!) }).state.phase,
    ).toEqual({ kind: 'main' });

    const none = withCards({ kind: 'main' }, ['roadBuilding']); // no network at all
    expect(getLegal(none, 0).playableDev).toEqual([]);
    expect(getLegal(none, 0).actions).not.toContain('PLAY_ROAD_BUILDING');
    expectRejected(none, 0, { type: 'PLAY_ROAD_BUILDING' }, 'DEV_CARD_NOT_PLAYABLE');
    const noRoads = structuredClone(s);
    noRoads.players[0]!.roadsLeft = 0;
    expect(getLegal(noRoads, 0).actions).not.toContain('PLAY_ROAD_BUILDING');
    expectRejected(noRoads, 0, { type: 'PLAY_ROAD_BUILDING' }, 'DEV_CARD_NOT_PLAYABLE');
  });

  it('road building stops early when the network is boxed in', () => {
    const s = withCards({ kind: 'main' }, ['roadBuilding']);
    const g = graphFor(s.board);
    const [a, b] = walk(g, '0,0,N', 1) as [string, string];
    putBuilding(s, 0, a);
    // Every other edge at `a` is taken by an opponent and `b` holds an opponent building,
    // so after a-b the network cannot grow.
    for (const v of g.vertexNeighbors[a]!) if (v !== b) putPath(s, 1, [a, v]);
    putBuilding(s, 1, b);
    expect(getLegal(s, 0).actions).toContain('PLAY_ROAD_BUILDING');
    let r = expectOk(s, 0, { type: 'PLAY_ROAD_BUILDING' }).state;
    expect(r.phase).toEqual({ kind: 'roadBuilding', remaining: 2 });
    r = expectOk(r, 0, { type: 'BUILD_ROAD', edge: edgeBetween(g, a, b) }).state;
    expect(r.phase).toEqual({ kind: 'main' });
    expect(r.players[0]!.roadsLeft).toBe(14);
  });
});
