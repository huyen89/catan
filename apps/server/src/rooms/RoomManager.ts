import { randomBytes, randomUUID } from 'node:crypto';
import type { Action, GameState, ResourceCounts } from '@hexhaven/engine';
import {
  DEFAULT_ROOM_SETTINGS,
  type BotDifficulty,
  type ChatMessage,
  type GameStatePayload,
  type RoomInfo,
  type RoomSettings,
} from '@hexhaven/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config';
import type { Repos } from '../db';
import type { RoomRow } from '../db/rooms';
import { AppError } from '../errors';
import { leaveVoice, type VoiceHooks } from '../realtime/handlers/voice';
import { ioRooms, type HexServer, type HexSocket } from '../realtime/types';
import { uniqueRoomCode } from './codes';
import type { BotDecide, EngineApi } from './engineApi';
import { GameRunner, recoverGameState, type RunnerHost } from './GameRunner';
import { Room, type Identity } from './Room';

export const CHAT_HISTORY_LIMIT = 100;
/** How long an empty lobby (or finished room) stays around before it is dropped. */
export const DEFAULT_LOBBY_IDLE_MS = 10 * 60 * 1000;
const STALE_LOBBY_MS = 24 * 60 * 60 * 1000;

export interface RoomManagerDeps {
  io: HexServer;
  repos: Repos;
  engine: EngineApi;
  decide: BotDecide;
  config: Config;
  log: FastifyBaseLogger;
  lobbyIdleMs?: number;
  random?: () => number;
}

/**
 * Owns every live room: membership, lobby commands, game start, disconnect grace, bot takeover,
 * persistence and room:state broadcasts. Socket handlers are thin wrappers around these methods.
 */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly codes = new Map<string, string>();
  /** Set once shutdown begins: socket disconnects no longer start grace timers or write. */
  private closing = false;
  readonly voiceHooks: VoiceHooks;

  constructor(private readonly deps: RoomManagerDeps) {
    this.voiceHooks = {
      onVoiceState: (roomId, userId, state) => this.onVoiceState(roomId, userId, state),
    };
  }

  // ------------------------------------------------------------------ lookup

  get(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  /**
   * In-memory room by code, falling back to a persisted lobby or finished room (e.g. after a
   * restart, so the table can still open a rematch). In-game rooms are loaded by `recover`.
   */
  findByCode(code: string): Room | null {
    const id = this.codes.get(code);
    if (id) return this.rooms.get(id) ?? null;
    const row = this.deps.repos.rooms.byCode(code);
    if (!row || row.status === 'in_game') return null;
    const room = this.hydrate(row);
    this.register(room);
    // Nobody is in it yet: if the join that loaded it fails (e.g. KICKED), it is dropped again.
    this.scheduleIdle(room);
    return room;
  }

  private hydrate(row: RoomRow): Room {
    return Room.fromRow(row, (uid) => this.identityOf(uid), this.deps.repos.rooms.kicksOf(row.id));
  }

  private roomOf(socket: HexSocket): Room {
    const id = socket.data.roomId;
    const room = id ? this.rooms.get(id) : undefined;
    if (!room) throw new AppError('NOT_IN_ROOM', 'Join a room first');
    return room;
  }

  private identityOf(userId: string): Identity | null {
    const u = this.deps.repos.users.get(userId);
    return u ? { userId: u.id, name: u.name, avatarUrl: u.avatarUrl } : null;
  }

  private socketIdentity(socket: HexSocket): Identity {
    const avatarUrl = this.deps.repos.users.get(socket.data.userId)?.avatarUrl ?? null;
    return { userId: socket.data.userId, name: socket.data.name, avatarUrl };
  }

  private register(room: Room): void {
    this.rooms.set(room.id, room);
    this.codes.set(room.code, room.id);
  }

  // ------------------------------------------------------------------ membership

  create(socket: HexSocket, settings: Partial<RoomSettings> | undefined): RoomInfo {
    this.leaveCurrent(socket);
    const who = this.socketIdentity(socket);
    const code = uniqueRoomCode((c) => this.codes.has(c) || this.deps.repos.rooms.codeExists(c));
    const room = new Room(
      randomUUID(),
      code,
      who.userId,
      { ...DEFAULT_ROOM_SETTINGS, ...settings },
      Date.now(),
    );
    room.sit(who, 0);
    this.register(room);
    this.persist(room);
    this.addMember(room, socket);
    this.broadcast(room);
    return room.info();
  }

  join(socket: HexSocket, code: string): RoomInfo {
    const room = this.findByCode(code);
    if (!room) throw new AppError('ROOM_NOT_FOUND', 'No room with that code');
    if (room.kicked.has(socket.data.userId)) {
      throw new AppError('KICKED', 'You were removed from this room');
    }
    if (socket.data.roomId !== room.id) {
      this.leaveCurrent(socket);
      this.addMember(room, socket);
    }
    this.broadcast(room);
    this.sendCatchUp(room, socket);
    return room.info();
  }

  leave(socket: HexSocket): void {
    this.roomOf(socket);
    this.leaveCurrent(socket);
  }

  /** Socket disconnected (VOX handles its own voice cleanup on disconnect). */
  disconnected(socket: HexSocket): void {
    if (this.closing) return;
    const room = socket.data.roomId ? this.rooms.get(socket.data.roomId) : undefined;
    if (room) this.removeMember(room, socket, false);
  }

  private leaveCurrent(socket: HexSocket): void {
    const room = socket.data.roomId ? this.rooms.get(socket.data.roomId) : undefined;
    if (room) this.removeMember(room, socket, true);
    else socket.data.roomId = null;
  }

  private addMember(room: Room, socket: HexSocket): void {
    const { userId } = socket.data;
    void socket.join(ioRooms.room(room.id));
    socket.data.roomId = room.id;
    const who = this.socketIdentity(socket);
    let m = room.members.get(userId);
    if (!m) {
      m = { ...who, sockets: new Set() };
      room.members.set(userId, m);
    }
    m.sockets.add(socket.id);
    if (room.idleTimer) clearTimeout(room.idleTimer);
    room.idleTimer = null;
    this.clearGrace(room, userId);

    const seat = room.seatOf(userId);
    if (seat >= 0) {
      const s = room.seats[seat]!;
      s.name = who.name;
      s.avatarUrl = who.avatarUrl;
      if (room.runner && room.status === 'in_game') {
        const reclaimed = s.controller === 'bot';
        s.controller = 'human';
        room.runner.refresh(reclaimed ? seat : undefined);
      }
    }
  }

  private removeMember(room: Room, socket: HexSocket, explicit: boolean): void {
    const { userId } = socket.data;
    if (explicit) leaveVoice(this.deps.io, socket, this.voiceHooks);
    void socket.leave(ioRooms.room(room.id));
    socket.data.roomId = null;
    const m = room.members.get(userId);
    m?.sockets.delete(socket.id);
    if (m && m.sockets.size > 0) return;
    room.members.delete(userId);

    const seat = room.seatOf(userId);
    let seatsChanged = false;
    if (explicit) {
      if (room.status === 'lobby' && seat >= 0) {
        room.vacateSeat(userId);
        seatsChanged = true;
      } else if (room.status === 'in_game' && seat >= 0) {
        room.seats[seat]!.controller = 'bot';
      }
      if (room.hostUserId === userId) this.transferHost(room);
    } else if (seat >= 0 || room.hostUserId === userId) {
      this.startGrace(room, userId);
    }
    if (seat >= 0) {
      room.seats[seat]!.inVoice = false;
      room.seats[seat]!.muted = false;
    }
    room.runner?.refresh();
    if (seatsChanged) this.persist(room);
    if (room.members.size === 0) this.scheduleIdle(room);
    this.broadcast(room);
  }

  private transferHost(room: Room): boolean {
    const next = room.nextHost();
    if (!next) return false;
    room.hostUserId = next;
    this.persist(room);
    return true;
  }

  /** After the grace period a disconnected seat is driven by the bot and the host role moves on. */
  private startGrace(room: Room, userId: string): void {
    this.clearGrace(room, userId);
    const t = setTimeout(() => {
      room.graceTimers.delete(userId);
      if (room.isConnected(userId)) return;
      const seat = room.seatOf(userId);
      if (room.status === 'in_game' && seat >= 0) {
        room.seats[seat]!.controller = 'bot';
        room.runner?.refresh();
      }
      if (room.hostUserId === userId) this.transferHost(room);
      this.broadcast(room);
    }, this.deps.config.reconnectGraceMs);
    room.graceTimers.set(userId, t);
  }

  private clearGrace(room: Room, userId: string): void {
    const t = room.graceTimers.get(userId);
    if (t) clearTimeout(t);
    room.graceTimers.delete(userId);
  }

  private scheduleIdle(room: Room): void {
    if (room.status === 'in_game' || room.idleTimer) return;
    room.idleTimer = setTimeout(() => {
      room.idleTimer = null;
      if (room.members.size > 0 || room.status === 'in_game') return;
      this.dispose(room);
      if (room.status !== 'lobby') return;
      // A rematch lobby keeps its row (and game history); it reopens as a finished room.
      if (!this.deps.repos.rooms.deleteIfNoGames(room.id))
        this.deps.repos.rooms.setStatus(room.id, 'finished', Date.now());
    }, this.deps.lobbyIdleMs ?? DEFAULT_LOBBY_IDLE_MS);
  }

  /** Stop every timer of a room and forget it (DB rows are left alone). */
  private dispose(room: Room): void {
    room.runner?.close();
    for (const t of room.graceTimers.values()) clearTimeout(t);
    room.graceTimers.clear();
    if (room.idleTimer) clearTimeout(room.idleTimer);
    room.idleTimer = null;
    this.rooms.delete(room.id);
    this.codes.delete(room.code);
  }

  /** Sent to a socket right after it joins: chat history and, in game, its game state. */
  private sendCatchUp(room: Room, socket: HexSocket): void {
    socket.emit('chat:history', this.deps.repos.chat.recent(room.id, CHAT_HISTORY_LIMIT));
    if (room.runner) socket.emit('game:state', room.runner.payloadFor(socket.data.userId));
  }

  // ------------------------------------------------------------------ lobby commands

  sit(socket: HexSocket, seat: number): void {
    const room = this.roomOf(socket);
    room.sit(this.socketIdentity(socket), seat);
    this.changed(room);
  }

  stand(socket: HexSocket): void {
    const room = this.roomOf(socket);
    room.stand(socket.data.userId);
    this.changed(room);
  }

  ready(socket: HexSocket, ready: boolean): void {
    const room = this.roomOf(socket);
    room.setReady(socket.data.userId, ready);
    this.broadcast(room);
  }

  addBot(socket: HexSocket, seat: number, difficulty: BotDifficulty): void {
    const room = this.roomOf(socket);
    room.addBot(socket.data.userId, seat, difficulty);
    this.changed(room);
  }

  removeBot(socket: HexSocket, seat: number): void {
    const room = this.roomOf(socket);
    room.removeBot(socket.data.userId, seat);
    this.changed(room);
  }

  updateSettings(socket: HexSocket, patch: Partial<RoomSettings>): void {
    const room = this.roomOf(socket);
    room.updateSettings(socket.data.userId, patch);
    this.changed(room);
  }

  kick(socket: HexSocket, targetId: string): void {
    const room = this.roomOf(socket);
    room.assertHost(socket.data.userId);
    if (targetId === socket.data.userId)
      throw new AppError('BAD_TARGET', 'You cannot kick yourself');
    const member = room.members.get(targetId);
    if (!member && room.seatOf(targetId) < 0) {
      throw new AppError('USER_NOT_FOUND', 'That user is not in this room');
    }
    const { repos } = this.deps;
    const seatIdx = room.seatOf(targetId);
    room.kicked.add(targetId);
    this.clearGrace(room, targetId);
    const seated = room.vacateSeat(targetId);
    const midGame = seated && room.status === 'in_game' && room.gameId && !room.runner?.isOver;
    repos.tx(() => {
      repos.rooms.addKick(room.id, targetId);
      if (seated) this.persist(room);
      // A bot finishes the game for them: the result is not theirs (stats, head-to-head, replay).
      if (midGame) repos.games.releaseSeat(room.gameId!, seatIdx, room.seats[seatIdx]!.name);
    });
    for (const id of member ? [...member.sockets] : []) {
      const s = this.deps.io.sockets.sockets.get(id);
      if (!s) continue;
      leaveVoice(this.deps.io, s, this.voiceHooks);
      void s.leave(ioRooms.room(room.id));
      s.data.roomId = null;
      s.emit('room:closed', { reason: 'kicked' });
    }
    room.members.delete(targetId);
    room.runner?.refresh();
    this.broadcast(room);
  }

  start(socket: HexSocket): void {
    const room = this.roomOf(socket);
    const { engine, repos } = this.deps;
    const partial = room.startConfig(socket.data.userId);
    const gameConfig = engine.normalizeConfig(partial);
    const seed = room.testSeed ?? randomBytes(16).toString('hex');
    let state: GameState;
    try {
      state = engine.createGame(gameConfig, seed);
    } catch (e) {
      throw new AppError('INVALID_CONFIG', e instanceof Error ? e.message : 'Cannot create game');
    }
    room.testSeed = null;
    const gameId = randomUUID();
    const now = Date.now();
    room.status = 'in_game';
    room.resetSeatControl();
    repos.tx(() => {
      repos.rooms.save(room.toRow(now));
      repos.games.create(
        {
          id: gameId,
          roomId: room.id,
          config: gameConfig,
          seed,
          engineVersion: state.engineVersion,
          createdAt: now,
          turns: state.turn.number,
        },
        room.seats.map((s, seat) => ({
          seat,
          kind: s.kind === 'bot' ? ('bot' as const) : ('human' as const),
          userId: s.kind === 'bot' ? null : s.userId,
          name: s.name,
        })),
      );
      repos.games.saveSnapshot(gameId, state);
    });
    this.attachRunner(room, gameId, state);
    this.deps.log.info({ roomId: room.id, gameId }, 'game started');
  }

  private attachRunner(room: Room, gameId: string, state: GameState): void {
    const { io } = this.deps;
    const host: RunnerHost = {
      roomId: room.id,
      seats: () => room.runnerSeats(),
      turnTimerSec: () => room.settings.turnTimerSec,
      setController: (seat, controller) => {
        const s = room.seats[seat];
        if (s && s.kind === 'human') s.controller = controller;
        this.broadcast(room);
      },
      broadcastGame: (build) => {
        // `build` returns one shared payload per seat (spectators share one), so group sockets
        // by payload and serialise each distinct payload once.
        const targets = new Map<GameStatePayload, string[]>();
        for (const m of room.members.values()) {
          if (m.sockets.size === 0) continue;
          const p = build(m.userId);
          const list = targets.get(p);
          if (list) list.push(...m.sockets);
          else targets.set(p, [...m.sockets]);
        }
        for (const [p, sockets] of targets) io.to(sockets).emit('game:state', p);
      },
      onGameOver: () => {
        room.status = 'finished';
        this.broadcast(room);
      },
    };
    room.gameId = gameId;
    room.runner = new GameRunner({
      gameId,
      state,
      host,
      engine: this.deps.engine,
      decide: this.deps.decide,
      repos: this.deps.repos,
      log: this.deps.log,
      botDelayMs: this.deps.config.botDelayMs,
      random: this.deps.random,
    });
    this.broadcast(room);
    room.runner.begin();
  }

  rematch(socket: HexSocket): void {
    const room = this.roomOf(socket);
    room.rematch(socket.data.userId);
    this.changed(room);
    this.deps.log.info({ roomId: room.id }, 'rematch lobby opened');
  }

  // ------------------------------------------------------------------ game & chat

  gameAction(socket: HexSocket, expectedVersion: number, action: Action) {
    const room = this.roomOf(socket);
    if (!room.runner) throw new AppError('NO_GAME', 'No game in progress');
    return room.runner.humanAction(socket.data.userId, expectedVersion, action);
  }

  gameSync(socket: HexSocket): GameStatePayload {
    const room = this.roomOf(socket);
    if (!room.runner) throw new AppError('NO_GAME', 'No game in progress');
    return room.runner.payloadFor(socket.data.userId);
  }

  chat(socket: HexSocket, text: string): ChatMessage {
    const room = this.roomOf(socket);
    const msg = this.deps.repos.chat.add({
      roomId: room.id,
      userId: socket.data.userId,
      name: socket.data.name,
      text,
      ts: Date.now(),
    });
    this.deps.io.to(ioRooms.room(room.id)).emit('chat:message', msg);
    return msg;
  }

  private onVoiceState(
    roomId: string,
    userId: string,
    state: { inVoice: boolean; muted: boolean },
  ): void {
    const room = this.rooms.get(roomId);
    const seat = room?.seatOf(userId) ?? -1;
    if (!room || seat < 0) return;
    room.seats[seat]!.inVoice = state.inVoice;
    room.seats[seat]!.muted = state.muted;
    this.broadcast(room);
  }

  // ------------------------------------------------------------------ persistence & fan-out

  private persist(room: Room): void {
    this.deps.repos.rooms.save(room.toRow(Date.now()));
  }

  private changed(room: Room): void {
    this.persist(room);
    this.broadcast(room);
  }

  broadcast(room: Room): void {
    this.deps.io.to(ioRooms.room(room.id)).emit('room:state', room.info());
  }

  // ------------------------------------------------------------------ lifecycle

  /** Boot: drop stale lobbies and resume every in-game room, paused until a human connects. */
  recover(): void {
    const { repos, engine, log } = this.deps;
    repos.rooms.finishLobbiesWithGames(Date.now());
    repos.rooms.deleteStaleLobbies(Date.now() - STALE_LOBBY_MS);
    for (const id of repos.rooms.idsByStatus('in_game')) {
      try {
        const row = repos.rooms.byId(id)!;
        const game = repos.games.activeForRoom(id);
        if (!game) throw new Error('no active game');
        const state = recoverGameState(engine, repos, game.id);
        const room = this.hydrate(row);
        this.register(room);
        this.attachRunner(room, game.id, state);
        for (const s of room.seats) if (s.kind === 'human') this.startGrace(room, s.userId!);
        log.info({ roomId: id, gameId: game.id, version: state.version }, 'game recovered');
      } catch (e) {
        log.error({ err: e, roomId: id }, 'failed to recover room');
      }
    }
  }

  /** Shutdown: snapshot every running game, then stop every timer. */
  closeAll(): void {
    this.closing = true;
    for (const room of this.rooms.values()) {
      try {
        room.runner?.snapshot();
      } catch (e) {
        this.deps.log.error({ err: e, roomId: room.id }, 'shutdown snapshot failed');
      }
    }
    for (const room of [...this.rooms.values()]) this.dispose(room);
  }

  /** TEST_MODE: kick everyone out, forget every room and wipe the database. */
  reset(): void {
    for (const room of [...this.rooms.values()]) {
      for (const m of room.members.values())
        for (const id of m.sockets) {
          const s = this.deps.io.sockets.sockets.get(id);
          if (s) s.data.roomId = null;
        }
      this.deps.io.to(ioRooms.room(room.id)).emit('room:closed', { reason: 'reset' });
      this.deps.io.in(ioRooms.room(room.id)).socketsLeave(ioRooms.room(room.id));
      this.dispose(room);
    }
    this.deps.repos.clearAll();
  }

  // ------------------------------------------------------------------ test hooks

  private byCodeOrThrow(code: string): Room {
    const room = this.findByCode(code.toUpperCase());
    if (!room) throw new AppError('ROOM_NOT_FOUND', 'No room with that code', 404);
    return room;
  }

  setTestSeed(code: string, seed: string): void {
    this.byCodeOrThrow(code).testSeed = seed;
  }

  testGive(code: string, seat: number, resources: Partial<ResourceCounts>): Promise<void> {
    const room = this.byCodeOrThrow(code);
    if (!room.runner) throw new AppError('NO_GAME', 'No game in progress', 409);
    return room.runner.testGive(seat, resources);
  }

  testState(code: string): GameState {
    const room = this.byCodeOrThrow(code);
    if (!room.runner) throw new AppError('NO_GAME', 'No game in progress', 409);
    return room.runner.state;
  }
}
