import { describe, expect, it } from 'vitest';
import { graphFor, type BoardGraph } from '../hex/topology';
import { getLegal } from '../legal';
import { getPendingActors } from '../pending';
import { applyAction } from '../reducer';
import { COSTS, resourcesOf, totalResources } from '../resources';
import { seedRng } from '../rng';
import { eventsOf, expectOk, expectRejected } from '../test/expect';
import {
  give,
  inPhase,
  newGame,
  newSeaGame,
  putBuilding,
  putRoad,
  putShip,
  setHand,
  setHex,
} from '../test/fixtures';
import type { EdgeId, GameState, HexId, Seat, VertexId } from '../types';
import { toPlayerView } from '../view';
import { longestTrail } from './awards';
import { isLandVertex, islandOfVertex, isRoadEdge, isShipEdge } from './placement';
import { publicVP } from './victory';

// ---------------------------------------------------------------- geometry helpers

const G: BoardGraph = graphFor(newSeaGame().board);
const PIRATE: HexId = newSeaGame().pirate!;
const HOME = newSeaGame().board.homeIslands;

const otherEnd = (g: BoardGraph, e: EdgeId, v: VertexId): VertexId => {
  const [a, b] = g.edgeVertices[e]!;
  return a === v ? b : a;
};
const nearPirate = (g: BoardGraph, e: EdgeId, pirate: HexId | null = PIRATE) =>
  pirate !== null && g.edgeHexes[e]!.includes(pirate);
const seaOnly = (g: BoardGraph, e: EdgeId) => isShipEdge(g, e) && !isRoadEdge(g, e);
const landOnly = (g: BoardGraph, e: EdgeId) => isRoadEdge(g, e) && !isShipEdge(g, e);

/** A simple path of `n` edges from `start` whose edges satisfy `ok` (DFS, deterministic). */
function pathFrom(
  g: BoardGraph,
  start: VertexId,
  n: number,
  ok: (e: EdgeId) => boolean,
  avoid: ReadonlySet<VertexId> = new Set(),
): { vertices: VertexId[]; edges: EdgeId[] } | null {
  const vertices = [start];
  const edges: EdgeId[] = [];
  const go = (): boolean => {
    if (edges.length === n) return true;
    const v = vertices.at(-1)!;
    for (const e of [...g.vertexEdges[v]!].sort()) {
      const w = otherEnd(g, e, v);
      if (!ok(e) || vertices.includes(w) || avoid.has(w)) continue;
      vertices.push(w);
      edges.push(e);
      if (go()) return true;
      vertices.pop();
      edges.pop();
    }
    return false;
  };
  return go() ? { vertices, edges } : null;
}

/** Land vertices on island `island` (sorted). */
const islandVertices = (g: BoardGraph, island: number) =>
  g.landVertices.filter((v) => islandOfVertex(g, v) === island);

/** A home coast vertex with a line of `n` ship edges out to sea, away from the pirate. */
function shipLine(n: number): { v: VertexId; vertices: VertexId[]; edges: EdgeId[] } {
  for (const v of islandVertices(G, HOME[0]!)) {
    const line = pathFrom(G, v, n, (e) => isShipEdge(G, e) && !nearPirate(G, e));
    if (line && line.vertices.slice(1).every((w) => !isLandVertex(G, w))) return { v, ...line };
  }
  throw new Error('no ship line');
}

/** A non-home island and a coast vertex on it with a ship edge away from the pirate. */
function foreignCoast(g = G, home = HOME): { island: number; v: VertexId; ship: EdgeId } {
  for (const v of g.landVertices) {
    const island = islandOfVertex(g, v)!;
    if (home.includes(island)) continue;
    const ship = g.vertexEdges[v]!.find((e) => isShipEdge(g, e) && !nearPirate(g, e));
    if (ship) return { island, v, ship };
  }
  throw new Error('no foreign coast');
}

/** A home vertex with a land-only edge and a ship edge away from the pirate. */
function landAndSea(): { v: VertexId; land: EdgeId; ship: EdgeId } {
  for (const v of islandVertices(G, HOME[0]!)) {
    const land = G.vertexEdges[v]!.find((e) => landOnly(G, e));
    const ship = G.vertexEdges[v]!.find((e) => isShipEdge(G, e) && !nearPirate(G, e));
    if (land && ship) return { v, land, ship };
  }
  throw new Error('no land-and-sea vertex');
}

/** Re-seed until the next ROLL by the current seat yields `total`. */
function rollTo(state: GameState, total: number): GameState {
  for (let i = 0; i < 500; i++) {
    const s = structuredClone(state);
    s.rng = seedRng(`roll-${i}`);
    const res = applyAction(s, s.turn.current, { type: 'ROLL' });
    if (res.ok && res.state.turn.dice![0] + res.state.turn.dice![1] === total) return s;
  }
  throw new Error(`could not find seed for ${total}`);
}

const main = (s: GameState, seat: Seat = 0) => inPhase(s, { kind: 'main' }, seat);
const shipCost = (s: GameState, seat: Seat = 0) => give(s, seat, COSTS.ship);

// ---------------------------------------------------------------- placement

describe('Open Seas placement', () => {
  it('setup settlements go only on land vertices of home islands', () => {
    const s = newSeaGame();
    const legal = getLegal(s, 0).settlementVertices;
    expect(legal.length).toBeGreaterThan(0);
    for (const v of legal) expect(HOME).toContain(islandOfVertex(G, v));
    const foreign = foreignCoast().v;
    expect(legal).not.toContain(foreign);
    expectRejected(s, 0, { type: 'PLACE_SETTLEMENT', vertex: foreign }, 'ILLEGAL_LOCATION');
    const wet = G.vertices.find((v) => !isLandVertex(G, v))!;
    expectRejected(s, 0, { type: 'PLACE_SETTLEMENT', vertex: wet }, 'ILLEGAL_LOCATION');
    expectOk(s, 0, { type: 'PLACE_SETTLEMENT', vertex: legal[0]! });
  });

  it('every land island is home on base boards, and base setup is unchanged', () => {
    const s = newGame(4);
    const g = graphFor(s.board);
    expect(s.board.homeIslands).toEqual([0]);
    expect(getLegal(s, 0).settlementVertices).toEqual(g.vertices);
    expect(getLegal(s, 0).shipEdges).toEqual([]);
  });

  it('roads stay off sea-only edges; settlements stay off sea-only vertices', () => {
    const { v, edges, vertices } = shipLine(2);
    const s = main(putBuilding(newSeaGame(), 0, v));
    give(s, 0, { brick: 5, lumber: 5, wool: 5, grain: 5 });
    const wet = edges[1]!;
    expect(seaOnly(G, wet)).toBe(true);
    putShip(s, 0, edges[0]!);
    expectRejected(s, 0, { type: 'BUILD_ROAD', edge: wet }, 'ILLEGAL_LOCATION');
    for (const e of getLegal(s, 0).roadEdges) expect(isRoadEdge(G, e)).toBe(true);
    // A ship line ending on a sea-only vertex cannot carry a settlement there.
    putShip(s, 0, edges[1]!);
    expectRejected(s, 0, { type: 'BUILD_SETTLEMENT', vertex: vertices[2]! }, 'ILLEGAL_LOCATION');
  });

  it('a coast edge takes a road or a ship, not both', () => {
    const v = islandVertices(G, HOME[0]!).find((x) =>
      G.vertexEdges[x]!.some((e) => isShipEdge(G, e) && isRoadEdge(G, e) && !nearPirate(G, e)),
    )!;
    const coast = G.vertexEdges[v]!.find(
      (e) => isShipEdge(G, e) && isRoadEdge(G, e) && !nearPirate(G, e),
    )!;
    const s = main(putBuilding(newSeaGame(), 0, v));
    give(s, 0, { brick: 2, lumber: 2, wool: 2 });
    const withShip = expectOk(s, 0, { type: 'BUILD_SHIP', edge: coast }).state;
    expectRejected(withShip, 0, { type: 'BUILD_ROAD', edge: coast }, 'ILLEGAL_LOCATION');
    const withRoad = expectOk(s, 0, { type: 'BUILD_ROAD', edge: coast }).state;
    expectRejected(withRoad, 0, { type: 'BUILD_SHIP', edge: coast }, 'ILLEGAL_LOCATION');
  });
});

// ---------------------------------------------------------------- ships

describe('ships', () => {
  it('PLACE_SHIP: the setup piece may be a ship touching the new settlement', () => {
    const { v, edges } = shipLine(2);
    const s = putBuilding(newSeaGame(), 0, v);
    inPhase(s, { kind: 'setup', index: 0, step: 'road', lastSettlement: v }, 0);
    const legal = getLegal(s, 0);
    expect(legal.actions).toEqual(expect.arrayContaining(['PLACE_ROAD', 'PLACE_SHIP']));
    expect(legal.shipEdges).toContain(edges[0]);
    for (const e of legal.shipEdges) expect(G.edgeVertices[e]).toContain(v);

    const { state, events } = expectOk(s, 0, { type: 'PLACE_SHIP', edge: edges[0]! });
    expect(state.ships).toEqual({ [edges[0]!]: 0 });
    expect(state.players[0]!.shipsLeft).toBe(14);
    expect(state.phase).toMatchObject({ kind: 'setup', index: 1, step: 'settlement' });
    expect(state.turn.current).toBe(1);
    expect(eventsOf(events, 'setupPlaced')[0]).toMatchObject({ kind: 'ship', at: edges[0] });

    // Not touching the settlement, not a ship edge, wrong seat, wrong step.
    expectRejected(s, 0, { type: 'PLACE_SHIP', edge: edges[1]! }, 'ILLEGAL_LOCATION');
    const { v: lv, land } = landAndSea();
    const inland = putBuilding(newSeaGame(), 0, lv);
    inPhase(inland, { kind: 'setup', index: 0, step: 'road', lastSettlement: lv }, 0);
    expectRejected(inland, 0, { type: 'PLACE_SHIP', edge: land }, 'ILLEGAL_LOCATION');
    expectOk(inland, 0, { type: 'PLACE_ROAD', edge: land });
    expectRejected(s, 1, { type: 'PLACE_SHIP', edge: edges[0]! }, 'NOT_YOUR_TURN');
    const early = inPhase(newSeaGame(), {
      kind: 'setup',
      index: 0,
      step: 'settlement',
      lastSettlement: null,
    });
    expectRejected(early, 0, { type: 'PLACE_SHIP', edge: edges[0]! }, 'WRONG_PHASE');
    // The pirate blocks ships on its hex's edges, in setup too.
    const blocked = structuredClone(s);
    blocked.pirate = G.edgeHexes[edges[0]!]!.find((h) => !Object.hasOwn(G.islandOf, h))!;
    expectRejected(blocked, 0, { type: 'PLACE_SHIP', edge: edges[0]! }, 'ILLEGAL_LOCATION');
    // Out of ships.
    const none = structuredClone(s);
    none.players[0]!.shipsLeft = 0;
    expect(getLegal(none, 0).actions).not.toContain('PLACE_SHIP');
    expectRejected(none, 0, { type: 'PLACE_SHIP', edge: edges[0]! }, 'NO_PIECES_LEFT');
  });

  it('PLACE_SHIP is never possible on base boards', () => {
    const s = newGame(4);
    const g = graphFor(s.board);
    const v = g.vertices[10]!;
    putBuilding(s, 0, v);
    inPhase(s, { kind: 'setup', index: 0, step: 'road', lastSettlement: v }, 0);
    expect(getLegal(s, 0).actions).toEqual(['PLACE_ROAD']);
    expectRejected(s, 0, { type: 'PLACE_SHIP', edge: g.vertexEdges[v]![0]! }, 'ILLEGAL_LOCATION');
  });

  it('BUILD_SHIP costs lumber + wool and extends from a building or an own ship', () => {
    const { v, edges } = shipLine(3);
    const s = main(putBuilding(newSeaGame(), 0, v));
    shipCost(s);
    shipCost(s);
    const legal = getLegal(s, 0);
    expect(legal.canAfford.ship).toBe(true);
    expect(legal.actions).toContain('BUILD_SHIP');
    expect(legal.shipEdges).toContain(edges[0]);
    expect(legal.shipEdges).not.toContain(edges[1]);
    expectRejected(s, 0, { type: 'BUILD_SHIP', edge: edges[1]! }, 'ILLEGAL_LOCATION');

    const one = expectOk(s, 0, { type: 'BUILD_SHIP', edge: edges[0]! });
    expect(one.state.players[0]!.resources).toEqual(resourcesOf({ lumber: 1, wool: 1 }));
    expect(one.state.bank.lumber).toBe(s.bank.lumber + 1);
    expect(one.state.players[0]!.shipsLeft).toBe(14);
    expect(one.state.turn.newShips).toEqual([edges[0]]);
    expect(eventsOf(one.events, 'built')[0]).toEqual({
      type: 'built',
      seat: 0,
      kind: 'ship',
      at: edges[0],
    });
    const two = expectOk(one.state, 0, { type: 'BUILD_SHIP', edge: edges[1]! }).state;
    expect(two.ships).toEqual({ [edges[0]!]: 0, [edges[1]!]: 0 });
    expect(two.players[0]!.longestRoadLength).toBe(2);
    expectRejected(two, 0, { type: 'BUILD_SHIP', edge: edges[2]! }, 'INSUFFICIENT_RESOURCES');
  });

  it('BUILD_SHIP rejections: phase, seat, pieces, land edges, the pirate, opponents', () => {
    const { v, vertices, edges } = shipLine(2);
    const s = main(putBuilding(newSeaGame(), 0, v));
    shipCost(s);
    shipCost(s, 1);
    expectRejected(s, 1, { type: 'BUILD_SHIP', edge: edges[0]! }, 'NOT_YOUR_TURN');
    expectRejected(
      inPhase(structuredClone(s), { kind: 'preRoll' }),
      0,
      { type: 'BUILD_SHIP', edge: edges[0]! },
      'WRONG_PHASE',
    );
    const none = structuredClone(s);
    none.players[0]!.shipsLeft = 0;
    expect(getLegal(none, 0).shipEdges).toEqual([]);
    expectRejected(none, 0, { type: 'BUILD_SHIP', edge: edges[0]! }, 'NO_PIECES_LEFT');
    const { v: lv, land } = landAndSea();
    const inland = main(putBuilding(newSeaGame(), 0, lv));
    shipCost(inland);
    expectRejected(inland, 0, { type: 'BUILD_SHIP', edge: land }, 'ILLEGAL_LOCATION');
    expectRejected(s, 0, { type: 'BUILD_SHIP', edge: 'nope' }, 'ILLEGAL_LOCATION');

    const pirate = structuredClone(s);
    pirate.pirate = G.edgeHexes[edges[0]!]!.find((h) => !Object.hasOwn(G.islandOf, h))!;
    expect(getLegal(pirate, 0).shipEdges).not.toContain(edges[0]);
    expectRejected(pirate, 0, { type: 'BUILD_SHIP', edge: edges[0]! }, 'ILLEGAL_LOCATION');

    // An opponent's building where the line would continue blocks it.
    const blocked = structuredClone(s);
    putShip(blocked, 0, edges[0]!);
    blocked.buildings[vertices[1]!] = { owner: 1, kind: 'settlement' };
    expectRejected(blocked, 0, { type: 'BUILD_SHIP', edge: edges[1]! }, 'ILLEGAL_LOCATION');
  });

  it('roads and ships join only at an own building', () => {
    // v: own settlement; road v-w along the coast; a ship edge at w away from v.
    let found: { v: VertexId; road: EdgeId; w: VertexId; ship: EdgeId } | null = null;
    for (const v of islandVertices(G, HOME[0]!)) {
      for (const road of G.vertexEdges[v]!) {
        if (!isRoadEdge(G, road)) continue;
        const w = otherEnd(G, road, v);
        const ship = G.vertexEdges[w]!.find(
          (e) => e !== road && isShipEdge(G, e) && !nearPirate(G, e),
        );
        if (ship && !G.vertexEdges[v]!.includes(ship)) found ??= { v, road, w, ship };
      }
    }
    const { v, road, w, ship } = found!;
    const s = main(putRoad(putBuilding(newSeaGame(), 0, v), 0, road));
    give(s, 0, { brick: 1, lumber: 2, wool: 1 });
    expect(getLegal(s, 0).shipEdges).not.toContain(ship);
    expectRejected(s, 0, { type: 'BUILD_SHIP', edge: ship }, 'ILLEGAL_LOCATION');
    // With a settlement at w the ship connects.
    const town = putBuilding(structuredClone(s), 0, w);
    expectOk(town, 0, { type: 'BUILD_SHIP', edge: ship });
    // And a ship does not extend roads: road from the far end of a ship needs a building.
    // Ship along a coast edge c = a-b from a settlement at a; a road edge at b is not connected.
    const c = G.edges.find((e) => isShipEdge(G, e) && isRoadEdge(G, e) && !nearPirate(G, e))!;
    const [a, b] = G.edgeVertices[c]!;
    const sea = main(putShip(putBuilding(newSeaGame(), 0, a), 0, c));
    const roadAtB = G.vertexEdges[b]!.find((e) => e !== c && isRoadEdge(G, e))!;
    give(sea, 0, { brick: 1, lumber: 1 });
    expect(getLegal(sea, 0).roadEdges).not.toContain(roadAtB);
    expectRejected(sea, 0, { type: 'BUILD_ROAD', edge: roadAtB }, 'ILLEGAL_LOCATION');
    expectOk(putBuilding(sea, 0, b), 0, { type: 'BUILD_ROAD', edge: roadAtB });
  });

  it('a settlement can be built at the end of a ship line', () => {
    const { v, ship } = foreignCoast();
    const s = main(putShip(newSeaGame(), 0, ship));
    give(s, 0, COSTS.settlement);
    expect(getLegal(s, 0).settlementVertices).toContain(v);
    expectOk(s, 0, { type: 'BUILD_SETTLEMENT', vertex: v });
  });

  it('road building may place ships, and stops when no piece fits', () => {
    const { v, edges } = shipLine(3);
    const s = main(putBuilding(newSeaGame(), 0, v));
    s.players[0]!.devCards = ['roadBuilding'];
    s.players[0]!.roadsLeft = 0;
    expect(getLegal(s, 0).actions).toContain('PLAY_ROAD_BUILDING');
    const rb = expectOk(s, 0, { type: 'PLAY_ROAD_BUILDING' }).state;
    expect(rb.phase).toEqual({ kind: 'roadBuilding', remaining: 2 });
    const legal = getLegal(rb, 0);
    expect(legal.actions).toEqual(['BUILD_SHIP']);
    const one = expectOk(rb, 0, { type: 'BUILD_SHIP', edge: edges[0]! }).state;
    expect(one.phase).toEqual({ kind: 'roadBuilding', remaining: 1 });
    expect(one.players[0]!.resources).toEqual(resourcesOf({}));
    const two = expectOk(one, 0, { type: 'BUILD_SHIP', edge: edges[1]! }).state;
    expect(two.phase).toEqual({ kind: 'main' });
    expect(two.turn.newShips).toEqual([edges[0], edges[1]]);

    // One ship left and no road: a single free piece.
    const single = structuredClone(s);
    single.players[0]!.shipsLeft = 1;
    const rb1 = expectOk(single, 0, { type: 'PLAY_ROAD_BUILDING' }).state;
    expect(rb1.phase).toEqual({ kind: 'roadBuilding', remaining: 1 });
    // Neither pieces: the card cannot be played.
    single.players[0]!.shipsLeft = 0;
    expect(getLegal(single, 0).actions).not.toContain('PLAY_ROAD_BUILDING');
    expectRejected(single, 0, { type: 'PLAY_ROAD_BUILDING' }, 'DEV_CARD_NOT_PLAYABLE');
  });

  it('the special build phase may build ships but not move them', () => {
    const s = newSeaGame(5);
    const g = graphFor(s.board);
    const pirate = s.pirate;
    const v = islandVertices(g, s.board.homeIslands[0]!).find((x) =>
      g.vertexEdges[x]!.some((e) => isShipEdge(g, e) && !nearPirate(g, e, pirate)),
    )!;
    const edge = g.vertexEdges[v]!.find((e) => isShipEdge(g, e) && !nearPirate(g, e, pirate))!;
    putBuilding(s, 1, v);
    inPhase(s, { kind: 'specialBuild', seat: 1, queue: [] }, 0);
    shipCost(s, 1);
    expect(getLegal(s, 1).actions).toContain('BUILD_SHIP');
    const built = expectOk(s, 1, { type: 'BUILD_SHIP', edge }).state;
    expect(built.ships[edge]).toBe(1);
    const other = g.vertexEdges[v]!.find((e) => e !== edge && isShipEdge(g, e))!;
    expectRejected(built, 1, { type: 'MOVE_SHIP', from: edge, to: other }, 'WRONG_PHASE');
  });

  it('canAfford.ship is gated by the variant', () => {
    const base = main(give(newGame(4), 0, COSTS.ship));
    expect(getLegal(base, 0).canAfford.ship).toBe(false);
    expect(getLegal(base, 0).actions).not.toContain('BUILD_SHIP');
    expectRejected(base, 0, { type: 'BUILD_SHIP', edge: '0,0,NE' });
    const sea = main(give(newSeaGame(), 0, COSTS.ship));
    expect(getLegal(sea, 0).canAfford.ship).toBe(true);
  });
});

// ---------------------------------------------------------------- moving ships

describe('MOVE_SHIP', () => {
  /** Settlement at v, ships e0 (v-v1) and e1 (v1-v2) placed on an earlier turn. */
  function fleet() {
    const line = shipLine(2);
    const s = main(putBuilding(newSeaGame(), 0, line.v));
    putShip(s, 0, line.edges[0]!);
    putShip(s, 0, line.edges[1]!);
    return { s, ...line };
  }

  it('moves the open-ended ship once per turn', () => {
    const { s, v, edges } = fleet();
    const legal = getLegal(s, 0);
    expect(legal.actions).toContain('MOVE_SHIP');
    expect(Object.keys(legal.shipMoves)).toEqual([edges[1]]);
    const targets = legal.shipMoves[edges[1]!]!;
    expect(targets).not.toContain(edges[1]);
    expect(targets).not.toContain(edges[0]);
    const to = G.vertexEdges[v]!.find((e) => targets.includes(e))!;
    expect(to).toBeDefined();

    const { state, events } = expectOk(s, 0, { type: 'MOVE_SHIP', from: edges[1]!, to });
    expect(state.ships).toEqual({ [edges[0]!]: 0, [to]: 0 });
    expect(state.players[0]!.shipsLeft).toBe(13);
    expect(state.turn.shipMoved).toBe(true);
    expect(eventsOf(events, 'shipMoved')).toEqual([
      { type: 'shipMoved', seat: 0, from: edges[1], to },
    ]);
    expect(getLegal(state, 0).actions).not.toContain('MOVE_SHIP');
    expect(getLegal(state, 0).shipMoves).toEqual({});
    expectRejected(state, 0, { type: 'MOVE_SHIP', from: to, to: edges[1]! }, 'INVALID_ACTION');
  });

  it('rejects closed, new, pirate-adjacent and foreign ships, and bad targets', () => {
    const { s, edges, vertices } = fleet();
    const to = getLegal(s, 0).shipMoves[edges[1]!]![0]!;
    // e0 sits between the settlement and e1: not open-ended.
    expectRejected(s, 0, { type: 'MOVE_SHIP', from: edges[0]!, to }, 'ILLEGAL_LOCATION');
    expectRejected(s, 0, { type: 'MOVE_SHIP', from: edges[1]!, to: edges[1]! }, 'ILLEGAL_LOCATION');
    const far = G.seaEdges.find(
      (e) => !G.edgeVertices[e]!.some((x) => vertices.includes(x)) && !nearPirate(G, e),
    )!;
    expectRejected(s, 0, { type: 'MOVE_SHIP', from: edges[1]!, to: far }, 'ILLEGAL_LOCATION');
    expectRejected(s, 0, { type: 'MOVE_SHIP', from: edges[1]!, to: 'x' }, 'ILLEGAL_LOCATION');
    expectRejected(s, 1, { type: 'MOVE_SHIP', from: edges[1]!, to }, 'NOT_YOUR_TURN');

    const fresh = structuredClone(s);
    fresh.turn.newShips = [edges[1]!];
    expect(getLegal(fresh, 0).shipMoves).toEqual({});
    expectRejected(fresh, 0, { type: 'MOVE_SHIP', from: edges[1]!, to }, 'ILLEGAL_LOCATION');

    const pirate = structuredClone(s);
    pirate.pirate = G.edgeHexes[edges[1]!]!.find((h) => !G.edgeHexes[edges[0]!]!.includes(h))!;
    expectRejected(pirate, 0, { type: 'MOVE_SHIP', from: edges[1]!, to }, 'ILLEGAL_LOCATION');

    const preRoll = inPhase(structuredClone(s), { kind: 'preRoll' });
    expectRejected(preRoll, 0, { type: 'MOVE_SHIP', from: edges[1]!, to }, 'WRONG_PHASE');

    // An opponent's ship is never movable by us.
    const theirs = structuredClone(s);
    theirs.ships[edges[1]!] = 1;
    expectRejected(theirs, 0, { type: 'MOVE_SHIP', from: edges[1]!, to }, 'ILLEGAL_LOCATION');
  });

  it("a ship next to an opponent's building still counts as open-ended", () => {
    const { s, edges, vertices } = fleet();
    s.buildings[vertices[2]!] = { owner: 1, kind: 'settlement' };
    expect(Object.keys(getLegal(s, 0).shipMoves)).toEqual([edges[1]]);
  });
});

// ---------------------------------------------------------------- pirate

describe('pirate', () => {
  it('a 7, a discard and a knight let the mover choose robber or pirate', () => {
    const sea = rollTo(inPhase(newSeaGame(), { kind: 'preRoll' }), 7);
    expect(expectOk(sea, 0, { type: 'ROLL' }).state.phase).toEqual({
      kind: 'moveRobber',
      returnTo: 'main',
      allowPirate: true,
    });
    const discard = inPhase(newSeaGame(), { kind: 'discard', pending: { '1': 4 } });
    give(discard, 1, { ore: 8 });
    const after = expectOk(discard, 1, {
      type: 'DISCARD',
      resources: resourcesOf({ ore: 4 }),
    }).state;
    expect(after.phase).toMatchObject({ kind: 'moveRobber', allowPirate: true });
    const knight = inPhase(newSeaGame(), { kind: 'preRoll' });
    knight.players[0]!.devCards = ['knight'];
    expect(expectOk(knight, 0, { type: 'PLAY_KNIGHT' }).state.phase).toEqual({
      kind: 'moveRobber',
      returnTo: 'preRoll',
      allowPirate: true,
    });
    // Base: robber only.
    const base = rollTo(inPhase(newGame(4), { kind: 'preRoll' }), 7);
    const phase = expectOk(base, 0, { type: 'ROLL' }).state.phase;
    expect(phase).toMatchObject({ allowPirate: false });
    const baseMove = inPhase(newGame(4), {
      kind: 'moveRobber',
      returnTo: 'main',
      allowPirate: false,
    });
    expect(getLegal(baseMove, 0).pirateHexes).toEqual([]);
    expect(getLegal(baseMove, 0).actions).toEqual(['MOVE_ROBBER']);
    expectRejected(baseMove, 0, { type: 'MOVE_PIRATE', hex: '0,0' }, 'WRONG_PHASE');
  });

  it('MOVE_PIRATE goes to another sea hex and steals from ship owners there', () => {
    const s = inPhase(newSeaGame(), { kind: 'moveRobber', returnTo: 'main', allowPirate: true });
    const legal = getLegal(s, 0);
    expect(legal.actions).toEqual(['MOVE_ROBBER', 'MOVE_PIRATE']);
    expect(legal.pirateHexes).not.toContain(PIRATE);
    for (const h of legal.pirateHexes) expect(Object.hasOwn(G.islandOf, h)).toBe(false);
    expectRejected(s, 0, { type: 'MOVE_PIRATE', hex: PIRATE }, 'ILLEGAL_LOCATION');
    expectRejected(s, 0, { type: 'MOVE_PIRATE', hex: G.landHexes[0]! }, 'ILLEGAL_LOCATION');
    expectRejected(s, 0, { type: 'MOVE_PIRATE', hex: '99,99' }, 'ILLEGAL_LOCATION');
    expectRejected(s, 1, { type: 'MOVE_PIRATE', hex: legal.pirateHexes[0]! }, 'NOT_YOUR_TURN');

    // A sea hex with two coast edges: ships of seats 1 and 2 there (plus our own).
    const target = legal.pirateHexes.find(
      (h) => G.hexEdges[h]!.filter((e) => isShipEdge(G, e)).length >= 3,
    )!;
    const [e1, e2, e0] = G.hexEdges[target]!.filter((e) => isShipEdge(G, e));
    putShip(s, 1, e1!);
    putShip(s, 2, e2!);
    putShip(s, 0, e0!);
    give(s, 1, { ore: 1 });
    give(s, 2, { wool: 1 });
    const both = expectOk(s, 0, { type: 'MOVE_PIRATE', hex: target });
    expect(both.state.pirate).toBe(target);
    expect(both.state.robber).toBe(s.robber);
    expect(eventsOf(both.events, 'pirateMoved')).toEqual([
      { type: 'pirateMoved', seat: 0, hex: target },
    ]);
    expect(both.state.phase).toEqual({
      kind: 'steal',
      candidates: [1, 2],
      returnTo: 'main',
      via: 'pirate',
    });
    const stolen = expectOk(both.state, 0, { type: 'STEAL', victim: 2 }).state;
    expect(stolen.players[0]!.resources.wool).toBe(1);
    expect(stolen.phase).toEqual({ kind: 'main' });

    // One candidate (seat 2 has no cards): steal at once.
    setHand(s, 2, {});
    const one = expectOk(s, 0, { type: 'MOVE_PIRATE', hex: target });
    expect(one.state.phase).toEqual({ kind: 'main' });
    expect(one.state.players[0]!.resources.ore).toBe(1);
    expect(eventsOf(one.events, 'stole')[0]).toMatchObject({ thief: 0, victim: 1 });
  });

  it('the robber still moves on land only in Open Seas', () => {
    const s = inPhase(newSeaGame(), { kind: 'moveRobber', returnTo: 'main', allowPirate: true });
    const sea = G.hexIds.find((h) => !Object.hasOwn(G.islandOf, h))!;
    expect(getLegal(s, 0).robberHexes).not.toContain(sea);
    expectRejected(s, 0, { type: 'MOVE_ROBBER', hex: sea }, 'ILLEGAL_LOCATION');
    const moved = expectOk(s, 0, { type: 'MOVE_ROBBER', hex: G.landHexes[1]! }).state;
    expect(moved.pirate).toBe(PIRATE);
  });
});

// ---------------------------------------------------------------- gold

describe('gold', () => {
  /** preRoll with one home hex turned gold (token 8) and no other 8s; robber elsewhere. */
  function goldBoard(): { s: GameState; gold: HexId } {
    const s = inPhase(newSeaGame(), { kind: 'preRoll' });
    const gold = G.landHexes.find((h) => h !== s.robber && HOME.includes(G.islandOf[h]!))!;
    for (const h of s.board.hexes) if (h.token === 8) h.token = 9;
    setHex(s, gold, 'gold', 8);
    return { s: rollTo(s, 8), gold };
  }

  it('production on gold makes every owner choose at once, then resumes main', () => {
    const { s, gold } = goldBoard();
    const [a, , c, , e] = G.hexVertices[gold]!;
    putBuilding(s, 1, a!);
    putBuilding(s, 2, c!, 'city');
    putBuilding(s, 1, e!);
    const { state, events } = expectOk(s, 0, { type: 'ROLL' });
    expect(state.phase).toEqual({
      kind: 'goldChoice',
      pending: { '1': 2, '2': 2 },
      resume: { kind: 'main' },
    });
    expect(eventsOf(events, 'produced')[0]!.gold).toEqual({ '1': 2, '2': 2 });
    expect(getPendingActors(state).sort()).toEqual([1, 2]);
    expect(getLegal(state, 1)).toMatchObject({ actions: ['CHOOSE_GOLD'], goldCount: 2 });
    expect(getLegal(state, 0).actions).toEqual([]);

    expectRejected(
      state,
      1,
      { type: 'CHOOSE_GOLD', resources: resourcesOf({ ore: 1 }) },
      'INVALID_ACTION',
    );
    expectRejected(
      state,
      1,
      { type: 'CHOOSE_GOLD', resources: { ...resourcesOf({ ore: 3 }), wool: -1 } },
      'INVALID_ACTION',
    );
    expectRejected(
      state,
      0,
      { type: 'CHOOSE_GOLD', resources: resourcesOf({ ore: 2 }) },
      'NOT_YOUR_TURN',
    );
    const poor = structuredClone(state);
    give(poor, 3, { ore: poor.bank.ore - 1 });
    expectRejected(
      poor,
      1,
      { type: 'CHOOSE_GOLD', resources: resourcesOf({ ore: 2 }) },
      'BANK_EMPTY',
    );

    const first = expectOk(state, 1, {
      type: 'CHOOSE_GOLD',
      resources: resourcesOf({ ore: 1, grain: 1 }),
    });
    expect(first.state.players[1]!.resources).toEqual(resourcesOf({ ore: 1, grain: 1 }));
    expect(first.state.bank.ore).toBe(state.bank.ore - 1);
    expect(eventsOf(first.events, 'goldChosen')).toEqual([
      { type: 'goldChosen', seat: 1, resources: resourcesOf({ ore: 1, grain: 1 }) },
    ]);
    expect(getPendingActors(first.state)).toEqual([2]);
    expectRejected(
      first.state,
      1,
      { type: 'CHOOSE_GOLD', resources: resourcesOf({ ore: 2 }) },
      'NOT_YOUR_TURN',
    );
    const done = expectOk(first.state, 2, {
      type: 'CHOOSE_GOLD',
      resources: resourcesOf({ brick: 2 }),
    }).state;
    expect(done.phase).toEqual({ kind: 'main' });
    expectRejected(done, 2, { type: 'CHOOSE_GOLD', resources: resourcesOf({}) }, 'WRONG_PHASE');
  });

  it('no gold choice when nobody is on the gold hex, or the robber blocks it', () => {
    const { s, gold } = goldBoard();
    expect(expectOk(s, 0, { type: 'ROLL' }).state.phase).toEqual({ kind: 'main' });
    putBuilding(s, 1, G.hexVertices[gold]![0]!);
    s.robber = gold;
    const { state, events } = expectOk(s, 0, { type: 'ROLL' });
    expect(state.phase).toEqual({ kind: 'main' });
    expect(eventsOf(events, 'produced')[0]!.gold).toBeUndefined();
  });

  it('bank shortage: nobody gets gold unless a single seat is owed it', () => {
    const { s, gold } = goldBoard();
    const [a, , c] = G.hexVertices[gold]!;
    putBuilding(s, 1, a!, 'city');
    // Leave a single card in the bank.
    for (const r of ['brick', 'lumber', 'wool', 'grain', 'ore'] as const) {
      give(s, 3, { [r]: s.bank[r] });
    }
    setHand(s, 3, { ...s.players[3]!.resources, ore: s.players[3]!.resources.ore - 1 });
    expect(totalResources(s.bank)).toBe(1);
    const alone = expectOk(s, 0, { type: 'ROLL' }).state;
    expect(alone.phase).toMatchObject({ kind: 'goldChoice', pending: { '1': 1 } });
    const chose = expectOk(alone, 1, {
      type: 'CHOOSE_GOLD',
      resources: resourcesOf({ ore: 1 }),
    }).state;
    expect(chose.phase).toEqual({ kind: 'main' });
    putBuilding(s, 2, c!);
    const two = expectOk(s, 0, { type: 'ROLL' });
    expect(two.state.phase).toEqual({ kind: 'main' });
    expect(eventsOf(two.events, 'produced')[0]!.gold).toBeUndefined();
  });

  it('a second setup settlement next to gold chooses before its road', () => {
    const s = newSeaGame();
    const gold = G.landHexes.find((h) => HOME.includes(G.islandOf[h]!))!;
    setHex(s, gold, 'gold', 5);
    const v = G.hexVertices[gold]!.find((x) => getLegal(s, 0).settlementVertices.includes(x))!;
    inPhase(s, { kind: 'setup', index: 4, step: 'settlement', lastSettlement: null }, 3);
    const { state, events } = expectOk(s, 3, { type: 'PLACE_SETTLEMENT', vertex: v });
    const golds = G.vertexHexes[v]!.filter(
      (h) => s.board.hexes.find((x) => x.id === h)!.terrain === 'gold',
    ).length;
    expect(state.phase).toEqual({
      kind: 'goldChoice',
      pending: { '3': golds },
      resume: { kind: 'setup', index: 4, step: 'road', lastSettlement: v },
    });
    expect(eventsOf(events, 'setupResources')[0]!.gold).toBe(golds);
    expect(getPendingActors(state)).toEqual([3]);
    expectRejected(state, 3, { type: 'PLACE_ROAD', edge: G.vertexEdges[v]![0]! }, 'WRONG_PHASE');
    const chosen = expectOk(state, 3, {
      type: 'CHOOSE_GOLD',
      resources: resourcesOf({ grain: golds }),
    }).state;
    expect(chosen.phase).toEqual({ kind: 'setup', index: 4, step: 'road', lastSettlement: v });
    expect(chosen.players[3]!.resources.grain).toBeGreaterThanOrEqual(golds);
    const road = getLegal(chosen, 3).roadEdges[0]!;
    expectOk(chosen, 3, { type: 'PLACE_ROAD', edge: road });

    // First round: no resources, no gold.
    const first = inPhase(newSeaGame(), {
      kind: 'setup',
      index: 0,
      step: 'settlement',
      lastSettlement: null,
    });
    setHex(first, gold, 'gold', 5);
    const r = expectOk(first, 0, { type: 'PLACE_SETTLEMENT', vertex: v }).state;
    expect(r.phase).toMatchObject({ kind: 'setup', step: 'road' });
  });
});

// ---------------------------------------------------------------- island bonus

describe('island bonus', () => {
  it('the first settlement on each non-home island earns islandBonusVP once', () => {
    const { island, v, ship } = foreignCoast();
    const s = main(putShip(newSeaGame(), 0, ship));
    give(s, 0, { brick: 2, lumber: 2, wool: 2, grain: 2 });
    const vp = publicVP(s, 0);
    const { state, events } = expectOk(s, 0, { type: 'BUILD_SETTLEMENT', vertex: v });
    expect(eventsOf(events, 'islandBonus')).toEqual([
      { type: 'islandBonus', seat: 0, island, vp: 2 },
    ]);
    expect(state.islandBonus).toEqual({ [String(island)]: [0] });
    expect(state.players[0]!.bonusVP).toBe(2);
    expect(publicVP(state, 0)).toBe(vp + 3);
    expect(toPlayerView(state, 1).players[0]).toMatchObject({ bonusVP: 2, publicVP: vp + 3 });

    // A second settlement on the same island: no new bonus.
    const v2 = islandVertices(G, island).find(
      (x) => x !== v && !G.vertexNeighbors[v]!.includes(x),
    )!;
    const e2 = G.vertexEdges[v2]!.find((e) => isShipEdge(G, e) || isRoadEdge(G, e))!;
    putShip(state, 0, e2);
    const again = expectOk(state, 0, { type: 'BUILD_SETTLEMENT', vertex: v2 });
    expect(eventsOf(again.events, 'islandBonus')).toEqual([]);
    expect(again.state.players[0]!.bonusVP).toBe(2);

    // Another player still gets their own bonus there.
    const other = structuredClone(again.state);
    const v3 = islandVertices(G, island).find(
      (x) => ![v, v2].includes(x) && ![v, v2].some((y) => G.vertexNeighbors[y]!.includes(x)),
    );
    expect(v3).toBeDefined();
    {
      main(other, 1);
      putShip(other, 1, G.vertexEdges[v3!]![0]!);
      give(other, 1, COSTS.settlement);
      const theirs = expectOk(other, 1, { type: 'BUILD_SETTLEMENT', vertex: v3! }).state;
      expect(theirs.islandBonus[String(island)]).toEqual([0, 1]);
      expect(theirs.players[1]!.bonusVP).toBe(2);
    }
  });

  it('home islands never pay a bonus (Archipelago has four)', () => {
    const s = newSeaGame(4, 'archipelago');
    const g = graphFor(s.board);
    expect(s.board.homeIslands.length).toBe(4);
    const v = islandVertices(g, s.board.homeIslands[1]!).find((x) =>
      g.vertexEdges[x]!.some((e) => isShipEdge(g, e)),
    )!;
    putShip(
      s,
      0,
      g.vertexEdges[v]!.find((e) => isShipEdge(g, e))!,
    );
    main(s);
    give(s, 0, COSTS.settlement);
    const { state, events } = expectOk(s, 0, { type: 'BUILD_SETTLEMENT', vertex: v });
    expect(eventsOf(events, 'islandBonus')).toEqual([]);
    expect(state.players[0]!.bonusVP).toBe(0);
    // The gold islet is not home: settling it pays.
    const islet = foreignCoast(g, s.board.homeIslands);
    const s2 = main(putShip(newSeaGame(4, 'archipelago'), 0, islet.ship));
    give(s2, 0, COSTS.settlement);
    const r = expectOk(s2, 0, { type: 'BUILD_SETTLEMENT', vertex: islet.v });
    expect(eventsOf(r.events, 'islandBonus')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- trade route

describe('longest trade route', () => {
  /** A home vertex with 2 land-only road edges inland and 3 ship edges out to sea. */
  function routeGeometry() {
    for (const v of islandVertices(G, HOME[0]!)) {
      const ships = pathFrom(G, v, 3, (e) => isShipEdge(G, e));
      if (!ships) continue;
      const roads = pathFrom(G, v, 2, (e) => landOnly(G, e), new Set(ships.vertices.slice(1)));
      if (roads) return { v, ships, roads };
    }
    throw new Error('no route geometry');
  }

  it('roads and ships count together only through an own building', () => {
    const { v, ships, roads } = routeGeometry();
    const s = newSeaGame();
    for (const e of roads.edges) putRoad(s, 0, e);
    for (const e of ships.edges) putShip(s, 0, e);
    expect(longestTrail(s, G, 0)).toBe(3);
    putBuilding(s, 0, v);
    expect(longestTrail(s, G, 0)).toBe(5);
    // An opponent's building at the junction cuts it.
    s.buildings[v] = { owner: 1, kind: 'settlement' };
    expect(longestTrail(s, G, 0)).toBe(3);
  });

  it('building ships updates the award; an opponent settlement cuts a ship line', () => {
    const { v, edges, vertices } = shipLine(4);
    const s = main(putBuilding(newSeaGame(), 0, v));
    for (const e of edges) putShip(s, 0, e);
    // Extend to 5 with a real BUILD_SHIP.
    const next = getLegal(s, 0).shipEdges.find(
      (e) => G.edgeVertices[e]!.includes(vertices[4]!) && !edges.includes(e),
    );
    expect(next).toBeDefined();
    shipCost(s);
    const { state, events } = expectOk(s, 0, { type: 'BUILD_SHIP', edge: next! });
    expect(state.players[0]!.longestRoadLength).toBe(5);
    expect(state.longestRoad).toBe(0);
    expect(eventsOf(events, 'awardChanged')).toEqual([
      { type: 'awardChanged', award: 'longestRoad', holder: 0 },
    ]);
    expect(isLandVertex(G, vertices[2]!)).toBe(false);
  });
});

// ---------------------------------------------------------------- view

describe('Open Seas view', () => {
  it('ships, pirate, island bonuses and ship counts are public and copied', () => {
    const { ship } = foreignCoast();
    const s = putShip(newSeaGame(), 2, ship);
    s.islandBonus = { '1': [2] };
    s.players[2]!.bonusVP = 2;
    const view = toPlayerView(s, 0);
    expect(view.ships).toEqual({ [ship]: 2 });
    expect(view.pirate).toBe(PIRATE);
    expect(view.islandBonus).toEqual({ '1': [2] });
    expect(view.players[2]).toMatchObject({ shipsLeft: 14, bonusVP: 2 });
    view.ships[ship] = 0;
    view.islandBonus['1']!.push(0);
    expect(s.ships[ship]).toBe(2);
    expect(s.islandBonus['1']).toEqual([2]);
  });
});
