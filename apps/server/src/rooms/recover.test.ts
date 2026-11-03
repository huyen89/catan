import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION, type GameState } from '@hexhaven/engine';
import type { Repos } from '../db';
import type { ActionRow } from '../db/games';
import { realEngine } from './engineApi';
import { recoverGameState } from './GameRunner';

/** A snapshot as an ENGINE_VERSION 1 server wrote it: none of the Open Seas fields. */
function oldSnapshot(): GameState {
  const s = realEngine.createGame(realEngine.normalizeConfig({ players: 3 }), 'old');
  s.phase = { kind: 'preRoll' };
  const raw = JSON.parse(JSON.stringify(s)) as Record<string, unknown>;
  for (const k of ['ships', 'pirate', 'islandBonus']) delete raw[k];
  raw.engineVersion = 1;
  const turn = raw.turn as Record<string, unknown>;
  delete turn.shipMoved;
  delete turn.newShips;
  for (const p of raw.players as Array<Record<string, unknown>>) {
    delete p.shipsLeft;
    delete p.bonusVP;
  }
  return raw as unknown as GameState;
}

describe('recoverGameState', () => {
  it('upgrades an old snapshot before replaying the action log', () => {
    const snapshot = oldSnapshot();
    const log: ActionRow[] = [
      { idx: 0, seat: 0, actor: 'human', action: { type: 'ROLL' }, events: [], ts: 0 },
    ];
    const repos = {
      games: {
        latestSnapshot: () => snapshot,
        actionsFrom: (_id: string, from: number) => log.filter((a) => a.idx >= from),
      },
    } as unknown as Repos;
    const state = recoverGameState(realEngine, repos, 'g1');
    expect(state.version).toBe(1);
    expect(state.engineVersion).toBe(ENGINE_VERSION);
    expect(state.ships).toEqual({});
    expect(state.pirate).toBeNull();
    expect(state.players.every((p) => p.shipsLeft === 0 && p.bonusVP === 0)).toBe(true);
  });
});
