import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { graphFor, type GameState, type Phase, type Seat } from '@hexhaven/engine';
import type { Repos } from '../db';
import { realEngine, type BotFactory } from './engineApi';
import { GameRunner, type RunnerSeat } from './GameRunner';

/**
 * Humans who time out in Open Seas decisions, with a stand-in bot that cannot handle them (it
 * throws, as a bot without Open Seas support would): the fallback alone must move the game on.
 */
const silent = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  child() {
    return silent;
  },
} as unknown as FastifyBaseLogger;

const repos = {
  tx: <T>(fn: () => T) => fn(),
  games: { appendAction() {}, saveSnapshot() {}, setTurns() {}, finish() {} },
  rooms: { setStatus() {} },
} as unknown as Repos;

const throwingBots: BotFactory = () => ({
  decide() {
    throw new Error('no Open Seas support');
  },
});

function runner(state: GameState) {
  const seats: RunnerSeat[] = state.players.map((_, i) => ({
    kind: 'human',
    userId: `u${i}`,
    controller: 'human',
    connected: true,
    botDifficulty: 'normal',
  }));
  const controllers: Array<[Seat, string]> = [];
  const r = new GameRunner({
    gameId: 'g',
    state,
    engine: realEngine,
    bots: throwingBots,
    repos,
    host: {
      roomId: 'r',
      seats: () => seats,
      turnTimerSec: () => 5,
      setController: (seat, c) => {
        seats[seat]!.controller = c;
        controllers.push([seat, c]);
      },
      broadcastGame: () => {},
      onGameOver: () => {},
    },
    log: silent,
    botDelayMs: 0,
    discardMs: 2_000,
  });
  r.begin();
  return { r, controllers };
}

const freshSea = (): GameState =>
  realEngine.createGame(
    realEngine.normalizeConfig({ players: 3, variant: 'seafarers', scenario: 'newShores' }),
    'timeouts',
  );

/** A main-game turn of seat 0 (turn 3, rolled) forced into `phase`. */
function seaState(phase: Phase, patch: (s: GameState) => void = () => {}): GameState {
  const s = freshSea();
  s.phase = phase;
  s.turn = { ...s.turn, current: 0, number: 3, dice: [3, 4] };
  patch(s);
  return s;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Open Seas turn timeouts', () => {
  it('every human owed gold times out on the gold timer, then the turn resumes', async () => {
    const { r, controllers } = runner(
      seaState({ kind: 'goldChoice', pending: { '0': 1, '2': 2 }, resume: { kind: 'main' } }),
    );
    await vi.advanceTimersByTimeAsync(1_900);
    expect(r.state.phase.kind).toBe('goldChoice');
    await vi.advanceTimersByTimeAsync(200);
    expect(r.state.phase).toEqual({ kind: 'main' });
    // Timed out once each: still their own seats.
    expect(controllers).toEqual([]);
    r.close();
  });

  it('a setup gold choice gets its own timer, separate from the previous one', async () => {
    const s = seaState({
      kind: 'goldChoice',
      pending: { '1': 1 },
      resume: { kind: 'setup', index: 4, step: 'road', lastSettlement: null },
    });
    s.turn = { ...s.turn, number: 0 };
    const { r } = runner(s);
    await vi.advanceTimersByTimeAsync(2_100);
    expect(r.state.phase).toMatchObject({ kind: 'setup', index: 4, step: 'road' });
    r.close();
  });

  it('a setup road step with only sea edges left times out to a ship', async () => {
    let s = freshSea();
    const graph = graphFor(s.board);
    const vertex = realEngine
      .toPlayerView(s, 0)
      .legal!.settlementVertices.find((v) =>
        graph.vertexEdges[v]!.some(
          (e) => !graph.roadEdges.includes(e) && !graph.edgeHexes[e]!.includes(s.pirate ?? ''),
        ),
      )!;
    const placed = realEngine.applyAction(s, 0, { type: 'PLACE_SETTLEMENT', vertex });
    if (!placed.ok) throw new Error(placed.error.code);
    s = placed.state;
    for (const e of graph.vertexEdges[vertex]!) if (graph.roadEdges.includes(e)) s.roads[e] = 1;
    const { r } = runner(s);
    await vi.advanceTimersByTimeAsync(5_100);
    expect(Object.values(r.state.ships)).toEqual([0]);
    expect(r.state.phase).toMatchObject({ kind: 'setup', index: 1, step: 'settlement' });
    r.close();
  });

  it('the robber-or-pirate choice times out to a robber move and its steal', async () => {
    const { r } = runner(
      seaState({ kind: 'moveRobber', allowPirate: true, returnTo: 'main' }, (s) => {
        // Two victims on the first robber target, so a steal choice follows the move.
        const target = realEngine.toPlayerView(s, 0).legal!.robberHexes[0]!;
        const [a, b] = graphFor(s.board).hexVertices[target]!.filter((_, i) => i % 2 === 0);
        s.buildings[a!] = { owner: 1, kind: 'settlement' };
        s.buildings[b!] = { owner: 2, kind: 'settlement' };
        s.players[1]!.resources.ore = 1;
        s.players[2]!.resources.ore = 1;
      }),
    );
    const robber = r.state.robber;
    await vi.advanceTimersByTimeAsync(5_100);
    expect(r.state.robber).not.toBe(robber);
    expect(r.state.phase).toEqual({ kind: 'main' });
    expect(r.state.players[0]!.resources.ore).toBe(1);
    r.close();
  });

  it('road building with only ships left times out to both free ships', async () => {
    const { r } = runner(
      seaState({ kind: 'roadBuilding', remaining: 2 }, (s) => {
        const graph = graphFor(s.board);
        const coast = graph.landVertices.find(
          (v) =>
            graph.vertexEdges[v]!.filter(
              (e) => graph.seaEdges.includes(e) && !graph.edgeHexes[e]!.includes(s.pirate ?? ''),
            ).length >= 2,
        )!;
        s.buildings[coast] = { owner: 0, kind: 'settlement' };
        s.players[0]!.roadsLeft = 0;
      }),
    );
    await vi.advanceTimersByTimeAsync(5_100);
    expect(Object.keys(r.state.ships)).toHaveLength(2);
    expect(r.state.phase).toEqual({ kind: 'main' });
    r.close();
  });
});
