import type { GameConfig } from '@hexhaven/engine';
import {
  PLAYER_COLORS,
  type BotDifficulty,
  type RoomInfo,
  type RoomSettings,
  type RoomStatus,
  type SeatInfo,
} from '@hexhaven/shared';
import type { RoomRow } from '../db/rooms';
import { AppError } from '../errors';
import type { GameRunner, RunnerSeat } from './GameRunner';

export interface SeatState {
  kind: 'open' | 'human' | 'bot';
  userId: string | null;
  name: string;
  avatarUrl: string | null;
  ready: boolean;
  controller: 'human' | 'bot';
  botDifficulty: BotDifficulty;
  inVoice: boolean;
  muted: boolean;
}

export interface Member {
  userId: string;
  name: string;
  avatarUrl: string | null;
  sockets: Set<string>;
}

export interface Identity {
  userId: string;
  name: string;
  avatarUrl: string | null;
}

export const openSeat = (): SeatState => ({
  kind: 'open',
  userId: null,
  name: '',
  avatarUrl: null,
  ready: false,
  controller: 'human',
  botDifficulty: 'normal',
  inVoice: false,
  muted: false,
});

const botSeat = (index: number, difficulty: BotDifficulty): SeatState => ({
  ...openSeat(),
  kind: 'bot',
  name: `Bot ${index + 1}`,
  controller: 'bot',
  botDifficulty: difficulty,
});

const humanSeat = (who: Identity): SeatState => ({
  ...openSeat(),
  kind: 'human',
  userId: who.userId,
  name: who.name,
  avatarUrl: who.avatarUrl,
});

/**
 * In-memory room: seats, members (connected users) and lobby rules. Pure state + validation;
 * IO (persistence, sockets, timers) lives in RoomManager.
 */
export class Room {
  hostUserId: string;
  status: RoomStatus;
  settings: RoomSettings;
  seats: SeatState[];
  gameId: string | null = null;
  runner: GameRunner | null = null;
  readonly members = new Map<string, Member>();
  readonly kicked = new Set<string>();
  /** Per-user disconnect grace timers. */
  readonly graceTimers = new Map<string, NodeJS.Timeout>();
  idleTimer: NodeJS.Timeout | null = null;
  /** TEST_MODE: seed for the next game start. */
  testSeed: string | null = null;

  constructor(
    readonly id: string,
    readonly code: string,
    hostUserId: string,
    settings: RoomSettings,
    readonly createdAt: number,
    status: RoomStatus = 'lobby',
    seats?: SeatState[],
  ) {
    this.hostUserId = hostUserId;
    this.settings = settings;
    this.status = status;
    this.seats = seats ?? Array.from({ length: settings.maxSeats }, openSeat);
  }

  static fromRow(
    row: RoomRow,
    lookup: (userId: string) => Identity | null,
    kicked: readonly string[] = [],
  ): Room {
    const seats = Array.from({ length: row.settings.maxSeats }, (_, i): SeatState => {
      const s = row.seats.find((x) => x.idx === i);
      if (!s || s.kind === 'open' || (s.kind === 'human' && !s.userId)) return openSeat();
      if (s.kind === 'bot') return { ...botSeat(i, s.botDifficulty), name: s.name };
      const who = lookup(s.userId!) ?? { userId: s.userId!, name: s.name, avatarUrl: null };
      return { ...humanSeat(who), botDifficulty: s.botDifficulty };
    });
    const room = new Room(
      row.id,
      row.code,
      row.hostUserId,
      row.settings,
      row.createdAt,
      row.status,
      seats,
    );
    for (const id of kicked) room.kicked.add(id);
    return room;
  }

  toRow(now: number): Omit<RoomRow, 'createdAt'> & { createdAt: number } {
    return {
      id: this.id,
      code: this.code,
      hostUserId: this.hostUserId,
      status: this.status,
      settings: this.settings,
      createdAt: this.createdAt,
      updatedAt: now,
      seats: this.seats.map((s, idx) => ({
        idx,
        kind: s.kind,
        userId: s.userId,
        name: s.name,
        botDifficulty: s.botDifficulty,
      })),
    };
  }

  // ------------------------------------------------------------------ queries

  isConnected(userId: string): boolean {
    return (this.members.get(userId)?.sockets.size ?? 0) > 0;
  }

  seatOf(userId: string): number {
    return this.seats.findIndex((s) => s.kind === 'human' && s.userId === userId);
  }

  runnerSeats(): RunnerSeat[] {
    return this.seats.map((s) => ({
      kind: s.kind,
      userId: s.userId,
      controller: s.kind === 'bot' ? 'bot' : s.controller,
      connected: s.kind === 'human' ? this.isConnected(s.userId!) : true,
      botDifficulty: s.botDifficulty,
    }));
  }

  info(): RoomInfo {
    const seated = new Set(this.seats.map((s) => s.userId).filter(Boolean));
    return {
      id: this.id,
      code: this.code,
      hostUserId: this.hostUserId,
      status: this.status,
      settings: { ...this.settings },
      seats: this.seats.map((s, index): SeatInfo => ({
        index,
        kind: s.kind,
        userId: s.userId,
        name: s.name,
        avatarUrl: s.avatarUrl,
        color: PLAYER_COLORS[index] ?? PLAYER_COLORS[0],
        ready: s.ready,
        connected: s.kind === 'human' ? this.isConnected(s.userId!) : s.kind === 'bot',
        controller: s.kind === 'bot' ? 'bot' : s.controller,
        botDifficulty: s.botDifficulty,
        inVoice: s.inVoice,
        muted: s.muted,
      })),
      gameId: this.gameId,
      paused: this.runner?.paused ?? false,
      spectators: [...this.members.values()]
        .filter((m) => !seated.has(m.userId))
        .map((m) => ({ userId: m.userId, name: m.name })),
    };
  }

  // ------------------------------------------------------------------ lobby rules

  assertHost(userId: string): void {
    if (userId !== this.hostUserId) throw new AppError('NOT_HOST', 'Only the host can do that');
  }

  assertLobby(): void {
    if (this.status !== 'lobby') throw new AppError('NOT_IN_LOBBY', 'The game has already started');
  }

  private seatAt(index: number): SeatState {
    const s = this.seats[index];
    if (!s) throw new AppError('SEAT_INVALID', 'No such seat');
    return s;
  }

  sit(who: Identity, index: number): void {
    this.assertLobby();
    const target = this.seatAt(index);
    const current = this.seatOf(who.userId);
    if (current === index) return;
    if (target.kind !== 'open') throw new AppError('SEAT_TAKEN', 'That seat is taken');
    if (current >= 0) this.seats[current] = openSeat();
    this.seats[index] = humanSeat(who);
  }

  stand(userId: string): void {
    this.assertLobby();
    const i = this.seatOf(userId);
    if (i < 0) throw new AppError('NOT_SEATED', 'You are not seated');
    this.seats[i] = openSeat();
  }

  setReady(userId: string, ready: boolean): void {
    this.assertLobby();
    const i = this.seatOf(userId);
    if (i < 0) throw new AppError('NOT_SEATED', 'You are not seated');
    this.seats[i]!.ready = ready;
  }

  addBot(userId: string, index: number, difficulty: BotDifficulty): void {
    this.assertHost(userId);
    this.assertLobby();
    if (this.seatAt(index).kind !== 'open') throw new AppError('SEAT_TAKEN', 'That seat is taken');
    this.seats[index] = botSeat(index, difficulty);
  }

  removeBot(userId: string, index: number): void {
    this.assertHost(userId);
    this.assertLobby();
    if (this.seatAt(index).kind !== 'bot') throw new AppError('NOT_A_BOT', 'That seat has no bot');
    this.seats[index] = openSeat();
  }

  updateSettings(userId: string, patch: Partial<RoomSettings>): void {
    this.assertHost(userId);
    this.assertLobby();
    this.settings = { ...this.settings, ...patch };
    const n = this.settings.maxSeats;
    if (this.seats.length > n) this.seats = this.seats.slice(0, n);
    while (this.seats.length < n) this.seats.push(openSeat());
    for (const s of this.seats) s.ready = false;
  }

  /**
   * Remove a user's seat when they are kicked: lobby seats open up, in-game seats are handed to a
   * bot for the rest of the game. Returns true if a seat changed.
   */
  vacateSeat(userId: string): boolean {
    const i = this.seatOf(userId);
    if (i < 0) return false;
    if (this.status === 'lobby') this.seats[i] = openSeat();
    else this.seats[i] = { ...botSeat(i, 'normal'), inVoice: false };
    return true;
  }

  /** The connected human who should inherit the host role, or null. */
  nextHost(): string | null {
    for (const s of this.seats)
      if (s.kind === 'human' && s.userId !== this.hostUserId && this.isConnected(s.userId!))
        return s.userId;
    // Spectators may only inherit host powers in the lobby, never over a running game.
    if (this.status !== 'lobby') return null;
    for (const m of this.members.values())
      if (m.userId !== this.hostUserId && m.sockets.size > 0) return m.userId;
    return null;
  }

  /** Every seat un-ready and driven by its own kind (before a game starts or a rematch). */
  resetSeatControl(): void {
    for (const s of this.seats) {
      s.ready = false;
      s.controller = s.kind === 'bot' ? 'bot' : 'human';
    }
  }

  /**
   * Host only, after the game ended: back to the lobby with the same seats. Humans must ready up
   * again; bots (including seats a bot took over from kicked players) stay. Seats of humans who
   * are gone (left, or disconnected past the grace period) open up so the lobby can fill again.
   */
  rematch(userId: string): void {
    this.assertHost(userId);
    const over = this.status === 'finished' || (this.runner?.isOver ?? false);
    if (this.status === 'lobby')
      throw new AppError('ALREADY_IN_LOBBY', 'The room is already in the lobby');
    if (!over) throw new AppError('GAME_NOT_OVER', 'The game is still running');
    this.status = 'lobby';
    this.runner?.close();
    this.runner = null;
    this.gameId = null;
    this.seats = this.seats.map((s) =>
      s.kind === 'human' && !this.members.has(s.userId!) && !this.graceTimers.has(s.userId!)
        ? openSeat()
        : s,
    );
    this.resetSeatControl();
  }

  /**
   * Validate that the room can start (host only, every seat filled, every non-host human ready)
   * and return the engine config inputs.
   */
  startConfig(userId: string): Partial<GameConfig> & { players: number } {
    this.assertHost(userId);
    this.assertLobby();
    const players = this.settings.maxSeats;
    if (this.seats.length !== players || this.seats.some((s) => s.kind === 'open')) {
      throw new AppError('SEATS_NOT_FILLED', 'Every seat needs a player or a bot');
    }
    if (!this.seats.some((s) => s.kind === 'human')) {
      throw new AppError('NO_HUMANS', 'At least one human must be seated');
    }
    // The host starting the game counts as their ready signal.
    const notReady = this.seats.filter(
      (s) => s.kind === 'human' && !s.ready && s.userId !== this.hostUserId,
    );
    if (notReady.length > 0) {
      throw new AppError('NOT_READY', `Waiting for ${notReady.map((s) => s.name).join(', ')}`);
    }
    const { variant } = this.settings;
    if (variant === 'base' && players > 4) {
      throw new AppError('INVALID_VARIANT', 'The base board supports 3-4 players');
    }
    const resolved = variant === 'auto' ? (players >= 5 ? 'ext56' : 'base') : variant;
    return {
      players,
      variant: resolved,
      vpToWin: this.settings.vpToWin,
      discardLimit: this.settings.discardLimit,
      // The official spiral exists only for the base board.
      numberMode: resolved === 'base' ? this.settings.numberMode : 'random',
      portMode: this.settings.portMode,
    };
  }
}
