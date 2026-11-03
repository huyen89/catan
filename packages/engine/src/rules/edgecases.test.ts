/** Rule edge cases from docs/RULES.md, exercised through applyAction end to end. */
import { describe, expect, it } from 'vitest';
import { getLegal } from '../legal';
import { graphFor } from '../hex/topology';
import { applyAction } from '../reducer';
import { COSTS, resourcesOf, totalResources } from '../resources';
import { seedRng } from '../rng';
import {
  ctxFor,
  edgeBetween,
  give,
  inPhase,
  newGame,
  putBuilding,
  putPath,
  putRoad,
  setHand,
  walk,
} from '../test/fixtures';
import { eventsOf, expectOk, expectRejected } from '../test/expect';
import { violations } from '../test/invariants';
import type { GameState, VertexId } from '../types';
import { updateLongestRoad } from './awards';
import { publicVP } from './victory';

/** Re-seed until the next ROLL by the current player yields `total`. */
function rollTo(state: GameState, total: number): GameState {
  for (let i = 0; i < 500; i++) {
    const s = structuredClone(state);
    s.rng = seedRng(`edge-${i}`);
    const res = applyAction(s, s.turn.current, { type: 'ROLL' });
    if (res.ok && res.state.turn.dice![0] + res.state.turn.dice![1] === total) return s;
  }
  throw new Error(`could not find seed for ${total}`);
}

describe('rolling a 7 (RULES.md#turn)', () => {
  it('with no hand over the limit: no discard phase, straight to the robber', () => {
    const s = rollTo(inPhase(newGame(4), { kind: 'preRoll' }), 7);
    const { state, events } = expectOk(s, 0, { type: 'ROLL' });
    expect(state.phase).toEqual({ kind: 'moveRobber', returnTo: 'main' });
    expect(eventsOf(events, 'discardRequired')).toEqual([]);
    expect(getLegal(state, 1).actions).toEqual([]);
    expectRejected(state, 1, { type: 'DISCARD', resources: resourcesOf({}) }, 'WRONG_PHASE');
  });

  it('exactly the limit keeps every card; one over discards half rounded down', () => {
    const s = rollTo(inPhase(newGame(4), { kind: 'preRoll' }), 7);
    setHand(s, 0, { brick: 4, ore: 3 }); // 7 = limit (the roller too)
    setHand(s, 1, { wool: 7 }); // 7 = limit
    setHand(s, 2, { grain: 8 }); // 8 → 4
    setHand(s, 3, { lumber: 5, ore: 4 }); // 9 → 4
    let state = expectOk(s, 0, { type: 'ROLL' }).state;
    expect(state.phase).toEqual({ kind: 'discard', pending: { '2': 4, '3': 4 } });
    expect(getLegal(state, 0).actions).toEqual([]);
    expect(getLegal(state, 1).discardCount).toBe(0);
    expect(getLegal(state, 2).discardCount).toBe(4);
    expectRejected(
      state,
      2,
      { type: 'DISCARD', resources: resourcesOf({ grain: 3 }) },
      'INVALID_ACTION',
    );
    expectRejected(
      state,
      2,
      { type: 'DISCARD', resources: resourcesOf({ grain: 5 }) },
      'INVALID_ACTION',
    );
    state = expectOk(state, 2, { type: 'DISCARD', resources: resourcesOf({ grain: 4 }) }).state;
    state = expectOk(state, 3, {
      type: 'DISCARD',
      resources: resourcesOf({ lumber: 2, ore: 2 }),
    }).state;
    expect(state.phase).toEqual({ kind: 'moveRobber', returnTo: 'main' });
    expect(state.players.map((p) => totalResources(p.resources))).toEqual([7, 7, 4, 5]);
    expect(violations(state)).toEqual([]);
  });

  it('a hand that drops to the limit before the 7 does not discard', () => {
    const s = rollTo(inPhase(newGame(4), { kind: 'preRoll' }), 7);
    setHand(s, 1, { brick: 8 });
    setHand(s, 1, { brick: 7 });
    expect(expectOk(s, 0, { type: 'ROLL' }).state.phase.kind).toBe('moveRobber');
  });
});

describe('special building phase edge cases (RULES.md#five-or-six-players)', () => {
  it('passing with an empty queue starts the next regular turn', () => {
    const s = inPhase(newGame(5), { kind: 'specialBuild', seat: 1, queue: [] }, 0);
    const { state, events } = expectOk(s, 1, { type: 'PASS_SPECIAL_BUILD' });
    expect(state.phase).toEqual({ kind: 'preRoll' });
    expect(state.turn.current).toBe(1);
    expect(events).toEqual([{ type: 'turnStarted', seat: 1, turn: 2 }]);
  });

  it('the last seat in the queue (just before the active player) hands back to the next seat', () => {
    // Current 2 of 6: the queue ends with seat 1; afterwards seat 3 starts its turn.
    const s = inPhase(newGame(6), { kind: 'specialBuild', seat: 1, queue: [] }, 2);
    const state = expectOk(s, 1, { type: 'PASS_SPECIAL_BUILD' }).state;
    expect(state.turn.current).toBe(3);
    expect(state.phase.kind).toBe('preRoll');
  });

  it('remaining seats who can no longer build are skipped', () => {
    const s = inPhase(newGame(5), { kind: 'specialBuild', seat: 1, queue: [2, 3] }, 0);
    give(s, 3, COSTS.devCard);
    const state = expectOk(s, 1, { type: 'PASS_SPECIAL_BUILD' }).state;
    expect(state.phase).toEqual({ kind: 'specialBuild', seat: 3, queue: [] });
  });

  it('the base game never enters it, even with 3–4 players on ext56 it does', () => {
    const base = give(inPhase(newGame(4), { kind: 'main' }), 1, COSTS.devCard);
    expect(expectOk(base, 0, { type: 'END_TURN' }).state.phase.kind).toBe('preRoll');
    const ext = give(inPhase(newGame(3, { variant: 'ext56' }), { kind: 'main' }), 1, COSTS.devCard);
    expect(expectOk(ext, 0, { type: 'END_TURN' }).state.phase).toEqual({
      kind: 'specialBuild',
      seat: 1,
      queue: [2],
    });
  });
});

describe('ports right after building (RULES.md#trading)', () => {
  it('a settlement built on a 2:1 port this turn trades at 2:1 immediately', () => {
    let s = inPhase(newGame(4), { kind: 'main' });
    const g = graphFor(s.board);
    const port = s.board.ports.find((p) => p.type === 'ore')!;
    const spot = port.vertices[0];
    const [, mid, far] = walk(g, spot, 2) as [VertexId, VertexId, VertexId];
    putBuilding(s, 0, far);
    putPath(s, 0, [far, mid, spot]);
    give(s, 0, { ...COSTS.settlement, ore: 2 });
    expect(getLegal(s, 0).maritimeRatios.ore).toBe(4);
    expect(getLegal(s, 0).actions).not.toContain('MARITIME_TRADE');
    expectRejected(
      s,
      0,
      { type: 'MARITIME_TRADE', give: 'ore', get: 'wool' },
      'INSUFFICIENT_RESOURCES',
    );

    s = expectOk(s, 0, { type: 'BUILD_SETTLEMENT', vertex: spot }).state;
    const legal = getLegal(s, 0);
    expect(legal.maritimeRatios).toEqual({ brick: 4, lumber: 4, wool: 4, grain: 4, ore: 2 });
    expect(legal.actions).toContain('MARITIME_TRADE');
    const { state, events } = expectOk(s, 0, { type: 'MARITIME_TRADE', give: 'ore', get: 'wool' });
    expect(state.players[0]!.resources).toEqual(resourcesOf({ wool: 1 }));
    expect(events).toEqual([
      { type: 'maritimeTrade', seat: 0, give: 'ore', giveCount: 2, get: 'wool' },
    ]);
  });

  it("an opponent's port does not help", () => {
    const s = inPhase(newGame(4), { kind: 'main' });
    const port = s.board.ports.find((p) => p.type === 'brick')!;
    putBuilding(s, 1, port.vertices[0]);
    give(s, 0, { brick: 2 });
    expect(getLegal(s, 0).maritimeRatios.brick).toBe(4);
    expect(getLegal(s, 1).maritimeRatios.brick).toBe(2);
  });
});

describe('road building edge cases (RULES.md#development-cards)', () => {
  it('with exactly 1 road left: one free road, then main; the supply is exhausted', () => {
    const s = inPhase(newGame(4), { kind: 'main' });
    s.players[0]!.devCards = ['roadBuilding'];
    const g = graphFor(s.board);
    const [a, b] = walk(g, '0,0,N', 1) as [VertexId, VertexId];
    putBuilding(s, 0, a);
    s.players[0]!.roadsLeft = 1;
    let r = expectOk(s, 0, { type: 'PLAY_ROAD_BUILDING' }).state;
    expect(r.phase).toEqual({ kind: 'roadBuilding', remaining: 1 });
    r = expectOk(r, 0, { type: 'BUILD_ROAD', edge: edgeBetween(g, a, b) }).state;
    expect(r.phase).toEqual({ kind: 'main' });
    expect(r.players[0]!.roadsLeft).toBe(0);
    expect(r.turn.devPlayed).toBe(true);
    expect(getLegal(r, 0).roadEdges).toEqual([]);
    give(r, 0, COSTS.road);
    expectRejected(r, 0, { type: 'BUILD_ROAD', edge: g.vertexEdges[b]![0]! }, 'NO_PIECES_LEFT');
  });
});

describe('monopoly edge cases (RULES.md#development-cards)', () => {
  function monopolyState(): GameState {
    const s = inPhase(newGame(4), { kind: 'main' });
    s.players[0]!.devCards = ['monopoly'];
    return s;
  }

  it('nobody holding the resource still uses the card and takes nothing', () => {
    const s = monopolyState();
    give(s, 0, { ore: 2 });
    give(s, 1, { brick: 3 });
    const { state, events } = expectOk(s, 0, { type: 'PLAY_MONOPOLY', resource: 'ore' });
    expect(state.players[0]!.resources).toEqual(resourcesOf({ ore: 2 }));
    expect(state.players[0]!.devCards).toEqual([]);
    expect(eventsOf(events, 'monopoly')).toEqual([
      { type: 'monopoly', seat: 0, resource: 'ore', taken: {} },
    ]);
  });

  it('never takes from the bank and keeps the player’s own cards', () => {
    const s = monopolyState();
    give(s, 0, { wool: 1 });
    give(s, 2, { wool: 4 });
    const bank = { ...s.bank };
    const { state } = expectOk(s, 0, { type: 'PLAY_MONOPOLY', resource: 'wool' });
    expect(state.bank).toEqual(bank);
    expect(state.players[0]!.resources.wool).toBe(5);
    expect(state.players[2]!.resources.wool).toBe(0);
    expect(violations(state)).toEqual([]);
  });

  it('only on the owner’s turn, in main, once per turn, not the turn it was bought', () => {
    const s = monopolyState();
    expectRejected(s, 1, { type: 'PLAY_MONOPOLY', resource: 'ore' }, 'NOT_YOUR_TURN');
    const pre = structuredClone(s);
    pre.phase = { kind: 'preRoll' };
    expectRejected(pre, 0, { type: 'PLAY_MONOPOLY', resource: 'ore' }, 'WRONG_PHASE');
    const fresh = structuredClone(s);
    fresh.players[0]!.devCards = [];
    fresh.players[0]!.newDevCards = ['monopoly'];
    expectRejected(fresh, 0, { type: 'PLAY_MONOPOLY', resource: 'ore' }, 'DEV_CARD_NOT_PLAYABLE');
    const twice = structuredClone(s);
    twice.players[0]!.devCards = ['monopoly', 'monopoly'];
    const once = expectOk(twice, 0, { type: 'PLAY_MONOPOLY', resource: 'ore' }).state;
    expectRejected(once, 0, { type: 'PLAY_MONOPOLY', resource: 'ore' }, 'DEV_CARD_NOT_PLAYABLE');
  });
});

describe('longest road tie after a break, through BUILD_SETTLEMENT (RULES.md#awards)', () => {
  /** Seat 0 holds longest road with 7, seat 1 has 6; seat 2 can build on seat 0's 7th vertex. */
  function setup(): {
    s: GameState;
    cut: VertexId;
    extendTo: [VertexId, VertexId];
    paths: VertexId[][];
  } {
    const s = inPhase(newGame(4), { kind: 'main' }, 2);
    const g = graphFor(s.board);
    const tryWalk = (start: VertexId, n: number, avoid: Set<VertexId>) => {
      try {
        return walk(g, start, n, avoid);
      } catch {
        return null;
      }
    };
    // Seat 0: a 7-road path whose vertex after its 6th road has a free third edge, so cutting
    // there leaves 6 + 1.
    const third = (p: VertexId[], v: VertexId) => g.vertexNeighbors[v]!.find((n) => !p.includes(n));
    const p0 = g.vertices
      .map((v) => tryWalk(v, 7, new Set()))
      .find((p) => p !== null && third(p, p[6]!) !== undefined)!;
    const used = new Set<VertexId>();
    for (const v of p0) for (const nb of [v, ...g.vertexNeighbors[v]!]) used.add(nb);
    used.add(third(p0, p0[6]!)!);
    for (const nb of g.vertexNeighbors[third(p0, p0[6]!)!]!) used.add(nb);
    // Seat 1: a disjoint 6-road path that can still grow by one at its end.
    const p1 = g.vertices
      .filter((v) => !used.has(v))
      .map((v) => tryWalk(v, 6, used))
      .find((p) => p !== null && third(p, p.at(-1)!) !== undefined)!;
    putPath(s, 0, p0);
    putPath(s, 1, p1);
    const paths = [p0, p1];
    const cut = p0[6]!;
    const side = third(p0, cut)!;
    putRoad(s, 2, edgeBetween(g, side, cut));
    updateLongestRoad(ctxFor(s));
    expect(s.longestRoad).toBe(0);
    give(s, 2, COSTS.settlement);
    const end = paths[1]!.at(-1)!;
    const next = third(p1, end)!;
    return { s, cut, extendTo: [end, next], paths };
  }

  it('holder cut into a tie loses the award to nobody; VP follow', () => {
    const { s, cut } = setup();
    expect(publicVP(s, 0)).toBe(2);
    const { state, events } = expectOk(s, 2, { type: 'BUILD_SETTLEMENT', vertex: cut });
    expect(state.players[0]!.longestRoadLength).toBe(6);
    expect(state.players[1]!.longestRoadLength).toBe(6);
    expect(state.longestRoad).toBeNull();
    expect(eventsOf(events, 'awardChanged')).toEqual([
      { type: 'awardChanged', award: 'longestRoad', holder: null },
    ]);
    expect(publicVP(state, 0)).toBe(0);
    expect(violations(state)).toEqual([]);
  });

  it('after the break, the first to become strictly longest takes it', () => {
    const { s, cut, extendTo } = setup();
    let state = expectOk(s, 2, { type: 'BUILD_SETTLEMENT', vertex: cut }).state;
    state = inPhase(state, { kind: 'main' }, 1);
    give(state, 1, COSTS.road);
    const g = graphFor(state.board);
    const r = expectOk(state, 1, { type: 'BUILD_ROAD', edge: edgeBetween(g, ...extendTo) });
    expect(r.state.players[1]!.longestRoadLength).toBe(7);
    expect(r.state.longestRoad).toBe(1);
    expect(violations(r.state)).toEqual([]);
  });

  it('a settlement on your own road does not cut it', () => {
    const { s, paths } = setup();
    const own = inPhase(s, { kind: 'main' }, 0);
    give(own, 0, COSTS.settlement);
    const { state, events } = expectOk(own, 0, { type: 'BUILD_SETTLEMENT', vertex: paths[0]![3]! });
    expect(state.players[0]!.longestRoadLength).toBe(7);
    expect(state.longestRoad).toBe(0);
    expect(eventsOf(events, 'awardChanged')).toEqual([]);
  });
});
