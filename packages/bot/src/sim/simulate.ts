import {
  applyAction,
  createGame,
  getPendingActors,
  nextFloat,
  normalizeConfig,
  seedRng,
  toPlayerView,
  totalVP,
  type Action,
  type GameState,
  type Seat,
} from '@hexhaven/engine';
import { decide, type BotDifficulty } from '../index';

export interface SimResult {
  seed: string;
  players: number;
  finished: boolean;
  winner: Seat | null;
  turns: number;
  steps: number;
  vp: number[];
}

export class SimError extends Error {
  constructor(
    message: string,
    readonly seed: string,
    readonly step: number,
    readonly action: Action | null,
  ) {
    super(message);
  }
}

/** Play one full bot-vs-bot game. Throws SimError if a bot proposes an illegal action. */
export function simulateGame(
  seed: string,
  players: number,
  opts: { maxSteps?: number; difficulty?: BotDifficulty[] } = {},
): SimResult {
  const maxSteps = opts.maxSteps ?? 5000;
  let state: GameState = createGame(normalizeConfig({ players }), seed);
  const rng = seedRng(`bots:${seed}`);
  const random = () => nextFloat(rng);
  let steps = 0;

  while (state.phase.kind !== 'gameOver' && steps < maxSteps) {
    const actors = getPendingActors(state);
    if (actors.length === 0) throw new SimError('no pending actors', seed, steps, null);
    // Non-current actors (discards, trade replies) go first so the active player isn't blocked.
    const actor = actors.find((s) => s !== state.turn.current) ?? actors[0]!;
    const view = toPlayerView(state, actor);
    const difficulty = opts.difficulty?.[actor] ?? 'normal';
    const action = decide(view, { difficulty, random });
    const res = applyAction(state, actor, action);
    if (!res.ok) {
      throw new SimError(
        `seat ${actor} in ${state.phase.kind}: ${res.error.code} ${res.error.message} for ${JSON.stringify(action)}`,
        seed,
        steps,
        action,
      );
    }
    state = res.state;
    steps++;
  }

  return {
    seed,
    players,
    finished: state.phase.kind === 'gameOver',
    winner: state.winner,
    turns: state.turn.number,
    steps,
    vp: state.players.map((p) => totalVP(state, p.seat)),
  };
}
