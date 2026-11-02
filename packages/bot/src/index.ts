import type { Action, PlayerView } from '@hexhaven/engine';

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotOptions {
  difficulty: BotDifficulty;
  /** Random source in [0,1). Server passes Math.random; the simulator passes a seeded RNG. */
  random: () => number;
}

/**
 * Decide the next action for `view.viewer` given ONLY its redacted view (no hidden info).
 * Must always return an action that is legal in `view` when the viewer is a pending actor.
 * M0 stub — implemented by workstream B.
 */
export function decide(view: PlayerView, _opts: BotOptions): Action {
  throw new Error(`bot.decide not implemented (seat ${view.viewer})`);
}
