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
import { BotPlayer, awaitingResponses, type BotDifficulty } from '../index';

export interface SimResult {
  seed: string;
  players: number;
  finished: boolean;
  winner: Seat | null;
  turns: number;
  steps: number;
  vp: number[];
  /** Domestic offers opened by the active player (counter-offers excluded). */
  tradesOffered: number;
  /** Counter-offers made in reply to an offer. */
  countersOffered: number;
  /** Domestic trades executed (confirmed offers and accepted counters). */
  tradesCompleted: number;
  /** Of `tradesCompleted`, how many were accepted counter-offers. */
  countersCompleted: number;
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
  // Separate stream for scheduling so bot choices don't shift when the interleaving does.
  const sched = seedRng(`schedule:${seed}`);
  const bots = state.players.map(
    (p) => new BotPlayer({ difficulty: opts.difficulty?.[p.seat] ?? 'normal', random }),
  );
  let steps = 0;
  let tradesOffered = 0;
  let countersOffered = 0;
  let tradesCompleted = 0;
  const counterIds = new Set<number>();
  let countersCompleted = 0;

  while (state.phase.kind !== 'gameOver' && steps < maxSteps) {
    const actors = getPendingActors(state);
    if (actors.length === 0) throw new SimError('no pending actors', seed, steps, null);
    // Seats act in random order, as on a real table, except that the active player is held
    // while its own offer still awaits answers (what the server does for bots).
    const ready = awaitingResponses(state, state.turn.current)
      ? actors.filter((s) => s !== state.turn.current)
      : actors;
    if (ready.length === 0)
      throw new SimError('active player held with no responders', seed, steps, null);
    const actor = ready[Math.floor(nextFloat(sched) * ready.length)]!;
    const view = toPlayerView(state, actor);
    const action = bots[actor]!.decide(view);
    const res = applyAction(state, actor, action);
    if (!res.ok) {
      throw new SimError(
        `seat ${actor} in ${state.phase.kind}: ${res.error.code} ${res.error.message} for ${JSON.stringify(action)}`,
        seed,
        steps,
        action,
      );
    }
    for (const e of res.events) {
      if (e.type === 'tradeOffered') {
        if (e.offer.counterTo === null) tradesOffered++;
        else {
          countersOffered++;
          counterIds.add(e.offer.id);
        }
      } else if (e.type === 'traded') {
        tradesCompleted++;
        if (counterIds.has(e.offerId)) countersCompleted++;
      }
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
    tradesOffered,
    countersOffered,
    tradesCompleted,
    countersCompleted,
  };
}
