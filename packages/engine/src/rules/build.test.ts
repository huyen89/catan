import { describe, expect, it } from 'vitest';
import { getLegal } from '../legal';
import { graphFor } from '../hex/topology';
import { COSTS, resourcesOf } from '../resources';
import {
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
import type { GameState } from '../types';

const g = graphFor(newGame(4).board);
// Seat 0 owns a settlement at A and a 2-road path A-B-C.
const [A, B, C, D] = walk(g, '0,0,N', 3) as [string, string, string, string];

function mainState(): GameState {
  const s = inPhase(newGame(4), { kind: 'main' });
  putBuilding(s, 0, A);
  putPath(s, 0, [A, B, C]);
  return s;
}

describe('building (RULES.md#building)', () => {
  it('BUILD_ROAD: pays, connects to own network, updates pieces', () => {
    const s = give(mainState(), 0, { brick: 1, lumber: 1 });
    const e = edgeBetween(g, C, D);
    const { state, events } = expectOk(s, 0, { type: 'BUILD_ROAD', edge: e });
    expect(state.roads[e]).toBe(0);
    expect(state.players[0]!.roadsLeft).toBe(12);
    expect(state.players[0]!.resources).toEqual(resourcesOf({}));
    expect(state.bank.brick).toBe(19);
    expect(state.players[0]!.longestRoadLength).toBe(3);
    expect(eventsOf(events, 'built')).toEqual([{ type: 'built', seat: 0, kind: 'road', at: e }]);
  });

  it('BUILD_ROAD rejections', () => {
    const s = mainState();
    const e = edgeBetween(g, C, D);
    expectRejected(s, 0, { type: 'BUILD_ROAD', edge: e }, 'INSUFFICIENT_RESOURCES');
    give(s, 0, { brick: 2, lumber: 2 });
    expectRejected(s, 0, { type: 'BUILD_ROAD', edge: edgeBetween(g, A, B) }, 'ILLEGAL_LOCATION');
    const far = g.edges.find((x) => !g.edgeVertices[x]!.some((v) => [A, B, C].includes(v)))!;
    expectRejected(s, 0, { type: 'BUILD_ROAD', edge: far }, 'ILLEGAL_LOCATION');
    expectRejected(s, 0, { type: 'BUILD_ROAD', edge: 'x' }, 'ILLEGAL_LOCATION');
    expectRejected(s, 1, { type: 'BUILD_ROAD', edge: e }, 'NOT_YOUR_TURN');
    const pre = inPhase(structuredClone(s), { kind: 'preRoll' });
    expectRejected(pre, 0, { type: 'BUILD_ROAD', edge: e }, 'WRONG_PHASE');
    const empty = structuredClone(s);
    empty.players[0]!.roadsLeft = 0;
    expectRejected(empty, 0, { type: 'BUILD_ROAD', edge: e }, 'NO_PIECES_LEFT');
  });

  it('a road cannot continue through an opponent building', () => {
    const s = give(mainState(), 0, { brick: 1, lumber: 1 });
    putBuilding(s, 1, C);
    expectRejected(s, 0, { type: 'BUILD_ROAD', edge: edgeBetween(g, C, D) }, 'ILLEGAL_LOCATION');
    expect(getLegal(s, 0).roadEdges).not.toContain(edgeBetween(g, C, D));
  });

  it('BUILD_SETTLEMENT: needs own road and the distance rule', () => {
    const s = give(mainState(), 0, { brick: 2, lumber: 2, wool: 2, grain: 2 });
    expectRejected(s, 0, { type: 'BUILD_SETTLEMENT', vertex: B }, 'ILLEGAL_LOCATION'); // next to A
    expectRejected(s, 0, { type: 'BUILD_SETTLEMENT', vertex: D }, 'ILLEGAL_LOCATION'); // no road
    expect(getLegal(s, 0).settlementVertices).toEqual([C]);
    const { state } = expectOk(s, 0, { type: 'BUILD_SETTLEMENT', vertex: C });
    expect(state.buildings[C]).toEqual({ owner: 0, kind: 'settlement' });
    expect(state.players[0]!.settlementsLeft).toBe(3);
    expect(state.bank.wool).toBe(s.bank.wool + 1);
    const other = structuredClone(s);
    putRoad(other, 1, edgeBetween(g, C, D));
    expectRejected(other, 1, { type: 'BUILD_SETTLEMENT', vertex: C }, 'NOT_YOUR_TURN');
    const none = structuredClone(s);
    none.players[0]!.settlementsLeft = 0;
    expectRejected(none, 0, { type: 'BUILD_SETTLEMENT', vertex: C }, 'NO_PIECES_LEFT');
    const poor = setHand(structuredClone(s), 0, { brick: 1, lumber: 1, wool: 1 });
    expectRejected(poor, 0, { type: 'BUILD_SETTLEMENT', vertex: C }, 'INSUFFICIENT_RESOURCES');
  });

  it('BUILD_CITY upgrades an own settlement and returns the settlement piece', () => {
    const s = give(mainState(), 0, { grain: 2, ore: 3 });
    putBuilding(s, 1, D);
    expectRejected(s, 0, { type: 'BUILD_CITY', vertex: D }, 'ILLEGAL_LOCATION');
    expectRejected(s, 0, { type: 'BUILD_CITY', vertex: B }, 'ILLEGAL_LOCATION');
    expect(getLegal(s, 0).cityVertices).toEqual([A]);
    const { state } = expectOk(s, 0, { type: 'BUILD_CITY', vertex: A });
    expect(state.buildings[A]!.kind).toBe('city');
    expect(state.players[0]).toMatchObject({ citiesLeft: 3, settlementsLeft: 5 });
    expectRejected(state, 0, { type: 'BUILD_CITY', vertex: A }, 'ILLEGAL_LOCATION');
    const none = structuredClone(s);
    none.players[0]!.citiesLeft = 0;
    expectRejected(none, 0, { type: 'BUILD_CITY', vertex: A }, 'NO_PIECES_LEFT');
  });

  it('BUY_DEV takes the top card into newDevCards', () => {
    const s = give(mainState(), 0, COSTS.devCard);
    const top = s.devDeck.at(-1)!;
    const { state, events } = expectOk(s, 0, { type: 'BUY_DEV' });
    expect(state.players[0]!.newDevCards).toEqual([top]);
    expect(state.devDeck).toHaveLength(s.devDeck.length - 1);
    expect(events).toContainEqual({ type: 'boughtDev', seat: 0, card: top });
    const empty = structuredClone(s);
    empty.devDeck = [];
    expectRejected(empty, 0, { type: 'BUY_DEV' }, 'DECK_EMPTY');
    expectRejected(mainState(), 0, { type: 'BUY_DEV' }, 'INSUFFICIENT_RESOURCES');
  });

  it('building a settlement on an opponent road can break their longest road', () => {
    const s = inPhase(newGame(4), { kind: 'main' });
    const path = walk(g, '0,0,N', 6);
    putPath(s, 1, path);
    s.players[1]!.longestRoadLength = 6;
    s.longestRoad = 1;
    // Seat 0 reaches path[3] with its own road from a side vertex.
    const side = g.vertexNeighbors[path[3]!]!.find((v) => !path.includes(v))!;
    const sideFar = g.vertexNeighbors[side]!.find((v) => v !== path[3])!;
    putBuilding(s, 0, sideFar);
    putPath(s, 0, [sideFar, side, path[3]!]);
    give(s, 0, COSTS.settlement);
    const { state, events } = expectOk(s, 0, { type: 'BUILD_SETTLEMENT', vertex: path[3]! });
    expect(state.players[1]!.longestRoadLength).toBe(3);
    expect(state.longestRoad).toBeNull();
    expect(events).toContainEqual({ type: 'awardChanged', award: 'longestRoad', holder: null });
  });

  it('special build phase: only phase.seat may build, paying as usual', () => {
    const s = inPhase(newGame(5), { kind: 'specialBuild', seat: 2, queue: [3] }, 0);
    const g5 = graphFor(s.board);
    const [x, y, z] = walk(g5, '0,0,N', 2);
    putBuilding(s, 2, x!);
    putPath(s, 2, [x!, y!]);
    give(s, 2, { brick: 1, lumber: 1 });
    give(s, 0, { brick: 1, lumber: 1 });
    const e = edgeBetween(g5, y!, z!);
    expectRejected(s, 0, { type: 'BUILD_ROAD', edge: e }, 'NOT_YOUR_TURN');
    const { state } = expectOk(s, 2, { type: 'BUILD_ROAD', edge: e });
    expect(state.roads[e]).toBe(2);
    expect(state.phase).toEqual(s.phase);
  });
});
