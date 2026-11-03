import { describe, expect, it } from 'vitest';
import { SCENARIO_IDS, graphFor, publicVP, totalResources } from '@hexhaven/engine';
import { devPlayers } from './DevBoard';
import { createDevGame, devPayload, devRoom, devView } from './devGame';
import { DEV_SCENES, isDevScenario, isDevScene } from './seasFixture';

describe('dev fixture', () => {
  for (const players of [3, 4, 5, 6]) {
    it(`builds a consistent demo position for ${players} players`, () => {
      const s = createDevGame(players, 'fixture', true);
      const g = graphFor(s.board);
      const owned = Object.entries(s.buildings);
      expect(owned.length).toBe(players * 2);
      // distance rule holds
      for (const [v] of owned)
        for (const n of g.vertexNeighbors[v]!) expect(s.buildings[n]).toBeUndefined();
      // every road is a real edge, and resources came out of the bank
      for (const e of Object.keys(s.roads)) expect(g.edgeVertices[e]).toBeDefined();
      const held = s.players.reduce((n, p) => n + totalResources(p.resources), 0);
      const bankStart = 5 * (players >= 5 ? 24 : 19);
      expect(totalResources(s.bank) + held).toBe(bankStart);
    });
  }

  it('redacts the view for the chosen seat and keeps seats aligned with the room', () => {
    const s = createDevGame(4, 'fixture', true);
    const p = devPayload(s, 1, true, [], 'g');
    expect(p.view.viewer).toBe(1);
    expect(p.view.players[0]!.resources).toBeUndefined();
    expect(p.view.players[1]!.resources).toBeDefined();
    expect(devRoom(4).seats).toHaveLength(4);
  });

  it('can start from a fresh setup position', () => {
    const s = createDevGame(3, 'fresh', false);
    expect(s.phase.kind).toBe('setup');
    expect(Object.keys(s.buildings)).toHaveLength(0);
  });

  describe('Open Seas fixture', () => {
    for (const scenario of SCENARIO_IDS) {
      const players = devPlayers(4, scenario);
      it(`places pieces legally on the ${scenario} board`, () => {
        const s = createDevGame(players, 'fixture', true, { scenario });
        expect(s.config.variant).toBe('seafarers');
        expect(s.config.scenario).toBe(scenario);
        const g = graphFor(s.board);
        const land = new Set(g.landVertices);
        const sea = new Set(g.seaEdges);
        const roads = new Set(g.roadEdges);
        for (const v of Object.keys(s.buildings)) {
          expect(land.has(v)).toBe(true);
          for (const n of g.vertexNeighbors[v]!) expect(s.buildings[n]).toBeUndefined();
        }
        for (const e of Object.keys(s.ships)) expect(sea.has(e)).toBe(true);
        for (const e of Object.keys(s.roads)) expect(roads.has(e)).toBe(true);
        for (const e of Object.keys(s.ships)) expect(s.roads[e]).toBeUndefined();
        expect(Object.keys(s.ships).length).toBeGreaterThan(players);
        expect(s.pirate).not.toBeNull();
        // Seat 0 settled a new island and holds its bonus (counted in public VP).
        expect(s.players[0]!.bonusVP).toBe(s.board.islandBonusVP);
        expect(Object.values(s.islandBonus)).toEqual([[0]]);
        expect(publicVP(s, 0)).toBeGreaterThanOrEqual(s.board.islandBonusVP);
        const used = Object.values(s.ships).length;
        const left = s.players.reduce((n, p) => n + p.shipsLeft, 0);
        expect(used + left).toBe(15 * players);
      });

      it(`hand-crafts ship and pirate options for ${scenario}`, () => {
        const main = devView(createDevGame(players, 'fixture', true, { scenario }), 0, true);
        expect(main.legal!.actions).toEqual(expect.arrayContaining(['BUILD_SHIP', 'MOVE_SHIP']));
        expect(main.legal!.shipEdges.length).toBeGreaterThan(0);
        for (const e of main.legal!.shipEdges) expect(main.ships[e]).toBeUndefined();
        const moves = Object.entries(main.legal!.shipMoves);
        expect(moves.length).toBeGreaterThan(0);
        for (const [from] of moves) expect(main.ships[from]).toBe(0);

        const robber = devView(
          createDevGame(players, 'fixture', true, { scenario, scene: 'pirate' }),
          0,
          true,
        );
        expect(robber.legal!.actions).toEqual(
          expect.arrayContaining(['MOVE_ROBBER', 'MOVE_PIRATE']),
        );
        const terrain = new Map(robber.board.hexes.map((h) => [h.id, h.terrain]));
        for (const h of robber.legal!.pirateHexes) expect(terrain.get(h)).toBe('sea');
        for (const h of robber.legal!.robberHexes) expect(terrain.get(h)).not.toBe('sea');
      });
    }

    it('gold, pirate steal and setup scenes', () => {
      const gold = createDevGame(4, 'fixture', true, { scenario: 'newShores', scene: 'gold' });
      expect(gold.phase.kind).toBe('goldChoice');
      expect(devView(gold, 0, true).legal).toMatchObject({ goldCount: 2 });
      expect(devView(gold, 1, true).legal!.goldCount).toBe(0);
      expect(devView(gold, 2, true).legal!.actions).toContain('CHOOSE_GOLD');

      const steal = createDevGame(4, 'fixture', true, {
        scenario: 'newShores',
        scene: 'stealPirate',
      });
      expect(steal.phase).toMatchObject({ kind: 'steal', via: 'pirate' });

      const setup = createDevGame(4, 'fixture', true, { scenario: 'newShores', scene: 'setup' });
      expect(setup.phase).toMatchObject({ kind: 'setup', step: 'road' });
      const legal = devView(setup, 0, true).legal!;
      expect(legal.actions).toEqual(expect.arrayContaining(['PLACE_ROAD', 'PLACE_SHIP']));
      expect(legal.shipEdges.length).toBeGreaterThan(0);
    });

    it('validates URL params and clamps players to the scenario', () => {
      expect(isDevScenario('archipelago')).toBe(true);
      expect(isDevScenario('nope')).toBe(false);
      expect(isDevScenario(null)).toBe(false);
      expect(DEV_SCENES.every(isDevScene)).toBe(true);
      expect(isDevScene('discard')).toBe(false);
      expect(devPlayers(3, 'grandVoyage')).toBe(5);
      expect(devPlayers(6, 'newShores')).toBe(4);
      expect(devPlayers(6, null)).toBe(6);
      expect(devRoom(4, 'archipelago').settings).toMatchObject({
        variant: 'seafarers',
        scenario: 'archipelago',
      });
    });
  });
});
