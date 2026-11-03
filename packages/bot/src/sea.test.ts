import { describe, expect, it } from 'vitest';
import {
  COSTS,
  applyAction,
  createGame,
  graphFor,
  normalizeConfig,
  resourcesOf,
  toPlayerView,
  totalResources,
  type Action,
  type BoardGraph,
  type EdgeId,
  type GameState,
  type HexId,
  type Phase,
  type Seat,
  type VertexId,
} from '@hexhaven/engine';
import { decide } from './index';
import { SeaPlanner, chooseGold, islandBonusValue, islandOfVertex } from './sea';
import { simulateGame } from './sim/simulate';

const opts = { difficulty: 'hard' as const, random: () => 0.5 };

function seaGame(scenario = 'newShores', players = 4): GameState {
  return createGame(
    normalizeConfig({ players, variant: 'seafarers', scenario }),
    `bot-sea-${scenario}`,
  );
}

function inPhase(s: GameState, phase: Phase, current: Seat = 0): GameState {
  s.phase = phase;
  s.turn.current = current;
  s.turn.number = Math.max(1, s.turn.number);
  return s;
}

function setHand(s: GameState, seat: Seat, r: Parameters<typeof resourcesOf>[0]): void {
  const hand = s.players[seat]!.resources;
  const full = resourcesOf(r);
  for (const k of Object.keys(full) as (keyof typeof full)[]) {
    s.bank[k] += hand[k] - full[k];
    hand[k] = full[k];
  }
}

const settle = (
  s: GameState,
  seat: Seat,
  v: VertexId,
  kind: 'settlement' | 'city' = 'settlement',
) => {
  s.buildings[v] = { owner: seat, kind };
  if (kind === 'settlement') s.players[seat]!.settlementsLeft--;
  else s.players[seat]!.citiesLeft--;
};

const ship = (s: GameState, seat: Seat, e: EdgeId) => {
  s.ships[e] = seat;
  s.players[seat]!.shipsLeft--;
};

/** Turn every home-island hex into desert, so only the other islands are worth reaching. */
function barrenHome(s: GameState, g: BoardGraph): void {
  for (const h of s.board.hexes)
    if (g.islandOf[h.id] !== undefined && s.board.homeIslands.includes(g.islandOf[h.id]!)) {
      h.terrain = 'desert';
      h.token = null;
    }
  s.board.ports = [];
}

const homeCoast = (s: GameState, g: BoardGraph): VertexId[] =>
  g.landVertices.filter((v) => {
    const isl = g.vertexHexes[v]!.map((h) => g.islandOf[h]).find((i) => i !== undefined);
    return (
      isl !== undefined &&
      s.board.homeIslands.includes(isl) &&
      g.vertexEdges[v]!.some((e) => g.seaEdges.includes(e))
    );
  });

const play = (s: GameState, seat: Seat): Action => {
  const action = decide(toPlayerView(s, seat), opts);
  const r = applyAction(s, seat, action);
  if (!r.ok) throw new Error(`${action.type}: ${r.error.message}`);
  return action;
};

describe('Open Seas planning', () => {
  it('values a settlement on a new island with the island bonus, once per seat', () => {
    const s = seaGame();
    const g = graphFor(s.board);
    const view = toPlayerView(s, 0);
    const away = g.landVertices.find((v) => {
      const i = islandOfVertex(view, v);
      return i !== null && !s.board.homeIslands.includes(i);
    })!;
    const home = homeCoast(s, g)[0]!;
    expect(islandBonusValue(view, 0, home)).toBe(0);
    expect(islandBonusValue(view, 0, away)).toBeGreaterThan(0);
    s.islandBonus[String(islandOfVertex(view, away))] = [0];
    const after = toPlayerView(s, 0);
    expect(islandBonusValue(after, 0, away)).toBe(0);
    expect(islandBonusValue(after, 1, away)).toBeGreaterThan(0);
  });

  it('chooses gold that completes the build target, within the bank', () => {
    const none = resourcesOf({});
    const ship = chooseGold(
      resourcesOf({ lumber: 1 }),
      none,
      resourcesOf({ wool: 5, ore: 5 }),
      COSTS.ship,
      1,
    );
    expect(ship).toEqual(resourcesOf({ wool: 1 }));
    const settlement = chooseGold(
      resourcesOf({ brick: 1, lumber: 1 }),
      none,
      resourcesOf({ brick: 9, lumber: 9, wool: 9, grain: 9, ore: 9 }),
      COSTS.settlement,
      2,
    );
    expect(settlement).toEqual(resourcesOf({ wool: 1, grain: 1 }));
    // Wool is gone from the bank: take something else rather than an impossible choice.
    const noWool = chooseGold(
      resourcesOf({ lumber: 1 }),
      none,
      resourcesOf({ ore: 1, grain: 2 }),
      COSTS.ship,
      2,
    );
    expect(totalResources(noWool)).toBe(2);
    expect(noWool.wool).toBe(0);
  });

  it('answers a simultaneous gold choice with a legal CHOOSE_GOLD', () => {
    const s = inPhase(seaGame(), {
      kind: 'goldChoice',
      pending: { '1': 2, '2': 1 },
      resume: { kind: 'main' },
    });
    // Seat 1 saves for a city (it holds 2 ore and 1 grain): gold completes it.
    settle(s, 1, homeCoast(s, graphFor(s.board))[0]!);
    setHand(s, 1, { ore: 2, grain: 1 });
    const action = decide(toPlayerView(s, 1), opts);
    expect(action).toEqual({ type: 'CHOOSE_GOLD', resources: resourcesOf({ ore: 1, grain: 1 }) });
    expect(applyAction(s, 1, action).ok).toBe(true);
    expect(applyAction(s, 2, decide(toPlayerView(s, 2), opts)).ok).toBe(true);
  });

  it('places a setup ship toward a new island when the home island offers nothing', () => {
    const s = seaGame();
    const g = graphFor(s.board);
    barrenHome(s, g);
    // The home coast vertex whose best ship leads furthest toward value.
    const v = homeCoast(s, g)
      .filter((x) =>
        g.vertexEdges[x]!.some(
          (e) => g.seaEdges.includes(e) && !g.edgeHexes[e]!.includes(s.pirate!),
        ),
      )
      .sort((a, b) => {
        const score = (x: VertexId) => {
          const t = structuredClone(s);
          settle(t, 0, x);
          const p = new SeaPlanner(toPlayerView(t, 0), 0, resourcesOf({}));
          return Math.max(
            ...g.vertexEdges[x]!.filter((e) => g.seaEdges.includes(e)).map((e) =>
              p.edgeValue(e, 'ship'),
            ),
          );
        };
        return score(b) - score(a);
      })[0]!;
    settle(s, 0, v);
    s.phase = { kind: 'setup', index: 0, step: 'road', lastSettlement: v };
    const action = play(s, 0);
    expect(action.type).toBe('PLACE_SHIP');
  });

  it('builds a ship toward a new island rather than a road to nowhere', () => {
    const s = seaGame();
    const g = graphFor(s.board);
    barrenHome(s, g);
    const v = homeCoast(s, g).find((x) =>
      g.vertexEdges[x]!.some((e) => g.seaEdges.includes(e) && !g.edgeHexes[e]!.includes(s.pirate!)),
    )!;
    settle(s, 0, v);
    inPhase(s, { kind: 'main' });
    setHand(s, 0, { lumber: 2, wool: 1, brick: 1 });
    const action = play(s, 0);
    expect(action.type).toBe('BUILD_SHIP');
  });

  it('moves a dead-end ship toward a better spot', () => {
    for (const v of homeCoast(seaGame(), graphFor(seaGame().board))) {
      const s = seaGame();
      const g = graphFor(s.board);
      barrenHome(s, g);
      const edges = g.vertexEdges[v]!.filter(
        (e) => g.seaEdges.includes(e) && !g.edgeHexes[e]!.includes(s.pirate!),
      );
      if (edges.length < 2) continue;
      settle(s, 0, v);
      const p = new SeaPlanner(toPlayerView(s, 0), 0, resourcesOf({}));
      const ranked = [...edges].sort((a, b) => p.edgeValue(a, 'ship') - p.edgeValue(b, 'ship'));
      const worst = ranked[0]!;
      const best = ranked.at(-1)!;
      if (p.edgeValue(best, 'ship') - p.edgeValue(worst, 'ship') < 2) continue;
      ship(s, 0, worst);
      inPhase(s, { kind: 'main' });
      setHand(s, 0, {});
      const action = play(s, 0);
      expect(action.type).toBe('MOVE_SHIP');
      if (action.type === 'MOVE_SHIP') expect(action.from).toBe(worst);
      return;
    }
    throw new Error('no coast vertex with a clearly better ship edge');
  });

  it('builds ships during road building when no road fits', () => {
    const s = seaGame();
    const g = graphFor(s.board);
    const v = homeCoast(s, g).find((x) =>
      g.vertexEdges[x]!.some((e) => g.seaEdges.includes(e) && !g.edgeHexes[e]!.includes(s.pirate!)),
    )!;
    settle(s, 0, v);
    s.players[0]!.roadsLeft = 0;
    inPhase(s, { kind: 'roadBuilding', remaining: 2 });
    expect(play(s, 0).type).toBe('BUILD_SHIP');
  });

  describe('robber or pirate', () => {
    /** Seat 1 (the leader) has an open ship on a sea hex away from the pirate. */
    function setupPirateTarget(): { s: GameState; hex: HexId } {
      const s = seaGame();
      const g = graphFor(s.board);
      barrenHome(s, g);
      for (const v of homeCoast(s, g)) {
        const e = g.vertexEdges[v]!.find(
          (x) => g.seaEdges.includes(x) && !g.edgeHexes[x]!.includes(s.pirate!),
        );
        if (!e) continue;
        settle(s, 1, v, 'city');
        ship(s, 1, e);
        const hex = g.edgeHexes[e]!.find((h) => g.islandOf[h] === undefined)!;
        s.players[1]!.bonusVP = 4;
        setHand(s, 1, {});
        inPhase(s, { kind: 'moveRobber', returnTo: 'main', allowPirate: true });
        return { s, hex };
      }
      throw new Error('no coast');
    }

    it('moves the pirate onto the leader’s shipping line when the robber has no target', () => {
      const { s, hex } = setupPirateTarget();
      const action = decide(toPlayerView(s, 0), opts);
      expect(action).toEqual({ type: 'MOVE_PIRATE', hex });
      expect(applyAction(s, 0, action).ok).toBe(true);
    });

    it('prefers the robber when it blocks a rich hex of the leader', () => {
      const { s } = setupPirateTarget();
      const g = graphFor(s.board);
      const rich = s.board.hexes.find(
        (h) =>
          (h.token === 6 || h.token === 8) &&
          h.terrain !== 'gold' &&
          !s.board.homeIslands.includes(g.islandOf[h.id] ?? -1),
      );
      if (!rich) throw new Error('no 6/8 hex off the home island');
      settle(s, 1, g.hexVertices[rich.id]![0]!, 'city');
      setHand(s, 1, { ore: 2 });
      const action = decide(toPlayerView(s, 0), opts);
      expect(action).toEqual({ type: 'MOVE_ROBBER', hex: rich.id });
    });
  });
});

describe('Open Seas simulation', () => {
  for (const [scenario, players] of [
    ['newShores', 4],
    ['archipelago', 3],
    ['grandVoyage', 6],
  ] as const) {
    it(`bots finish ${scenario} games with only legal moves and build ships`, () => {
      for (let i = 0; i < 2; i++) {
        const r = simulateGame(`sea-${scenario}-${i}`, players, { variant: 'seafarers', scenario });
        expect(r.finished).toBe(true);
        expect(r.scenario).toBe(scenario);
        expect(Math.max(...r.vp)).toBeGreaterThanOrEqual(13);
        expect(r.shipsBuilt).toBeGreaterThan(0);
      }
    });
  }

  it('is deterministic for a seed', () => {
    const o = { variant: 'seafarers' as const, scenario: 'archipelago' };
    expect(simulateGame('sea-det', 4, o)).toEqual(simulateGame('sea-det', 4, o));
  });
});
