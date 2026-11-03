import { describe, expect, it } from 'vitest';
import {
  createGame,
  emptyResources,
  normalizeConfig,
  resourcesOf,
  toPlayerView,
  type LegalSummary,
  type Phase,
  type PlayerView,
} from '@hexhaven/engine';
import { goldLimits, goldReady } from './gold';
import { computeHighlights, movableShips, sanitizeMode, sanitizeShipFrom } from './highlights';
import { hasShips, modeHint, phasePrompt } from './prompt';

const names = ['Alice', 'Bruno', 'Chen'];
const name = (s: number) => names[s]!;
const sea = toPlayerView(
  createGame(normalizeConfig({ players: 3, variant: 'seafarers' }), 'seas'),
  0,
);
const classic = toPlayerView(createGame(normalizeConfig({ players: 3 }), 'seas'), 0);

const legal: LegalSummary = {
  ...sea.legal!,
  roadEdges: ['0,0,NE'],
  shipEdges: ['0,0,W', '1,0,W'],
  shipMoves: { '2,0,W': ['3,0,W', '3,0,NE'], '4,0,W': [] },
  robberHexes: ['0,0'],
  pirateHexes: ['3,0', '4,0'],
  canAfford: { road: true, settlement: false, city: false, devCard: false, ship: true },
};

function view(phase: Phase, actions: LegalSummary['actions'], base: PlayerView = sea) {
  return {
    ...base,
    phase,
    viewer: 0,
    turn: { ...base.turn, current: 0 },
    pendingActors: [0],
    legal: { ...legal, actions },
  } as PlayerView;
}

const setupRoad: Phase = { kind: 'setup', index: 0, step: 'road', lastSettlement: '0,0,N' };

describe('Open Seas highlights', () => {
  it('setup offers a road/ship choice and follows the chosen piece', () => {
    const v = view(setupRoad, ['PLACE_ROAD', 'PLACE_SHIP']);
    const road = computeHighlights(v, null);
    expect(road).toMatchObject({ edgeAction: 'PLACE_ROAD', edges: ['0,0,NE'] });
    expect(road.pieces).toEqual(['road', 'ship']);
    const ship = computeHighlights(v, null, { piece: 'ship' });
    expect(ship).toMatchObject({ edgeAction: 'PLACE_SHIP', edges: ['0,0,W', '1,0,W'] });
  });

  it('uses a ship when it is the only option and keeps classic setup unchanged', () => {
    const onlyShip = view(setupRoad, ['PLACE_ROAD', 'PLACE_SHIP']);
    onlyShip.legal!.roadEdges = [];
    expect(computeHighlights(onlyShip, null)).toMatchObject({
      edgeAction: 'PLACE_SHIP',
      pieces: ['ship'],
    });
    const c = view(setupRoad, ['PLACE_ROAD'], classic);
    c.legal!.shipEdges = [];
    expect(computeHighlights(c, null, { piece: 'ship' })).toMatchObject({
      edgeAction: 'PLACE_ROAD',
      pieces: ['road'],
    });
  });

  it('road building places free roads or ships', () => {
    const v = view({ kind: 'roadBuilding', remaining: 2 }, ['BUILD_ROAD', 'BUILD_SHIP']);
    expect(computeHighlights(v, null).edgeAction).toBe('BUILD_ROAD');
    expect(computeHighlights(v, null, { piece: 'ship' }).edgeAction).toBe('BUILD_SHIP');
  });

  it('build ship mode highlights the legal ship edges', () => {
    const v = view({ kind: 'main' }, ['BUILD_SHIP', 'MOVE_SHIP']);
    expect(computeHighlights(v, null).edges).toEqual([]);
    expect(computeHighlights(v, 'buildShip')).toMatchObject({
      edgeAction: 'BUILD_SHIP',
      edges: ['0,0,W', '1,0,W'],
    });
  });

  it('move ship: pick a movable ship first, then one of its targets', () => {
    const v = view({ kind: 'main' }, ['MOVE_SHIP']);
    expect(movableShips(v)).toEqual(['2,0,W']);
    const pick = computeHighlights(v, 'moveShip');
    expect(pick).toMatchObject({ ships: ['2,0,W'], edges: [], edgeAction: null, shipFrom: null });
    const to = computeHighlights(v, 'moveShip', { shipFrom: '2,0,W' });
    expect(to).toMatchObject({
      edgeAction: 'MOVE_SHIP',
      edges: ['3,0,W', '3,0,NE'],
      shipFrom: '2,0,W',
    });
    // A ship that cannot go anywhere is never a valid pick.
    expect(computeHighlights(v, 'moveShip', { shipFrom: '4,0,W' }).edgeAction).toBeNull();
  });

  it('highlights robber and pirate targets together when both are allowed', () => {
    const p: Phase = { kind: 'moveRobber', returnTo: 'main', allowPirate: true };
    const h = computeHighlights(view(p, ['MOVE_ROBBER', 'MOVE_PIRATE']), null);
    expect(h.hexes).toEqual(['0,0']);
    expect(h.pirateHexes).toEqual(['3,0', '4,0']);
    const robberOnly = computeHighlights(view({ ...p, allowPirate: false }, ['MOVE_ROBBER']), null);
    expect(robberOnly.pirateHexes).toEqual([]);
  });

  it('drops ship modes that no longer apply', () => {
    const v = view({ kind: 'main' }, ['BUILD_SHIP', 'MOVE_SHIP']);
    expect(sanitizeMode(v, 'buildShip')).toBe('buildShip');
    expect(sanitizeMode(v, 'moveShip')).toBe('moveShip');
    const broke = view({ kind: 'main' }, ['BUILD_SHIP']);
    broke.legal!.canAfford = { ...broke.legal!.canAfford, ship: false };
    expect(sanitizeMode(broke, 'buildShip')).toBeNull();
    expect(sanitizeMode(broke, 'moveShip')).toBeNull();
    expect(sanitizeShipFrom(v, 'moveShip', '2,0,W')).toBe('2,0,W');
    expect(sanitizeShipFrom(v, 'moveShip', '4,0,W')).toBeNull();
    expect(sanitizeShipFrom(v, 'buildShip', '2,0,W')).toBeNull();
  });
});

describe('Open Seas prompts', () => {
  it('names ships and the pirate where they apply', () => {
    expect(hasShips(sea)).toBe(true);
    expect(hasShips(classic)).toBe(false);
    expect(phasePrompt(view(setupRoad, []), name).text).toBe(
      'Place a road or ship next to your settlement',
    );
    expect(phasePrompt(view(setupRoad, [], classic), name).text).toBe(
      'Place a road next to your settlement',
    );
    expect(
      phasePrompt(view({ kind: 'moveRobber', returnTo: 'main', allowPirate: true }, []), name).text,
    ).toBe('Move the robber or the pirate');
    expect(
      phasePrompt(
        view({ kind: 'steal', candidates: [1], returnTo: 'main', via: 'pirate' }, []),
        name,
      ).text,
    ).toBe('Choose a ship owner to rob');
    expect(phasePrompt(view({ kind: 'roadBuilding', remaining: 2 }, []), name).text).toBe(
      'Place 2 free roads or ships',
    );
    expect(phasePrompt(view({ kind: 'roadBuilding', remaining: 1 }, []), name).text).toBe(
      'Place 1 free road or ship',
    );
  });

  it('gold choice asks the choosers and makes the others wait', () => {
    const p: Phase = { kind: 'goldChoice', pending: { '0': 2, '2': 1 }, resume: { kind: 'main' } };
    expect(phasePrompt(view(p, []), name)).toEqual({
      text: 'Choose 2 resources from gold',
      tone: 'act',
    });
    const other = { ...view(p, []), viewer: 1 };
    expect(phasePrompt(other, name).text).toBe('Waiting for Alice and Chen to choose gold…');
  });

  it('mode hints guide the ship move', () => {
    expect(modeHint('moveShip', { shipFrom: null })).toBe('Choose a ship to move');
    expect(modeHint('moveShip', { shipFrom: '1,0,W' })).toBe('Choose where the ship sails to');
    expect(modeHint('buildRoad', { shipFrom: null })).toBeNull();
  });
});

describe('gold choice', () => {
  const bank = resourcesOf({ brick: 5, lumber: 0, wool: 1, grain: 9, ore: 9 });
  it('caps each resource by what is left to pick and by the bank', () => {
    expect(goldLimits(emptyResources(), 2, bank)).toEqual(
      resourcesOf({ brick: 2, lumber: 0, wool: 1, grain: 2, ore: 2 }),
    );
    expect(goldLimits(resourcesOf({ grain: 1 }), 2, bank)).toEqual(
      resourcesOf({ brick: 1, lumber: 0, wool: 1, grain: 2, ore: 1 }),
    );
  });
  it('is ready with exactly the count, all available', () => {
    expect(goldReady(resourcesOf({ grain: 1, ore: 1 }), 2, bank)).toBe(true);
    expect(goldReady(resourcesOf({ grain: 1 }), 2, bank)).toBe(false);
    expect(goldReady(resourcesOf({ lumber: 1 }), 1, bank)).toBe(false);
    expect(goldReady(emptyResources(), 0, bank)).toBe(false);
  });
});
