/** A deterministic late-game state for benchmarks and performance-sensitive tests. */
import { createGame, normalizeConfig } from '../game';
import { getPendingActors } from '../pending';
import { applyAction } from '../reducer';
import type { GameState, VariantId } from '../types';
import { pick, randomLegalAction, seededRandom } from './randomPlay';

/**
 * Play random legal moves from a fixed seed and return the last `main`-phase state seen before the
 * game ends (or after `maxSteps`): many roads and buildings, cards in hand, possibly open trades.
 */
export function lateGameState(
  players: number,
  variant: VariantId,
  seed = 'late-game',
  maxSteps = 4000,
): GameState {
  let state = createGame(normalizeConfig({ players, variant }), seed);
  const rnd = seededRandom(`${seed}/play`);
  let late = state;
  for (let i = 0; i < maxSteps && state.phase.kind !== 'gameOver'; i++) {
    const seat = pick(rnd, getPendingActors(state));
    const action = randomLegalAction(state, seat, rnd);
    if (!action) break;
    const res = applyAction(state, seat, action);
    if (!res.ok) throw new Error(res.error.message);
    state = res.state;
    if (state.phase.kind === 'main') late = state;
  }
  return late;
}
