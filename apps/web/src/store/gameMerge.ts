import type { GameEvent } from '@hexhaven/engine';
import type { GameStatePayload } from '@hexhaven/shared';

export const LOG_CAP = 200;

export interface LogEntry {
  /** Client-local monotonically increasing key. */
  key: number;
  version: number;
  event: GameEvent;
}

export interface GameSlice {
  payload: GameStatePayload | null;
  log: LogEntry[];
  /** serverNow - clientNow at receipt (ms). Add to Date.now() to get server time. */
  skewMs: number;
  nextKey: number;
}

export const emptyGameSlice = (): GameSlice => ({
  payload: null,
  log: [],
  skewMs: 0,
  nextKey: 1,
});

/**
 * Fold an incoming `game:state` (or `game:sync` ack) into the slice.
 * - stale versions of the same game are ignored;
 * - a different gameId resets the log;
 * - events are appended only when the version advances (a resync of the same version adds none);
 * - the log keeps the newest LOG_CAP entries.
 */
export function mergeGameState(prev: GameSlice, p: GameStatePayload, clientNow: number): GameSlice {
  const sameGame = prev.payload !== null && prev.payload.gameId === p.gameId;
  if (sameGame && p.version < prev.payload!.version) return prev;

  const fresh = sameGame && p.version > prev.payload!.version;
  let nextKey = prev.nextKey;
  const added: LogEntry[] = (sameGame && !fresh ? [] : p.events).map((event) => ({
    key: nextKey++,
    version: p.version,
    event,
  }));
  const base = sameGame ? prev.log : [];
  const log = added.length ? [...base, ...added].slice(-LOG_CAP) : base;

  return { payload: p, log, skewMs: p.serverNow - clientNow, nextKey };
}

/** Milliseconds left until `deadline` (server epoch ms), corrected for clock skew. */
export function remainingMs(deadline: number | null, skewMs: number, clientNow: number): number {
  if (deadline === null) return 0;
  return Math.max(0, deadline - (clientNow + skewMs));
}
