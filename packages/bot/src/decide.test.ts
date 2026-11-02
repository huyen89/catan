import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  getPendingActors,
  normalizeConfig,
  resourcesOf,
  toPlayerView,
  type GameState,
} from '@hexhaven/engine';
import { decide, type BotDifficulty } from './index';
import { simulateGame } from './sim/simulate';

const rnd = () => 0.42;

/** Let bots play until seat 0 is in its main phase. */
function playUntilMain(seed: string): GameState {
  let s = createGame(normalizeConfig({ players: 4 }), seed);
  for (let i = 0; i < 2000; i++) {
    if (s.phase.kind === 'main' && s.turn.current === 0) return s;
    const actor = getPendingActors(s)[0]!;
    const r = applyAction(
      s,
      actor,
      decide(toPlayerView(s, actor), { difficulty: 'normal', random: rnd }),
    );
    if (!r.ok) throw new Error(r.error.message);
    s = r.state;
  }
  throw new Error('never reached main for seat 0');
}

describe('bot decisions', () => {
  it('answers a player trade offer with a legal response', () => {
    let s = playUntilMain('trade-test');
    // Make the offer valid: seat 0 gives 1 of something it has for 1 of something else.
    s.players[0]!.resources = resourcesOf({ brick: 2 });
    s.players[1]!.resources = resourcesOf({ ore: 2 });
    const r = applyAction(s, 0, {
      type: 'OFFER_TRADE',
      give: resourcesOf({ brick: 1 }),
      want: resourcesOf({ ore: 1 }),
      to: [1],
      counterTo: null,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    for (const difficulty of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      const action = decide(toPlayerView(s, 1), { difficulty, random: rnd });
      expect(action.type).toBe('RESPOND_TRADE');
      expect(applyAction(s, 1, action).ok).toBe(true);
    }
  });

  it('plays legal moves at every difficulty, including the special build phase', () => {
    const mixes: BotDifficulty[][] = [
      ['easy', 'normal', 'hard', 'easy', 'normal', 'hard'],
      ['hard', 'hard', 'easy', 'easy', 'normal', 'normal'],
    ];
    for (const [i, difficulty] of mixes.entries()) {
      for (const players of [4, 6]) {
        const r = simulateGame(`mix-${i}-${players}`, players, { difficulty });
        expect(r.finished).toBe(true);
      }
    }
  });
});
