import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  getPendingActors,
  graphFor,
  normalizeConfig,
  SCENARIO_IDS,
  SCENARIOS,
  toPlayerView,
  type Action,
  type GameState,
  type ScenarioId,
  type Seat,
} from '@hexhaven/engine';
import { fallbackActions } from './fallback';

/**
 * Open Seas decisions the timeout fallback must always resolve with the real engine: whenever a
 * human times out and the stand-in bot fails, these moves are all that keeps the game going.
 */
const seaGame = (scenario: ScenarioId = 'newShores', seed = 'fallback'): GameState => {
  const layout = SCENARIOS[scenario];
  return createGame(
    normalizeConfig({ players: layout.minPlayers ?? 3, variant: 'seafarers', scenario }),
    seed,
  );
};

/** Apply the first fallback the engine accepts for `seat`, as GameRunner.tryFallbacks does. */
function viaFallback(state: GameState, seat: Seat): { state: GameState; action: Action } {
  for (const action of fallbackActions(toPlayerView(state, seat), seat)) {
    const r = applyAction(state, seat, action);
    if (r.ok) return { state: r.state, action };
  }
  throw new Error(`no fallback accepted for seat ${seat} in ${state.phase.kind}`);
}

const zero = { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };

describe('fallbackActions (Open Seas, real engine)', () => {
  it('chooses gold from what the bank holds most of, for every owed seat', () => {
    const s = seaGame();
    s.phase = { kind: 'goldChoice', pending: { '0': 2, '1': 1 }, resume: { kind: 'main' } };
    s.bank = { brick: 1, lumber: 0, wool: 5, grain: 3, ore: 0 };
    const first = viaFallback(s, 0);
    expect(first.action).toEqual({ type: 'CHOOSE_GOLD', resources: { ...zero, wool: 2 } });
    const second = viaFallback(first.state, 1);
    expect(second.action).toEqual({ type: 'CHOOSE_GOLD', resources: { ...zero, wool: 1 } });
    expect(second.state.phase).toEqual({ kind: 'main' });
    expect(second.state.players[0]!.resources.wool).toBe(s.players[0]!.resources.wool + 2);
  });

  it('spreads the choice when the bank runs short of one resource', () => {
    const s = seaGame();
    s.phase = { kind: 'goldChoice', pending: { '0': 2 }, resume: { kind: 'main' } };
    s.bank = { ...zero, ore: 1, grain: 1 };
    const { action, state } = viaFallback(s, 0);
    expect(action).toEqual({ type: 'CHOOSE_GOLD', resources: { ...zero, grain: 1, ore: 1 } });
    expect(state.bank).toEqual(zero);
  });

  it('places a setup ship when the settlement has no free road edge', () => {
    let s = seaGame();
    const graph = graphFor(s.board);
    const roadOnly = new Set(graph.roadEdges);
    const view = toPlayerView(s, 0);
    // A coastal settlement spot with a sea|sea edge (ship only) away from the pirate.
    const vertex = view.legal!.settlementVertices.find((v) =>
      graph.vertexEdges[v]!.some(
        (e) =>
          !roadOnly.has(e) &&
          graph.seaEdges.includes(e) &&
          !graph.edgeHexes[e]!.includes(s.pirate ?? ''),
      ),
    );
    expect(vertex).toBeDefined();
    const placed = applyAction(s, 0, { type: 'PLACE_SETTLEMENT', vertex: vertex! });
    if (!placed.ok) throw new Error(placed.error.code);
    s = placed.state;
    // Opponent roads already take every road edge of the spot.
    for (const e of graph.vertexEdges[vertex!]!) if (roadOnly.has(e)) s.roads[e] = 1;
    expect(toPlayerView(s, 0).legal!.roadEdges).toEqual([]);

    const { action, state } = viaFallback(s, 0);
    expect(action.type).toBe('PLACE_SHIP');
    expect(Object.values(state.ships)).toEqual([0]);
    expect(state.phase).toMatchObject({ kind: 'setup', index: 1, step: 'settlement' });
  });

  it('builds ships during road building when no road fits', () => {
    const s = seaGame();
    const graph = graphFor(s.board);
    const vertex = graph.landVertices.find(
      (v) =>
        graph.vertexEdges[v]!.filter(
          (e) => graph.seaEdges.includes(e) && !graph.edgeHexes[e]!.includes(s.pirate ?? ''),
        ).length >= 2,
    )!;
    s.buildings[vertex] = { owner: 0, kind: 'settlement' };
    s.players[0]!.roadsLeft = 0;
    s.phase = { kind: 'roadBuilding', remaining: 2 };
    s.turn = { ...s.turn, current: 0, number: 1, dice: [3, 4] };

    const one = viaFallback(s, 0);
    expect(one.action.type).toBe('BUILD_SHIP');
    const two = viaFallback(one.state, 0);
    expect(two.action.type).toBe('BUILD_SHIP');
    expect(two.state.phase).toEqual({ kind: 'main' });
    expect(Object.keys(two.state.ships)).toHaveLength(2);
  });

  it('resolves a robber-or-pirate move', () => {
    const s = seaGame();
    s.phase = { kind: 'moveRobber', allowPirate: true, returnTo: 'main' };
    s.turn = { ...s.turn, current: 0, number: 1, dice: [3, 4] };
    const { action, state } = viaFallback(s, 0);
    expect(action.type).toBe('MOVE_ROBBER');
    expect(['main', 'steal']).toContain(state.phase.kind);

    // Without a robber target the pirate is the way out.
    const view = toPlayerView(s, 0);
    view.legal = { ...view.legal!, robberHexes: [] };
    expect(fallbackActions(view, 0)[0]).toEqual({
      type: 'MOVE_PIRATE',
      hex: view.legal.pirateHexes[0],
    });
  });

  it.each(SCENARIO_IDS)('%s: seats that only ever time out never stall the game', (scenario) => {
    let s = seaGame(scenario, `stall-${scenario}`);
    const seen = new Set<string>();
    let seeded = false;
    for (let step = 0; step < 1500 && s.phase.kind !== 'gameOver'; step++) {
      if (!seeded && s.phase.kind === 'preRoll') {
        // Fallback setup never reaches gold, so hand every seat a city on each gold hex.
        seeded = true;
        s = structuredClone(s);
        const graph = graphFor(s.board);
        for (const hex of s.board.hexes.filter((h) => h.terrain === 'gold')) {
          graph.hexVertices[hex.id]!.forEach((v, i) => {
            if (i % 2 === 0) s.buildings[v] ??= { owner: i % s.players.length, kind: 'city' };
          });
        }
      }
      const seat = getPendingActors(s)[0];
      expect(seat).toBeDefined();
      seen.add(s.phase.kind);
      s = viaFallback(s, seat!).state;
    }
    expect(s.turn.number).toBeGreaterThan(20);
    expect(seen).toContain('setup');
    expect(seen).toContain('moveRobber');
    expect(seen).toContain('goldChoice');
  });
});
