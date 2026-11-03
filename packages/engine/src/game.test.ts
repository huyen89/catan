import { describe, expect, it } from 'vitest';
import { SCENARIOS, SCENARIO_IDS, type ScenarioId } from './board/layouts';
import { createGame, ENGINE_VERSION, normalizeConfig, upgradeState } from './game';
import { graphFor } from './hex/topology';
import { applyAction } from './reducer';
import { totalResources } from './resources';
import type { Action, GameState } from './types';
import { toPlayerView } from './view';
import { VARIANTS, defaultScenarioFor, variantFor } from './variants';

const HOME_ISLANDS: Record<ScenarioId, number[]> = {
  newShores: [0],
  archipelago: [0, 1, 3, 4],
  grandVoyage: [0],
};

const PLAYERS: Record<ScenarioId, number[]> = {
  newShores: [3, 4],
  archipelago: [3, 4],
  grandVoyage: [5, 6],
};

describe('Open Seas contract: config and variants', () => {
  it('normalizeConfig picks the scenario for the player count and its default VP', () => {
    expect(normalizeConfig({ players: 3, variant: 'seafarers' })).toMatchObject({
      scenario: 'newShores',
      vpToWin: 14,
    });
    expect(normalizeConfig({ players: 6, variant: 'seafarers' })).toMatchObject({
      scenario: 'grandVoyage',
      vpToWin: 14,
    });
    expect(
      normalizeConfig({ players: 4, variant: 'seafarers', scenario: 'archipelago' }),
    ).toMatchObject({ scenario: 'archipelago', vpToWin: 13 });
    // An explicit vpToWin wins over the scenario default.
    expect(normalizeConfig({ players: 4, variant: 'seafarers', vpToWin: 10 }).vpToWin).toBe(10);
  });

  it('base and ext56 configs keep their shape; a stray scenario is dropped', () => {
    expect(normalizeConfig({ players: 4 })).toEqual({
      variant: 'base',
      players: 4,
      vpToWin: 10,
      discardLimit: 7,
      numberMode: 'random',
      portMode: 'fixed',
    });
    expect(Object.keys(normalizeConfig({ players: 5, scenario: 'newShores' }))).not.toContain(
      'scenario',
    );
  });

  it('variantFor resolves scenario overrides and leaves other variants untouched', () => {
    expect(variantFor({ variant: 'base' })).toBe(VARIANTS.base);
    expect(variantFor({ variant: 'ext56' })).toBe(VARIANTS.ext56);
    const gv = variantFor({ variant: 'seafarers', scenario: 'grandVoyage' });
    expect(gv).toMatchObject({
      minPlayers: 5,
      maxPlayers: 6,
      bankPerResource: 24,
      specialBuildPhase: true,
      ships: 15,
    });
    expect(gv.layout).toBe(SCENARIOS.grandVoyage);
    expect(variantFor({ variant: 'seafarers', scenario: 'grandVoyage' })).toBe(gv);
    expect(variantFor({ variant: 'seafarers' }).layout).toBe(SCENARIOS.newShores);
    expect(() => variantFor({ variant: 'seafarers', scenario: 'nowhere' })).toThrow();
    expect(() => variantFor({ variant: 'seafarers', scenario: 'toString' })).toThrow();
    expect(defaultScenarioFor('base', 4)).toBeUndefined();
    expect(defaultScenarioFor('seafarers', 5)).toBe('grandVoyage');
  });
});

describe('Open Seas contract: createGame', () => {
  for (const id of SCENARIO_IDS)
    for (const players of PLAYERS[id])
      it(`${id} with ${players} players`, () => {
        const config = normalizeConfig({ players, variant: 'seafarers', scenario: id });
        const seed = `sea-${id}-${players}`;
        const s = createGame(config, seed);
        const layout = SCENARIOS[id];
        expect(createGame(config, seed)).toEqual(s);
        expect(createGame(config, `${seed}-other`).board).not.toEqual(s.board);

        expect(s.board.layoutId).toBe(id);
        expect(s.board.hexes).toHaveLength(layout.hexes.length);
        const byId = new Map(s.board.hexes.map((h) => [h.id, h]));
        for (const f of layout.fixedHexes ?? []) {
          const h = byId.get(`${f.q},${f.r}`)!;
          expect(h.terrain).toBe(f.terrain);
          expect(h.token).toBe(f.token ?? null);
        }
        for (const h of s.board.hexes) {
          const tokenless = h.terrain === 'sea' || h.terrain === 'desert';
          expect(h.token === null, h.id).toBe(tokenless);
        }
        expect(s.board.ports).toHaveLength(layout.portSlots.length);
        const g = graphFor(s.board);
        for (const p of s.board.ports) {
          expect(g.coastEdges).toContain(p.edge);
          for (const v of p.vertices) expect(g.landVertices).toContain(v);
        }

        expect(byId.get(s.robber)!.terrain).not.toBe('sea');
        expect(s.robber).toBe(layout.robberStart);
        expect(byId.get(s.pirate!)!.terrain).toBe('sea');
        expect(s.ships).toEqual({});
        expect(s.islandBonus).toEqual({});
        expect(s.turn).toMatchObject({ shipMoved: false, newShips: [] });
        const variant = variantFor(config);
        for (const p of s.players) expect(p).toMatchObject({ shipsLeft: 15, bonusVP: 0 });
        expect(totalResources(s.bank)).toBe(5 * variant.bankPerResource);
        expect(s.devDeck).toHaveLength(Object.values(variant.devDeck).reduce((a, b) => a + b));
        expect(toPlayerView(s, 0)).toMatchObject({ ships: {}, pirate: s.pirate, islandBonus: {} });
        expect(s.board.homeIslands).toEqual(HOME_ISLANDS[id]);
        expect(s.board.islandBonusVP).toBe(2);
        for (const h of layout.homeHexes ?? [])
          expect(s.board.homeIslands).toContain(g.islandOf[h]);
        expect(toPlayerView(s, null).board).toMatchObject({
          homeIslands: HOME_ISLANDS[id],
          islandBonusVP: 2,
        });
      });

  it('rejects a scenario outside its player range', () => {
    expect(() =>
      createGame(normalizeConfig({ players: 6, variant: 'seafarers', scenario: 'newShores' }), 's'),
    ).toThrow(/3-4 players/);
    expect(() =>
      createGame(
        normalizeConfig({ players: 3, variant: 'seafarers', scenario: 'grandVoyage' }),
        's',
      ),
    ).toThrow(/5-6 players/);
  });

  it('base/ext56 games start without ships, pirate or bonuses', () => {
    for (const players of [3, 4, 5, 6]) {
      const s = createGame(normalizeConfig({ players }), `plain-${players}`);
      expect(s.ships).toEqual({});
      expect(s.pirate).toBeNull();
      expect(s.islandBonus).toEqual({});
      for (const p of s.players) expect(p).toMatchObject({ shipsLeft: 0, bonusVP: 0 });
      expect(s.board).toMatchObject({ homeIslands: [0], islandBonusVP: 0 });
    }
  });

  it('ports never share a vertex, in both port modes and on every scenario', () => {
    for (const id of SCENARIO_IDS)
      for (const portMode of ['fixed', 'random'] as const)
        for (let i = 0; i < 25; i++) {
          const players = PLAYERS[id][0]!;
          const config = normalizeConfig({ players, variant: 'seafarers', scenario: id, portMode });
          const { ports } = createGame(config, `ports-${i}`).board;
          const vertices = ports.flatMap((p) => p.vertices);
          expect(new Set(vertices).size, `${id}/${portMode}/${i}`).toBe(vertices.length);
        }
  });

  it('Open Seas actions are implemented and reject out of phase', () => {
    const s = createGame(normalizeConfig({ players: 3, variant: 'seafarers' }), 'stub');
    const actions: Action[] = [
      { type: 'PLACE_SHIP', edge: '0,0,NE' },
      { type: 'BUILD_SHIP', edge: '0,0,NE' },
      { type: 'MOVE_SHIP', from: '0,0,NE', to: '0,0,W' },
      { type: 'MOVE_PIRATE', hex: '0,0' },
      { type: 'CHOOSE_GOLD', resources: { brick: 1, lumber: 0, wool: 0, grain: 0, ore: 0 } },
    ];
    for (const a of actions) {
      const r = applyAction(s, 0, a);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('WRONG_PHASE');
    }
  });
});

describe('upgradeState', () => {
  /** A state shaped like an ENGINE_VERSION 1 snapshot (none of the Open Seas fields). */
  function oldSnapshot(): GameState {
    const s = createGame(normalizeConfig({ players: 4 }), 'old') as unknown as Record<
      string,
      unknown
    >;
    delete s.ships;
    delete s.pirate;
    delete s.islandBonus;
    const board = s.board as unknown as Record<string, unknown>;
    delete board.homeIslands;
    delete board.islandBonusVP;
    s.engineVersion = 1;
    s.version = 17;
    const turn = s.turn as Record<string, unknown>;
    delete turn.shipMoved;
    delete turn.newShips;
    for (const p of s.players as Array<Record<string, unknown>>) {
      delete p.shipsLeft;
      delete p.bonusVP;
    }
    s.phase = { kind: 'steal', candidates: [1, 2], returnTo: 'main' };
    return s as unknown as GameState;
  }

  it('fills every new field with its default without touching the input', () => {
    const old = oldSnapshot();
    const before = structuredClone(old);
    const up = upgradeState(old);
    expect(old).toEqual(before);
    expect(up.engineVersion).toBe(ENGINE_VERSION);
    expect(up.version).toBe(17);
    expect(up.ships).toEqual({});
    expect(up.pirate).toBeNull();
    expect(up.islandBonus).toEqual({});
    expect(up.turn).toMatchObject({ shipMoved: false, newShips: [] });
    for (const p of up.players) expect(p).toMatchObject({ shipsLeft: 0, bonusVP: 0 });
    expect(up.board).toMatchObject({ homeIslands: [0], islandBonusVP: 0 });
    expect(up.phase).toEqual({
      kind: 'steal',
      candidates: [1, 2],
      returnTo: 'main',
      via: 'robber',
    });

    const robber = { ...old, phase: { kind: 'moveRobber', returnTo: 'preRoll' } } as GameState;
    expect(upgradeState(robber).phase).toEqual({
      kind: 'moveRobber',
      returnTo: 'preRoll',
      allowPirate: false,
    });
  });

  it('refuses a state from a newer engine', () => {
    const s = createGame(normalizeConfig({ players: 3 }), 'new');
    expect(() => upgradeState({ ...s, engineVersion: ENGINE_VERSION + 1 })).toThrow(/newer/);
  });

  it('is idempotent and leaves current states equal', () => {
    const s = createGame(normalizeConfig({ players: 3, variant: 'seafarers' }), 'cur');
    expect(upgradeState(s)).toEqual(s);
    const up = upgradeState(oldSnapshot());
    expect(upgradeState(up)).toEqual(up);
  });

  it('an upgraded snapshot keeps playing', () => {
    const up = upgradeState({ ...oldSnapshot(), phase: { kind: 'preRoll' } } as GameState);
    const r = applyAction(up, up.turn.current, { type: 'ROLL' });
    expect(r.ok).toBe(true);
  });
});
