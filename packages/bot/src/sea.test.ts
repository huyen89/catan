import { describe, expect, it } from 'vitest';
import {
  COSTS,
  applyAction,
  createGame,
  getPendingActors,
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
import { seatProduction } from './eval';
import { BotPlayer, buildTarget, decide } from './index';
import {
  SeaPlanner,
  buildableShipEdges,
  chooseGold,
  islandBonusValue,
  islandOfVertex,
  openShipEnd,
} from './sea';
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
    // Seat 1 saves for a city (it holds 2 ore and 1 grain, no ships left): gold completes it.
    settle(s, 1, homeCoast(s, graphFor(s.board))[0]!);
    s.players[1]!.shipsLeft = 0;
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

  it('places a setup ship when no road edge is legal', () => {
    const s = seaGame();
    const g = graphFor(s.board);
    const v = homeCoast(s, g).find((x) =>
      g.vertexEdges[x]!.some((e) => g.seaEdges.includes(e) && !g.edgeHexes[e]!.includes(s.pirate!)),
    )!;
    settle(s, 0, v);
    s.players[0]!.roadsLeft = 0;
    s.phase = { kind: 'setup', index: 0, step: 'road', lastSettlement: v };
    const view = toPlayerView(s, 0);
    expect(view.legal!.actions).not.toContain('PLACE_ROAD');
    expect(play(s, 0).type).toBe('PLACE_SHIP');
  });

  it('chooses setup gold (between the second settlement and its road)', () => {
    const s = seaGame();
    const g = graphFor(s.board);
    const v = homeCoast(s, g)[0]!;
    settle(s, 0, v);
    s.phase = {
      kind: 'goldChoice',
      pending: { '0': 1 },
      resume: { kind: 'setup', index: 7, step: 'road', lastSettlement: v },
    };
    s.turn.current = 0;
    const action = play(s, 0);
    expect(action.type).toBe('CHOOSE_GOLD');
  });

  it('keeps the lumber a pending ship needs instead of building a road with it', () => {
    let checked = 0;
    const base = seaGame();
    const g = graphFor(base.board);
    for (const v of homeCoast(base, g)) {
      const s = structuredClone(base);
      settle(s, 0, v);
      inPhase(s, { kind: 'main' });
      setHand(s, 0, { lumber: 2, brick: 1 });
      const rich = toPlayerView(s, 0);
      if (buildTarget(rich, opts) !== 'ship' || decide(rich, opts).type !== 'BUILD_ROAD') continue;
      // With two lumber the road leaves enough for the ship; with one it would not.
      setHand(s, 0, { lumber: 1, brick: 1 });
      const poor = toPlayerView(s, 0);
      expect(buildTarget(poor, opts)).toBe('ship');
      expect(decide(poor, opts).type).not.toBe('BUILD_ROAD');
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('counts gold production as a wildcard spread over the resources', () => {
    const s = seaGame();
    const g = graphFor(s.board);
    const gold = s.board.hexes.find((h) => h.terrain === 'gold')!;
    gold.token = 6;
    const v = g.hexVertices[gold.id]!.find((x) =>
      g.vertexHexes[x]!.every((h) => h === gold.id || g.islandOf[h] === undefined),
    );
    if (!v) throw new Error('no vertex touching only the gold hex');
    settle(s, 0, v, 'city');
    const prod = seatProduction(toPlayerView(s, 0), 0);
    expect(prod).toEqual(resourcesOf({ brick: 2, lumber: 2, wool: 2, grain: 2, ore: 2 }));
  });

  it('mirrors the engine: ship edges, ship moves and islands match getLegal over bot games', () => {
    let shipChecks = 0;
    let moveChecks = 0;
    let islandChecks = 0;
    for (const [scenario, players] of [
      ['newShores', 4],
      ['archipelago', 3],
      ['grandVoyage', 5],
    ] as const) {
      let s = createGame(
        normalizeConfig({ players, variant: 'seafarers', scenario }),
        `drift-${scenario}`,
      );
      const bots = s.players.map(() => new BotPlayer({ difficulty: 'normal', random: () => 0.3 }));
      for (let step = 0; step < 4000 && s.phase.kind !== 'gameOver'; step++) {
        const actor = getPendingActors(s)[0]!;
        const view = toPlayerView(s, actor);
        if (s.phase.kind === 'main' && actor === s.turn.current) {
          const me = actor;
          if (view.players[me]!.shipsLeft > 0) {
            expect(buildableShipEdges(view, me)).toEqual(view.legal!.shipEdges);
            shipChecks++;
          }
          if (!view.turn.shipMoved) {
            const g = graphFor(view.board);
            const expected: Record<EdgeId, EdgeId[]> = {};
            for (const from of Object.keys(view.ships).sort()) {
              if (view.ships[from] !== me || view.turn.newShips.includes(from)) continue;
              if (openShipEnd(view, view.ships, me, from) === null) continue;
              if (view.pirate !== null && g.edgeHexes[from]!.includes(view.pirate)) continue;
              const lifted = { ...view.ships };
              delete lifted[from];
              const to = buildableShipEdges(view, me, lifted).filter((e) => e !== from);
              if (to.length > 0) expected[from] = to;
            }
            expect(expected).toEqual(view.legal!.shipMoves);
            moveChecks++;
          }
        }
        const r = applyAction(s, actor, bots[actor]!.decide(view));
        if (!r.ok) throw new Error(r.error.message);
        for (const ev of r.events) {
          if (ev.type !== 'islandBonus') continue;
          const built = r.events.find(
            (x) => (x.type === 'built' && x.kind === 'settlement') || x.type === 'setupPlaced',
          );
          if (built && 'at' in built) {
            expect(islandOfVertex(toPlayerView(r.state, actor), built.at)).toBe(ev.island);
            islandChecks++;
          }
        }
        s = r.state;
      }
    }
    expect(shipChecks).toBeGreaterThan(100);
    expect(moveChecks).toBeGreaterThan(100);
    expect(islandChecks).toBeGreaterThan(0);
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

    /**
     * Seat 0 has an open-ended ship from a home coast settlement pointing at the best line on the
     * board, and the pirate sits on that ship's sea hex. With `anchored`, a second ship of seat 0
     * continues the line past it (off the pirate's hex), so the blocked ship is anchored.
     * Seat 1 offers a modest robber target: a settlement on a 4 off the home island.
     */
    function blockedLine(anchored: boolean): { s: GameState; robberHex: HexId } {
      const base = seaGame();
      const g = graphFor(base.board);
      barrenHome(base, g);
      let best: { v: VertexId; e: EdgeId; value: number } | null = null;
      for (const v of homeCoast(base, g)) {
        const t = structuredClone(base);
        settle(t, 0, v);
        const p = new SeaPlanner(toPlayerView(t, 0), 0, resourcesOf({}));
        for (const e of g.vertexEdges[v]!) {
          if (!g.seaEdges.includes(e)) continue;
          const value = p.edgeValue(e, 'ship');
          if (!best || value > best.value) best = { v, e, value };
        }
      }
      const { v, e } = best!;
      const s = structuredClone(base);
      settle(s, 0, v);
      ship(s, 0, e);
      const w = g.edgeVertices[e]!.find((x) => x !== v)!;
      const seaHexes = g.edgeHexes[e]!.filter((h) => g.islandOf[h] === undefined);
      let pirate = seaHexes[0]!;
      if (anchored) {
        const pair = g.vertexEdges[w]!.flatMap((e2) =>
          e2 === e || !g.seaEdges.includes(e2)
            ? []
            : seaHexes.filter((h) => !g.edgeHexes[e2]!.includes(h)).map((h) => [e2, h] as const),
        )[0];
        if (!pair) throw new Error('no continuation off the pirate hex');
        ship(s, 0, pair[0]);
        pirate = pair[1];
      }
      s.pirate = pirate;
      const target = s.board.hexes.find(
        (h) =>
          h.terrain !== 'gold' &&
          g.islandOf[h.id] !== undefined &&
          !s.board.homeIslands.includes(g.islandOf[h.id]!),
      )!;
      target.terrain = 'fields';
      target.token = 4;
      settle(s, 1, g.hexVertices[target.id]![0]!);
      setHand(s, 1, { wool: 1 });
      return { s, robberHex: target.id };
    }

    it('moves the pirate off its own open-ended line rather than rob a modest hex', () => {
      const { s } = blockedLine(false);
      inPhase(s, { kind: 'moveRobber', returnTo: 'main', allowPirate: true });
      const action = decide(toPlayerView(s, 0), opts);
      expect(action.type).toBe('MOVE_PIRATE');
      expect(applyAction(s, 0, action).ok).toBe(true);
    });

    it('robs instead when the pirate only sits next to an anchored ship', () => {
      const { s, robberHex } = blockedLine(true);
      inPhase(s, { kind: 'moveRobber', returnTo: 'main', allowPirate: true });
      expect(decide(toPlayerView(s, 0), opts)).toEqual({ type: 'MOVE_ROBBER', hex: robberHex });
    });

    it('plays a knight for the pirate only when the knight would move the pirate', () => {
      const open = blockedLine(false).s;
      open.players[0]!.devCards = ['knight'];
      inPhase(open, { kind: 'preRoll' });
      expect(play(open, 0)).toEqual({ type: 'PLAY_KNIGHT' });
      let r = applyAction(open, 0, { type: 'PLAY_KNIGHT' });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(decide(toPlayerView(r.state, 0), opts).type).toBe('MOVE_PIRATE');

      const anchored = blockedLine(true).s;
      anchored.players[0]!.devCards = ['knight'];
      inPhase(anchored, { kind: 'preRoll' });
      expect(decide(toPlayerView(anchored, 0), opts)).toEqual({ type: 'ROLL' });
      r = applyAction(anchored, 0, { type: 'ROLL' });
      expect(r.ok).toBe(true);
    });

    it('prefers the robber when it blocks a rich hex of the leader', () => {
      const { s } = setupPirateTarget();
      const g = graphFor(s.board);
      const rich = s.board.hexes.find(
        (h) =>
          h.terrain !== 'gold' &&
          g.islandOf[h.id] !== undefined &&
          !s.board.homeIslands.includes(g.islandOf[h.id]!),
      );
      if (!rich) throw new Error('no producing hex off the home island');
      rich.terrain = 'mountains';
      rich.token = 8;
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
