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
  type VariantId,
} from '@hexhaven/engine';
import { BotPlayer, awaitingResponses, type BotDifficulty } from '../index';

export interface SimResult {
  seed: string;
  players: number;
  variant: VariantId;
  /** Open Seas scenario id (null for other variants). */
  scenario: string | null;
  finished: boolean;
  /** Stopped at `maxTurns` without a winner (a slow game, not a stuck one). */
  turnCapped: boolean;
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
  /** Ships built or placed (setup, purchase and road building). */
  shipsBuilt: number;
  /** Ship moves made. */
  shipMoves: number;
  /** Island bonuses awarded (one per seat per new island). */
  islandBonuses: number;
  /** Times the pirate was moved. */
  pirateMoves: number;
}

export interface SimOptions {
  /** Total action cap (a safety net; a stuck game normally trips `maxStepsPerTurn` first). */
  maxSteps?: number;
  /** Actions allowed within one turn before the game counts as stalled (SimError). */
  maxStepsPerTurn?: number;
  /** Turn number at which an unfinished game stops (reported as turn-capped, not stalled). */
  maxTurns?: number;
  difficulty?: BotDifficulty[];
  variant?: VariantId;
  scenario?: string;
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

/**
 * Play one full bot-vs-bot game. Throws SimError if a bot proposes an illegal action or the game
 * stalls (too many actions without the turn advancing, or the step cap).
 */
export function simulateGame(seed: string, players: number, opts: SimOptions = {}): SimResult {
  const maxSteps = opts.maxSteps ?? 20000;
  const maxStepsPerTurn = opts.maxStepsPerTurn ?? 600;
  const maxTurns = opts.maxTurns ?? 400;
  const config = normalizeConfig({
    players,
    ...(opts.variant && { variant: opts.variant }),
    ...(opts.scenario && { scenario: opts.scenario }),
  });
  let state: GameState = createGame(config, seed);
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
  let shipsBuilt = 0;
  let shipMoves = 0;
  let islandBonuses = 0;
  let pirateMoves = 0;
  let turnSteps = 0;
  let turnNumber = state.turn.number;

  while (state.phase.kind !== 'gameOver' && state.turn.number < maxTurns) {
    if (steps >= maxSteps) throw new SimError(`step cap ${maxSteps} reached`, seed, steps, null);
    if (state.turn.number !== turnNumber) {
      turnNumber = state.turn.number;
      turnSteps = 0;
    } else if (++turnSteps > maxStepsPerTurn) {
      throw new SimError(
        `stalled: ${maxStepsPerTurn} actions in turn ${turnNumber} (${state.phase.kind})`,
        seed,
        steps,
        null,
      );
    }
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
      } else if ((e.type === 'built' || e.type === 'setupPlaced') && e.kind === 'ship') {
        shipsBuilt++;
      } else if (e.type === 'shipMoved') shipMoves++;
      else if (e.type === 'islandBonus') islandBonuses++;
      else if (e.type === 'pirateMoved') pirateMoves++;
    }
    state = res.state;
    steps++;
  }

  return {
    seed,
    players,
    variant: config.variant,
    scenario: config.scenario ?? null,
    finished: state.phase.kind === 'gameOver',
    turnCapped: state.phase.kind !== 'gameOver',
    winner: state.winner,
    turns: state.turn.number,
    steps,
    vp: state.players.map((p) => totalVP(state, p.seat)),
    tradesOffered,
    countersOffered,
    tradesCompleted,
    countersCompleted,
    shipsBuilt,
    shipMoves,
    islandBonuses,
    pirateMoves,
  };
}
