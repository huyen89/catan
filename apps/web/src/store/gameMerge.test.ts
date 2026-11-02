import { describe, expect, it } from 'vitest';
import { createGame, normalizeConfig, toPlayerView, type GameEvent } from '@hexhaven/engine';
import type { GameStatePayload } from '@hexhaven/shared';
import { LOG_CAP, emptyGameSlice, mergeGameState, remainingMs } from './gameMerge';

const view = toPlayerView(createGame(normalizeConfig({ players: 3 }), 'merge'), 0);
const ev = (turn: number): GameEvent => ({ type: 'turnStarted', seat: 0, turn });

function payload(
  version: number,
  events: GameEvent[],
  gameId = 'g1',
  serverNow = 1000,
): GameStatePayload {
  return {
    roomId: 'r',
    gameId,
    version,
    view: { ...view, version },
    events,
    deadline: null,
    serverNow,
  };
}

describe('mergeGameState', () => {
  it('stores the payload, appends events and records clock skew', () => {
    const s1 = mergeGameState(emptyGameSlice(), payload(1, [ev(1)], 'g1', 5000), 4000);
    expect(s1.payload?.version).toBe(1);
    expect(s1.log.map((l) => l.event)).toEqual([ev(1)]);
    expect(s1.skewMs).toBe(1000);
    const s2 = mergeGameState(s1, payload(2, [ev(2), ev(3)]), 0);
    expect(s2.log.map((l) => l.event)).toEqual([ev(1), ev(2), ev(3)]);
    expect(new Set(s2.log.map((l) => l.key)).size).toBe(3);
  });

  it('ignores stale versions and does not duplicate events on a same-version resync', () => {
    const s1 = mergeGameState(emptyGameSlice(), payload(5, [ev(5)]), 0);
    expect(mergeGameState(s1, payload(4, [ev(4)]), 0)).toBe(s1);
    const s2 = mergeGameState(s1, payload(5, [ev(5)]), 0);
    expect(s2.log).toHaveLength(1);
  });

  it('resets the log for a different game', () => {
    const s1 = mergeGameState(emptyGameSlice(), payload(9, [ev(1)]), 0);
    const s2 = mergeGameState(s1, payload(1, [ev(2)], 'g2'), 0);
    expect(s2.payload?.gameId).toBe('g2');
    expect(s2.log.map((l) => l.event)).toEqual([ev(2)]);
  });

  it('caps the log', () => {
    let s = emptyGameSlice();
    for (let v = 1; v <= LOG_CAP + 50; v++) s = mergeGameState(s, payload(v, [ev(v)]), 0);
    expect(s.log).toHaveLength(LOG_CAP);
    expect(s.log.at(-1)?.event).toEqual(ev(LOG_CAP + 50));
  });
});

describe('remainingMs', () => {
  it('corrects for skew and never goes negative', () => {
    // server is 2s ahead of the client
    expect(remainingMs(12_000, 2000, 5000)).toBe(5000);
    expect(remainingMs(1000, 0, 5000)).toBe(0);
    expect(remainingMs(null, 0, 0)).toBe(0);
  });
});
