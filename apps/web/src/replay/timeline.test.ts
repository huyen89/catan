import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION, normalizeConfig, type GameState } from '@hexhaven/engine';
import { playRandomGame } from '@hexhaven/engine/test';
import type { GameSummary, ReplayResponse } from '@hexhaven/shared';
import { ReplayTimeline, activeSeat, replayView } from './timeline';

const SEED = 'replay-fixture';

function fixture(maxSteps = 400): { replay: ReplayResponse; states: GameState[] } {
  const states: GameState[] = [];
  const game = playRandomGame(SEED, 4, maxSteps, (s) => states.push(s));
  states.unshift(game.initial);
  const final = game.state;
  const summary: GameSummary = {
    gameId: 'g1',
    roomCode: 'ABCDEF',
    variant: 'base',
    scenario: null,
    status: 'finished',
    winner: final.phase.kind === 'gameOver' ? final.phase.winner : null,
    mySeat: 0,
    players: [0, 1, 2, 3].map((seat) => ({
      seat,
      name: `P${seat}`,
      kind: 'human',
      userId: `u${seat}`,
      vp: 0,
    })),
    turns: final.turn.number,
    createdAt: 0,
    finishedAt: 1,
  };
  return {
    states,
    replay: {
      summary,
      config: normalizeConfig({ players: 4 }),
      seed: SEED,
      engineVersion: ENGINE_VERSION,
      actions: game.log.map((s, i) => ({ seat: s.seat, action: s.action, ts: i * 1000 })),
    },
  };
}

describe('ReplayTimeline', () => {
  const { replay, states } = fixture();

  it('rebuilds an Open Seas game: sea board, pirate and scenario config', () => {
    const config = normalizeConfig({ players: 4, variant: 'seafarers', scenario: 'archipelago' });
    const tl = new ReplayTimeline({
      ...replay,
      summary: { ...replay.summary, variant: 'seafarers', status: 'abandoned', winner: null },
      config,
      actions: [],
    });
    expect(tl.failure).toBeNull();
    expect(tl.board.hexes.some((h) => h.terrain === 'sea')).toBe(true);
    const view = replayView(tl.stateAt(0), tl.board);
    expect(view.config.scenario).toBe('archipelago');
    expect(view.pirate).not.toBeNull();
    expect(view.ships).toEqual({});
    expect(view.players.every((p) => p.shipsLeft === 15 && p.bonusVP === 0)).toBe(true);
  });

  it('rebuilds every recorded state, in any access order', () => {
    const tl = new ReplayTimeline(replay, 8);
    expect(tl.length).toBe(replay.actions.length + 1);
    expect(tl.failure).toBeNull();
    expect(tl.versionMismatch).toBe(false);
    expect(tl.diverged).toBe(false);
    // Sequential, backwards and random jumps all match the original run.
    const order = [
      ...Array.from({ length: 20 }, (_, i) => i),
      tl.length - 1,
      5,
      0,
      17,
      Math.floor(tl.length / 2),
      Math.floor(tl.length / 2) - 1,
      tl.length - 2,
      3,
    ];
    for (const i of order) expect(tl.stateAt(i)).toEqual(states[i]);
  });

  it('clamps out-of-range frames', () => {
    const tl = new ReplayTimeline(replay);
    expect(tl.clamp(-4)).toBe(0);
    expect(tl.clamp(1e9)).toBe(tl.length - 1);
    expect(tl.clamp(Number.NaN)).toBe(0);
    expect(tl.stateAt(1e9)).toEqual(states[states.length - 1]);
  });

  it('records the action, seat and events of each frame', () => {
    const tl = new ReplayTimeline(replay);
    expect(tl.frames[0]).toMatchObject({ seat: null, action: null, events: [] });
    expect(tl.frames[1]!.action).toEqual(replay.actions[0]!.action);
    expect(tl.frames[1]!.seat).toBe(replay.actions[0]!.seat);
    expect(tl.frames[1]!.events.length).toBeGreaterThan(0);
    expect(tl.frames[3]!.ts).toBe(2000);
  });

  it('steps by turn between changes of the acting seat', () => {
    const tl = new ReplayTimeline(replay);
    expect(tl.turnStarts[0]).toBe(0);
    for (let k = 1; k < tl.turnStarts.length; k++) {
      const i = tl.turnStarts[k]!;
      const prev = tl.frames[i - 1]!;
      const cur = tl.frames[i]!;
      expect(cur.active !== prev.active || cur.turn !== prev.turn).toBe(true);
    }
    const t1 = tl.nextTurn(0);
    expect(t1).toBe(tl.turnStarts[1]);
    expect(tl.prevTurn(t1)).toBe(0);
    expect(tl.prevTurn(t1 + 1)).toBe(t1);
    expect(tl.nextTurn(tl.length - 1)).toBe(tl.length - 1);
    expect(tl.prevTurn(0)).toBe(0);
  });

  it('stops gracefully at an action this engine rejects', () => {
    const bad = structuredClone(replay);
    // Make action 10 illegal: replay it for a seat that is not on the move.
    const seat = bad.actions[10]!.seat;
    bad.actions[10] = { ...bad.actions[10]!, seat: (seat + 1) % 4 };
    bad.engineVersion = ENGINE_VERSION + 1;
    const tl = new ReplayTimeline(bad);
    expect(tl.failure?.actionIndex).toBe(10);
    expect(tl.failure?.message).toBeTruthy();
    expect(tl.length).toBe(11);
    expect(tl.versionMismatch).toBe(true);
    expect(tl.diverged).toBe(false);
    expect(tl.stateAt(10)).toEqual(states[10]);
  });

  it('flags a rebuild that does not reach the recorded winner', () => {
    const short = structuredClone(replay);
    short.actions = short.actions.slice(0, 30);
    short.summary.winner = 2;
    expect(new ReplayTimeline(short).diverged).toBe(true);
  });
});

describe('replayView', () => {
  it('reveals every hand and total VP mid-game', () => {
    const { states } = fixture(120);
    const s = states[states.length - 1]!;
    const v = replayView(s);
    expect(v.viewer).toBeNull();
    expect(v.legal).toBeNull();
    for (const p of v.players) {
      expect(p.resources).toEqual(s.players[p.seat]!.resources);
      expect(p.devCards).toEqual(s.players[p.seat]!.devCards);
      expect(p.totalVP).toBeGreaterThanOrEqual(p.publicVP);
    }
  });

  it('shares one board object across frames', () => {
    const { replay } = fixture(60);
    const tl = new ReplayTimeline(replay);
    const a = replayView(tl.stateAt(3), tl.board);
    const b = replayView(tl.stateAt(40), tl.board);
    expect(a.board).toBe(b.board);
    expect(b.board).toEqual(tl.stateAt(40).board);
  });

  it('activeSeat follows the setup order', () => {
    const { states } = fixture(3);
    const s0 = states[0]!;
    expect(activeSeat(s0)).toBe(s0.setupOrder[0]);
  });
});
