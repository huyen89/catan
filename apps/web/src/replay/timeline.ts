/**
 * Client-side replay reconstruction: createGame(config, seed) + applyAction for every recorded
 * action. One pass validates the log and records per-frame metadata; full states are kept only
 * at checkpoints and rebuilt on demand from the nearest one (with a one-entry cache so sequential
 * playback costs a single applyAction per step).
 *
 * Frame i is the state after the first i actions (frame 0 = the fresh game).
 */
import {
  ENGINE_VERSION,
  applyAction,
  createGame,
  toPlayerView,
  totalVP,
  type Action,
  type Board,
  type GameEvent,
  type GameState,
  type PlayerView,
  type Seat,
} from '@hexhaven/engine';
import type { ReplayResponse } from '@hexhaven/shared';

export const CHECKPOINT_EVERY = 32;

export interface ReplayFailure {
  /** Index (0-based) of the recorded action that could not be applied. */
  actionIndex: number;
  message: string;
}

export interface FrameMeta {
  /** Seat that made the action leading to this frame (null for frame 0). */
  seat: Seat | null;
  action: Action | null;
  /** Events produced by that action (unredacted: the game is over). */
  events: GameEvent[];
  ts: number | null;
  /** Regular turn number (0 during setup). */
  turn: number;
  /** Seat whose move it is in this frame. */
  active: Seat | null;
}

/** Whose move a state is waiting for (setup order during setup, the special builder, …). */
export function activeSeat(s: GameState): Seat | null {
  switch (s.phase.kind) {
    case 'setup':
      return s.setupOrder[s.phase.index] ?? null;
    case 'specialBuild':
      return s.phase.seat;
    case 'gameOver':
      return null;
    default:
      return s.turn.current;
  }
}

export class ReplayTimeline {
  /** Number of frames (applied actions + 1). */
  readonly length: number;
  readonly frames: readonly FrameMeta[];
  /** Frame indices where a new player's move starts (always includes 0). */
  readonly turnStarts: readonly number[];
  /** Set when an action failed to apply; the timeline stops just before it. */
  readonly failure: ReplayFailure | null;
  /** The recording's engine version differs from this client's. */
  readonly versionMismatch: boolean;
  /** The rebuilt game does not end with the recorded winner. */
  readonly diverged: boolean;
  /** The game's board (fixed for the whole game), shared by every frame's view. */
  readonly board: Board;

  private readonly actions: ReplayResponse['actions'];
  private readonly checkpoints = new Map<number, GameState>();
  private readonly every: number;
  private cache: { index: number; state: GameState } | null = null;

  constructor(replay: ReplayResponse, checkpointEvery = CHECKPOINT_EVERY) {
    this.every = Math.max(1, checkpointEvery);
    this.actions = replay.actions;
    this.versionMismatch = replay.engineVersion !== ENGINE_VERSION;

    let state = createGame(replay.config, replay.seed);
    this.board = structuredClone(state.board);
    const frames: FrameMeta[] = [
      {
        seat: null,
        action: null,
        events: [],
        ts: null,
        turn: state.turn.number,
        active: activeSeat(state),
      },
    ];
    const turnStarts = [0];
    this.checkpoints.set(0, state);
    let failure: ReplayFailure | null = null;

    for (let i = 0; i < replay.actions.length; i++) {
      const rec = replay.actions[i]!;
      const res = applyAction(state, rec.seat, rec.action);
      if (!res.ok) {
        failure = { actionIndex: i, message: res.error.message };
        break;
      }
      const prev = frames[frames.length - 1]!;
      state = res.state;
      const meta: FrameMeta = {
        seat: rec.seat,
        action: rec.action,
        events: res.events,
        ts: rec.ts,
        turn: state.turn.number,
        active: activeSeat(state),
      };
      const index = frames.push(meta) - 1;
      if (meta.active !== null && (meta.active !== prev.active || meta.turn !== prev.turn))
        turnStarts.push(index);
      if (index % this.every === 0) this.checkpoints.set(index, state);
    }

    this.frames = frames;
    this.length = frames.length;
    this.turnStarts = turnStarts;
    this.failure = failure;
    const last = this.length - 1;
    this.cache = { index: last, state };
    const winner = replay.summary.winner;
    this.diverged =
      failure === null &&
      replay.summary.status === 'finished' &&
      winner !== null &&
      !(state.phase.kind === 'gameOver' && state.phase.winner === winner);
  }

  /** Clamp any number to a valid frame index. */
  clamp(i: number): number {
    if (!Number.isFinite(i)) return 0;
    return Math.min(this.length - 1, Math.max(0, Math.trunc(i)));
  }

  /** Full game state at frame `i` (rebuilt from the nearest checkpoint, then cached). */
  stateAt(i: number): GameState {
    const index = this.clamp(i);
    if (this.cache?.index === index) return this.cache.state;
    let from: number;
    let state: GameState;
    if (this.cache && this.cache.index < index && index - this.cache.index <= this.every) {
      from = this.cache.index;
      state = this.cache.state;
    } else {
      from = Math.floor(index / this.every) * this.every;
      state = this.checkpoints.get(from)!;
    }
    for (let k = from; k < index; k++) {
      const rec = this.actions[k]!;
      const res = applyAction(state, rec.seat, rec.action);
      // The constructor already applied these successfully; engine is deterministic.
      if (!res.ok) throw new Error(`Replay action ${k} failed on rebuild: ${res.error.message}`);
      state = res.state;
    }
    this.cache = { index, state };
    return state;
  }

  /** First frame of the next / previous player's move from `i`. */
  nextTurn(i: number): number {
    return this.turnStarts.find((t) => t > i) ?? this.length - 1;
  }
  prevTurn(i: number): number {
    for (let k = this.turnStarts.length - 1; k >= 0; k--)
      if (this.turnStarts[k]! < i) return this.turnStarts[k]!;
    return 0;
  }
}

/**
 * A spectator view with every hand revealed (replays are only served for finished games).
 * Pass the timeline's `board` so every frame shares one board object (the board never changes
 * during a game) and memos keyed on it stay valid while stepping.
 */
export function replayView(state: GameState, board?: Board): PlayerView {
  const view = toPlayerView(state, null);
  if (board) view.board = board;
  view.players = view.players.map((p) => {
    const full = state.players[p.seat]!;
    return {
      ...p,
      resources: { ...full.resources },
      devCards: [...full.devCards],
      newDevCards: [...full.newDevCards],
      totalVP: totalVP(state, p.seat),
    };
  });
  return view;
}
