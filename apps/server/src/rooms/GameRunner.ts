import type { Action, ApplyResult, GameEvent, GameState, PlayerView, Seat } from '@hexhaven/engine';
import type { BotDifficulty, GameStatePayload } from '@hexhaven/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Repos } from '../db';
import type { Actor } from '../db/games';
import { AppError } from '../errors';
import { awaitingResponses } from '@hexhaven/bot';
import type { BotFactory, EngineApi, SeatBot } from './engineApi';
import { fallbackActions } from './fallback';

/** What the runner needs to know about a seat. Owned and mutated by the room. */
export interface RunnerSeat {
  kind: 'open' | 'human' | 'bot';
  userId: string | null;
  controller: 'human' | 'bot';
  connected: boolean;
  botDifficulty: BotDifficulty;
}

/** Callbacks into the owning room. None of them may call back into the runner synchronously. */
export interface RunnerHost {
  readonly roomId: string;
  seats(): readonly RunnerSeat[];
  /** Seconds for a main turn; 0 disables every timer. */
  turnTimerSec(): number;
  /** Change who drives a seat and broadcast the room state. */
  setController(seat: Seat, controller: 'human' | 'bot'): void;
  /** Send a per-member game:state; `build` is called once per member userId. */
  broadcastGame(build: (userId: string) => GameStatePayload): void;
  onGameOver(winner: Seat | null): void;
}

export interface RunnerOptions {
  gameId: string;
  state: GameState;
  engine: EngineApi;
  bots: BotFactory;
  repos: Repos;
  host: RunnerHost;
  log: FastifyBaseLogger;
  botDelayMs: number;
  /**
   * How long an active bot waits for answers to its own open offer before it moves on (capped
   * by the turn deadline); 0 = it never waits.
   */
  tradeResponseMs?: number;
  random?: () => number;
  now?: () => number;
  discardMs?: number;
  specialBuildMs?: number;
}

/** Seconds-free defaults for decisions that don't use the main turn timer. */
export const DISCARD_MS = 30_000;
export const SPECIAL_BUILD_MS = 20_000;
/** Consecutive timeouts after which a human seat is handed to the bot (AFK). */
export const AFK_TIMEOUTS = 2;
/** Bot attempts per (seat, version) before the scheduler gives up on that state. */
export const MAX_BOT_ATTEMPTS = 3;

interface TurnTimer {
  key: string;
  seats: Seat[];
  durationMs: number;
  deadline: number;
  /** Remaining ms while paused. */
  remaining: number | null;
  handle: NodeJS.Timeout | null;
  expired: boolean;
}

interface TimedDecision {
  key: string;
  seats: Seat[];
  ms: number;
}

/**
 * Drives one game: serialises actions through a promise queue, persists them, fans out redacted
 * views, runs bots for bot-controlled pending seats, and enforces turn timers.
 */
export class GameRunner {
  readonly gameId: string;
  private current: GameState;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly botTimers = new Map<Seat, NodeJS.Timeout>();
  private readonly botAttempts = new Map<Seat, { version: number; count: number }>();
  private readonly timeouts = new Map<Seat, number>();
  private timer: TurnTimer | null = null;
  private lastDeadline: number | null = null;
  private pausedFlag = false;
  private closed = false;
  /**
   * One long-lived bot per bot-driven seat; replaced whenever the seat changes hands. `reclaimedTurn`
   * marks a bot whose seat its human took back: covering the seat again in that same turn reuses
   * it (keeping its per-turn trade memory), a later turn gets a fresh one.
   */
  private readonly bots = new Map<Seat, { key: string; bot: SeatBot; reclaimedTurn?: number }>();
  /**
   * Response windows of the active bot's offers this turn: offer id → wait deadline. Kept for the
   * whole turn (dev-card detours, other offers closing) so an offer is only ever waited on once.
   */
  private waits: { turn: number; seat: Seat; until: Map<number, number> } | null = null;
  /** Wakes the scheduler when the current hold ends. */
  private holdTimer: { handle: NodeJS.Timeout; at: number } | null = null;
  /**
   * Redacted views of the current version, one per viewer seat (null = spectator). A broadcast,
   * catch-up syncs and bot turns at the same version all share these instead of re-redacting.
   */
  private views: { version: number; bySeat: Map<Seat | null, PlayerView> } = {
    version: -1,
    bySeat: new Map(),
  };

  private readonly engine: EngineApi;
  private readonly host: RunnerHost;
  private readonly now: () => number;
  private readonly random: () => number;

  constructor(private readonly opts: RunnerOptions) {
    this.gameId = opts.gameId;
    this.current = opts.state;
    this.engine = opts.engine;
    this.host = opts.host;
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? Math.random;
  }

  get state(): GameState {
    return this.current;
  }

  get paused(): boolean {
    return this.pausedFlag;
  }

  get isOver(): boolean {
    return this.current.phase.kind === 'gameOver';
  }

  /** Start scheduling (call once after construction). */
  begin(): void {
    this.pausedFlag = this.computePaused();
    this.armTimer();
    this.emitState([]);
    this.scheduleBots();
  }

  /** Stop every timer. The runner keeps answering sync requests but never acts again. */
  close(): void {
    this.closed = true;
    this.clearBotTimers();
    this.clearHold();
    this.clearTurnTimer();
  }

  // ------------------------------------------------------------------ inputs

  /** A human submits an action for the seat they own. Resolves with the new version. */
  humanAction(
    userId: string,
    expectedVersion: number,
    action: Action,
  ): Promise<{ version: number }> {
    return this.enqueue(() => {
      if (this.closed && !this.isOver) throw new AppError('NO_GAME', 'Game is not running');
      const seat = this.seatOf(userId);
      if (seat === null) throw new AppError('NOT_SEATED', 'You do not have a seat in this game');
      if (this.isOver) throw new AppError('GAME_OVER', 'The game is over');
      if (this.host.seats()[seat]!.controller === 'bot') {
        // The owner is back: acting reclaims the seat from the AFK/disconnect bot.
        this.host.setController(seat, 'human');
        this.onReclaimed(seat);
      }
      if (expectedVersion !== this.current.version) {
        throw new AppError('STALE', `State moved on (now version ${this.current.version})`);
      }
      const res = this.apply(seat, action, 'human');
      if (!res.ok) throw new AppError(res.error.code, res.error.message);
      return { version: this.current.version };
    });
  }

  /**
   * Seat control/connection changed outside the runner (connect, disconnect, kick, grace expiry).
   * `reclaimed` marks a seat that just went back to its human owner.
   */
  refresh(reclaimed?: Seat): void {
    if (this.closed) return;
    this.pausedFlag = this.computePaused();
    if (reclaimed !== undefined) this.onReclaimed(reclaimed);
    if (this.pausedFlag) this.clearBotTimers();
    this.armTimer();
    this.scheduleBots();
    if (!this.pausedFlag && this.displayDeadline() !== this.lastDeadline) this.emitState([]);
  }

  /** Current state payload for one member (spectator view when they own no seat). */
  payloadFor(userId: string | null, events: GameEvent[] = []): GameStatePayload {
    return this.buildPayload(userId === null ? null : this.seatOf(userId), events);
  }

  /** Persist the current state as a snapshot so a restart does not have to replay the log. */
  snapshot(): void {
    if (!this.isOver) this.opts.repos.games.saveSnapshot(this.gameId, this.current);
  }

  /** TEST_MODE only: move resources from the bank to a hand, bump the version and broadcast. */
  testGive(seat: Seat, resources: Partial<Record<string, number>>): Promise<void> {
    return this.enqueue(() => {
      const next = structuredClone(this.current);
      const player = next.players[seat];
      if (!player) throw new AppError('BAD_SEAT', 'No such seat');
      for (const key of Object.keys(next.bank) as Array<keyof typeof next.bank>) {
        const n = Math.min(resources[key] ?? 0, next.bank[key]);
        next.bank[key] -= n;
        player.resources[key] += n;
      }
      next.version = this.current.version + 1;
      this.opts.repos.games.saveSnapshot(this.gameId, next);
      this.current = next;
      this.armTimer();
      this.emitState([]);
      this.scheduleBots();
    });
  }

  // ------------------------------------------------------------------ core

  private enqueue<T>(fn: () => T): Promise<T> {
    const p = this.queue.then(fn);
    this.queue = p.catch(() => undefined);
    return p;
  }

  /** Frozen while no seated human is connected. */
  private computePaused(): boolean {
    return !this.isOver && !this.host.seats().some((s) => s.kind === 'human' && s.connected);
  }

  private seatOf(userId: string): Seat | null {
    const i = this.host.seats().findIndex((s) => s.kind === 'human' && s.userId === userId);
    return i < 0 ? null : i;
  }

  private isBotControlled(seat: Seat): boolean {
    const s = this.host.seats()[seat];
    return !!s && (s.kind === 'bot' || s.controller === 'bot');
  }

  private isPending(seat: Seat): boolean {
    return this.engine.getPendingActors(this.current).includes(seat);
  }

  /** Apply, persist (one transaction), then update timers, fan out and schedule bots. */
  private apply(seat: Seat, action: Action, actor: Actor): ApplyResult {
    const prev = this.current;
    const res = this.engine.applyAction(prev, seat, action);
    if (!res.ok) return res;
    const next = res.state;
    const over = next.phase.kind === 'gameOver';
    const winner = over ? winnerOf(next) : null;
    const ts = this.now();
    const { repos } = this.opts;
    repos.tx(() => {
      repos.games.appendAction(this.gameId, {
        idx: prev.version,
        seat,
        actor,
        action,
        events: res.events,
        ts,
      });
      if (action.type === 'END_TURN' || over) {
        repos.games.saveSnapshot(this.gameId, next);
        if (next.turn.number !== prev.turn.number)
          repos.games.setTurns(this.gameId, next.turn.number);
      }
      if (over) {
        const end = res.events.find((e) => e.type === 'gameOver');
        repos.games.finish(this.gameId, {
          winner,
          now: ts,
          turns: next.turn.number,
          vp: end?.type === 'gameOver' ? end.vp : null,
        });
        repos.rooms.setStatus(this.host.roomId, 'finished', ts);
      }
    });
    this.current = next;
    if (actor === 'human') this.timeouts.delete(seat);
    if (over) {
      this.close();
      this.host.onGameOver(winner);
    } else {
      this.armTimer();
    }
    this.emitState(res.events);
    this.scheduleBots();
    return res;
  }

  /** Cached `toPlayerView` of the current state. Callers must treat the result as read-only. */
  viewFor(seat: Seat | null): PlayerView {
    if (this.views.version !== this.current.version) {
      this.views = { version: this.current.version, bySeat: new Map() };
    }
    let v = this.views.bySeat.get(seat);
    if (!v) {
      v = this.engine.toPlayerView(this.current, seat);
      this.views.bySeat.set(seat, v);
    }
    return v;
  }

  private buildPayload(seat: Seat | null, events: GameEvent[]): GameStatePayload {
    return {
      roomId: this.host.roomId,
      gameId: this.gameId,
      version: this.current.version,
      view: this.viewFor(seat),
      events: events
        .map((e) => this.engine.redactEvent(e, seat))
        .filter((e): e is GameEvent => e !== null),
      deadline: this.displayDeadline(),
      serverNow: this.now(),
    };
  }

  private emitState(events: GameEvent[]): void {
    this.lastDeadline = this.displayDeadline();
    const cache = new Map<Seat | null, GameStatePayload>();
    this.host.broadcastGame((userId) => {
      const seat = this.seatOf(userId);
      let p = cache.get(seat);
      if (!p) {
        p = this.buildPayload(seat, events);
        cache.set(seat, p);
      }
      return p;
    });
  }

  private onReclaimed(seat: Seat): void {
    const bot = this.bots.get(seat);
    if (bot) bot.reclaimedTurn = this.current.turn.number;
    this.timeouts.delete(seat);
    this.botAttempts.delete(seat);
    const t = this.botTimers.get(seat);
    if (t) clearTimeout(t);
    this.botTimers.delete(seat);
    // Give the returning player a full clock for the decision they now own.
    if (this.timer?.seats.includes(seat)) {
      if (this.timer.handle) clearTimeout(this.timer.handle);
      this.timer.handle = null;
      this.timer.expired = false;
      this.timer.deadline = this.now() + this.timer.durationMs;
      this.timer.remaining = null;
    }
  }

  // ------------------------------------------------------------------ bots

  private scheduleBots(): void {
    if (this.closed || this.pausedFlag || this.isOver) {
      this.clearBotTimers();
      this.clearHold();
      return;
    }
    const pending = new Set(this.engine.getPendingActors(this.current));
    if (this.holding()) pending.delete(this.current.turn.current);
    for (const [seat, t] of this.botTimers) {
      if (!pending.has(seat) || !this.isBotControlled(seat)) {
        clearTimeout(t);
        this.botTimers.delete(seat);
      }
    }
    for (const seat of pending) {
      if (!this.isBotControlled(seat) || this.botTimers.has(seat)) continue;
      const a = this.botAttempts.get(seat);
      if (a && a.version === this.current.version && a.count >= MAX_BOT_ATTEMPTS) continue;
      const handle: NodeJS.Timeout = setTimeout(() => {
        this.enqueue(() => this.runBot(seat, handle)).catch((e: unknown) =>
          this.opts.log.error({ err: e, gameId: this.gameId, seat }, 'bot turn crashed'),
        );
      }, this.botDelay());
      this.botTimers.set(seat, handle);
    }
  }

  /** Long-lived bot for a seat, created on first use and whenever its controller changes. */
  private botFor(seat: Seat): SeatBot {
    const s = this.host.seats()[seat]!;
    const key = `${s.kind}:${s.userId ?? ''}:${s.botDifficulty}`;
    let e = this.bots.get(seat);
    const stale =
      !e ||
      e.key !== key ||
      (e.reclaimedTurn !== undefined && e.reclaimedTurn !== this.current.turn.number);
    if (stale) {
      e = { key, bot: this.opts.bots({ difficulty: s.botDifficulty, random: this.random }) };
      this.bots.set(seat, e);
    }
    e!.reclaimedTurn = undefined;
    return e!.bot;
  }

  /**
   * True while the active, bot-driven seat should wait for answers to its own open offers: it is
   * not scheduled then, so responders (bots at their usual pace, humans) get a say. A responder
   * who countered has answered. Each offer gets one window of `tradeResponseMs` (capped by the
   * turn deadline) per turn; the wait ends early once every answer is in, and never applies while
   * the bot itself has a counter-offer to answer.
   */
  private holding(): boolean {
    const ms = this.opts.tradeResponseMs ?? 0;
    const s = this.current;
    const seat = s.turn.current;
    if (
      ms <= 0 ||
      s.phase.kind !== 'main' ||
      !this.isBotControlled(seat) ||
      !awaitingResponses(s, seat)
    ) {
      this.clearHold();
      return false;
    }
    if (this.waits?.turn !== s.turn.number || this.waits.seat !== seat) {
      this.waits = { turn: s.turn.number, seat, until: new Map() };
    }
    const me = String(seat);
    const askedToAnswer = s.trades.some(
      (t) => t.counterTo !== null && t.responses[me] === 'pending',
    );
    const unanswered = askedToAnswer
      ? []
      : s.trades.filter(
          (t) =>
            t.from === seat &&
            t.counterTo === null &&
            Object.entries(t.responses).some(
              ([r, v]) =>
                v === 'pending' &&
                !s.trades.some((c) => c.counterTo === t.id && String(c.from) === r),
            ),
        );
    const now = this.now();
    const t = this.timer;
    const left = !t ? Infinity : t.expired ? 0 : (t.remaining ?? t.deadline - now);
    let until = -Infinity;
    for (const o of unanswered) {
      let d = this.waits.until.get(o.id);
      if (d === undefined) this.waits.until.set(o.id, (d = now + Math.max(0, Math.min(ms, left))));
      until = Math.max(until, d);
    }
    if (until <= now) {
      this.clearHold();
      return false;
    }
    if (this.holdTimer?.at !== until) {
      this.clearHold();
      const handle = setTimeout(() => {
        this.enqueue(() => {
          if (this.holdTimer?.handle !== handle) return;
          this.holdTimer = null;
          this.scheduleBots();
        }).catch((e: unknown) =>
          this.opts.log.error({ err: e, gameId: this.gameId }, 'trade hold crashed'),
        );
      }, until - now);
      this.holdTimer = { handle, at: until };
    }
    return true;
  }

  private clearHold(): void {
    if (this.holdTimer) clearTimeout(this.holdTimer.handle);
    this.holdTimer = null;
  }

  private botDelay(): number {
    const base = this.opts.botDelayMs;
    return base <= 0 ? 0 : Math.round(base * (0.7 + 0.6 * this.random()));
  }

  private runBot(seat: Seat, handle: NodeJS.Timeout): void {
    if (this.botTimers.get(seat) !== handle) return; // cancelled or superseded
    this.botTimers.delete(seat);
    if (this.closed || this.pausedFlag || this.isOver) return;
    if (!this.isPending(seat) || !this.isBotControlled(seat)) return;

    const version = this.current.version;
    const view = this.viewFor(seat);
    let ok = false;
    try {
      const action = this.botFor(seat).decide(view);
      const res = this.apply(seat, action, 'bot');
      ok = res.ok;
      if (!res.ok)
        this.opts.log.warn(
          { gameId: this.gameId, seat, action, error: res.error },
          'bot proposed an illegal action',
        );
    } catch (e) {
      this.opts.log.error({ err: e, gameId: this.gameId, seat }, 'bot decide failed');
    }
    if (!ok) ok = this.tryFallbacks(seat, 'bot');
    if (!ok) {
      const prev = this.botAttempts.get(seat);
      const count = prev?.version === version ? prev.count + 1 : 1;
      this.botAttempts.set(seat, { version, count });
      this.opts.log.error({ gameId: this.gameId, seat, version, count }, 'bot is stuck');
      this.scheduleBots();
    }
  }

  private tryFallbacks(seat: Seat, actor: Actor): boolean {
    const view = this.viewFor(seat);
    for (const action of fallbackActions(view, seat)) {
      try {
        if (this.apply(seat, action, actor).ok) return true;
      } catch (e) {
        this.opts.log.error({ err: e, gameId: this.gameId, seat, action }, 'fallback failed');
        return false;
      }
    }
    return false;
  }

  private clearBotTimers(): void {
    for (const t of this.botTimers.values()) clearTimeout(t);
    this.botTimers.clear();
  }

  // ------------------------------------------------------------------ turn timer

  private timedDecision(): TimedDecision | null {
    const sec = this.host.turnTimerSec();
    const s = this.current;
    if (sec <= 0) return null;
    const p = s.phase;
    switch (p.kind) {
      case 'gameOver':
        return null;
      case 'discard':
        return {
          key: `discard:${s.turn.number}`,
          seats: this.engine.getPendingActors(s),
          ms: this.opts.discardMs ?? DISCARD_MS,
        };
      case 'goldChoice':
        // Like a discard, every owed seat chooses at once. Setup gold (one per second settlement)
        // shares the turn number, so the setup index keeps each choice's timer separate.
        return {
          key: `goldChoice:${s.turn.number}:${p.resume.kind === 'setup' ? p.resume.index : p.resume.kind}`,
          seats: this.engine.getPendingActors(s),
          ms: this.opts.discardMs ?? DISCARD_MS,
        };
      case 'specialBuild':
        return {
          key: `specialBuild:${s.turn.number}:${p.seat}`,
          seats: [p.seat],
          ms: this.opts.specialBuildMs ?? SPECIAL_BUILD_MS,
        };
      case 'setup':
        return {
          key: `setup:${p.index}:${p.step}`,
          seats: this.engine.getPendingActors(s),
          ms: sec * 1000,
        };
      default:
        return { key: `${p.kind}:${s.turn.number}`, seats: [s.turn.current], ms: sec * 1000 };
    }
  }

  private armTimer(): void {
    if (this.closed) return;
    const d = this.timedDecision();
    if (!d) {
      this.clearTurnTimer();
      return;
    }
    if (!this.timer || this.timer.key !== d.key) {
      this.clearTurnTimer();
      this.timer = {
        key: d.key,
        seats: d.seats,
        durationMs: d.ms,
        deadline: this.now() + d.ms,
        remaining: null,
        handle: null,
        expired: false,
      };
    } else {
      this.timer.seats = d.seats;
    }
    const t = this.timer;
    if (this.pausedFlag) {
      // Freeze: remember how much time was left.
      if (t.remaining === null) t.remaining = Math.max(0, t.deadline - this.now());
      if (t.handle) clearTimeout(t.handle);
      t.handle = null;
      return;
    }
    if (t.remaining !== null) {
      t.deadline = this.now() + t.remaining;
      t.remaining = null;
    }
    if (!t.handle && !t.expired) {
      const key = t.key;
      t.handle = setTimeout(
        () => {
          this.enqueue(() => this.onExpire(key)).catch((e: unknown) =>
            this.opts.log.error({ err: e, gameId: this.gameId }, 'turn timeout crashed'),
          );
        },
        Math.max(0, t.deadline - this.now()),
      );
    }
  }

  private clearTurnTimer(): void {
    if (this.timer?.handle) clearTimeout(this.timer.handle);
    this.timer = null;
  }

  private displayDeadline(): number | null {
    const t = this.timer;
    if (!t || this.pausedFlag || t.expired) return null;
    const seats = this.host.seats();
    return t.seats.some((s) => seats[s]?.kind === 'human' && seats[s]?.controller === 'human')
      ? t.deadline
      : null;
  }

  private onExpire(key: string): void {
    const t = this.timer;
    if (!t || t.key !== key || this.closed || this.pausedFlag) return;
    t.handle = null;
    t.expired = true;
    for (const seat of [...t.seats]) {
      if (this.timer !== t || this.closed) break; // decision resolved by a previous timeout
      const s = this.host.seats()[seat];
      if (s?.kind !== 'human' || s.controller !== 'human' || !this.isPending(seat)) continue;
      this.timeoutSeat(seat);
    }
  }

  private timeoutSeat(seat: Seat): void {
    const count = (this.timeouts.get(seat) ?? 0) + 1;
    this.timeouts.set(seat, count);
    if (count >= AFK_TIMEOUTS) this.host.setController(seat, 'bot');

    const s = this.current;
    let action: Action | null = null;
    if (s.phase.kind === 'main' && s.turn.current === seat) action = { type: 'END_TURN' };
    else if (s.phase.kind === 'specialBuild') action = { type: 'PASS_SPECIAL_BUILD' };
    else {
      try {
        const view = this.viewFor(seat);
        // A one-off stand-in: the seat's owner is still in charge of the rest of the turn.
        action = this.opts.bots({ difficulty: 'normal', random: this.random }).decide(view);
      } catch (e) {
        this.opts.log.warn({ err: e, gameId: this.gameId, seat }, 'timeout bot decide failed');
      }
    }
    let ok = action ? this.apply(seat, action, 'timeout').ok : false;
    if (!ok) ok = this.tryFallbacks(seat, 'timeout');
    // One timeout settles the whole decision: the second free road/ship of road building and the
    // steal after a robber or pirate move keep the timer's key (or get a fresh one counted as
    // another timeout), so finish them here instead of leaving the seat without a deadline.
    for (let i = 0; ok && i < 4 && this.continuesDecision(seat); i++) {
      ok = this.tryFallbacks(seat, 'timeout');
    }
    if (!ok) {
      this.opts.log.error({ gameId: this.gameId, seat }, 'no timeout action accepted');
      this.host.setController(seat, 'bot');
      this.scheduleBots();
    }
  }

  private continuesDecision(seat: Seat): boolean {
    const k = this.current.phase.kind;
    return !this.closed && (k === 'roadBuilding' || k === 'steal') && this.isPending(seat);
  }
}

function winnerOf(s: GameState): Seat | null {
  if (s.winner !== null) return s.winner;
  return s.phase.kind === 'gameOver' ? s.phase.winner : null;
}

/** Rebuild a game's state from its latest snapshot plus the actions recorded after it. */
export function recoverGameState(engine: EngineApi, repos: Repos, gameId: string): GameState {
  const snapshot = repos.games.latestSnapshot(gameId);
  if (!snapshot) throw new Error(`game ${gameId} has no snapshot`);
  // Snapshots written by an older engine lack newer fields.
  let state = engine.upgradeState(snapshot);
  for (const a of repos.games.actionsFrom(gameId, snapshot.version)) {
    if (a.idx !== state.version) {
      throw new Error(`game ${gameId}: action log gap at ${a.idx} (state v${state.version})`);
    }
    const r = engine.applyAction(state, a.seat, a.action);
    if (!r.ok) throw new Error(`game ${gameId}: replay of #${a.idx} failed: ${r.error.code}`);
    state = r.state;
  }
  return state;
}
