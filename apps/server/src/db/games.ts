import type Database from 'better-sqlite3';
import type { Action, GameConfig, GameEvent, GameState, Seat } from '@hexhaven/engine';

export type Actor = 'human' | 'bot' | 'timeout';

export interface GameRow {
  id: string;
  roomId: string;
  /** Code of the owning room (history display). */
  roomCode: string;
  config: GameConfig;
  seed: string;
  status: 'active' | 'finished' | 'abandoned';
  winner: number | null;
  engineVersion: number;
  createdAt: number;
  finishedAt: number | null;
  /** turn.number when the game ended; null while active. */
  turns: number | null;
}

/** Who sat where in a game (filled at start, `vp` at the end). */
export interface GamePlayerRow {
  seat: Seat;
  kind: 'human' | 'bot';
  userId: string | null;
  name: string;
  vp: number | null;
}

export interface ActionRow {
  /** Version of the state the action was applied to. */
  idx: number;
  seat: Seat;
  actor: Actor;
  action: Action;
  events: GameEvent[];
  ts: number;
}

interface RawGame {
  id: string;
  room_id: string;
  room_code: string;
  config_json: string;
  seed: string;
  status: GameRow['status'];
  winner: number | null;
  engine_version: number;
  created_at: number;
  finished_at: number | null;
  turns: number | null;
}

interface RawPlayer {
  game_id: string;
  seat: number;
  kind: 'human' | 'bot';
  user_id: string | null;
  name: string;
  vp: number | null;
}

interface RawAction {
  idx: number;
  seat: number;
  actor: Actor;
  action_json: string;
  events_json: string;
  ts: number;
}

export interface GamesRepo {
  create(
    g: Omit<GameRow, 'status' | 'winner' | 'finishedAt' | 'turns' | 'roomCode'>,
    players: Array<Omit<GamePlayerRow, 'vp'>>,
  ): void;
  get(id: string): GameRow | null;
  activeForRoom(roomId: string): GameRow | null;
  appendAction(gameId: string, a: ActionRow): void;
  /** Insert (or overwrite) the snapshot at `state.version`. */
  saveSnapshot(gameId: string, state: GameState): void;
  /** Mark finished and record the turn count and final VP per seat (index = seat). */
  finish(
    gameId: string,
    end: { winner: number | null; now: number; turns: number; vp: readonly number[] | null },
  ): void;
  players(gameId: string): GamePlayerRow[];
  /** Games `userId` sat in, newest first, with their rosters. */
  listForUser(
    userId: string,
    opts: { limit?: number; status?: GameRow['status'] },
  ): Array<GameRow & { players: GamePlayerRow[] }>;
  /** turn.number of the latest snapshot (for active games). */
  latestTurn(gameId: string): number | null;
  /** Every recorded action, in order. */
  allActions(gameId: string): ActionRow[];
  latestSnapshot(gameId: string): GameState | null;
  actionsFrom(gameId: string, fromIdx: number): ActionRow[];
}

export function createGamesRepo(db: Database.Database): GamesRepo {
  const insertGame = db.prepare(
    `INSERT INTO games (id, room_id, config_json, seed, status, winner, engine_version, created_at)
     VALUES (?, ?, ?, ?, 'active', NULL, ?, ?)`,
  );
  const SELECT_GAME =
    'SELECT games.*, rooms.code AS room_code FROM games JOIN rooms ON rooms.id = games.room_id';
  const getGame = db.prepare<[string], RawGame>(`${SELECT_GAME} WHERE games.id = ?`);
  const activeForRoom = db.prepare<[string], RawGame>(
    `${SELECT_GAME} WHERE games.room_id = ? AND games.status = 'active'
     ORDER BY games.created_at DESC LIMIT 1`,
  );
  const insertPlayer = db.prepare(
    'INSERT INTO game_players (game_id, seat, kind, user_id, name, vp) VALUES (?, ?, ?, ?, ?, NULL)',
  );
  const setVp = db.prepare('UPDATE game_players SET vp = ? WHERE game_id = ? AND seat = ?');
  const playersOf = db.prepare<[string], RawPlayer>(
    'SELECT * FROM game_players WHERE game_id = ? ORDER BY seat',
  );
  const listForUser = db.prepare<[string, string | null, string | null, number], RawGame>(
    `${SELECT_GAME}
     WHERE EXISTS (SELECT 1 FROM game_players gp WHERE gp.game_id = games.id AND gp.user_id = ?)
       AND (? IS NULL OR games.status = ?)
     ORDER BY games.created_at DESC, games.id LIMIT ?`,
  );
  const latestTurn = db.prepare<[string], { turn: number | null }>(
    `SELECT json_extract(state_json, '$.turn.number') AS turn FROM game_snapshots
     WHERE game_id = ? ORDER BY version DESC LIMIT 1`,
  );
  const insertAction = db.prepare(
    `INSERT INTO game_actions (game_id, idx, seat, actor, action_json, events_json, ts)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const upsertSnapshot = db.prepare(
    `INSERT INTO game_snapshots (game_id, version, state_json) VALUES (?, ?, ?)
     ON CONFLICT(game_id, version) DO UPDATE SET state_json = excluded.state_json`,
  );
  const finish = db.prepare(
    `UPDATE games SET status = 'finished', winner = ?, finished_at = ?, turns = ? WHERE id = ?`,
  );
  const latestSnapshot = db.prepare<[string], { state_json: string }>(
    'SELECT state_json FROM game_snapshots WHERE game_id = ? ORDER BY version DESC LIMIT 1',
  );
  const actionsFrom = db.prepare<[string, number], RawAction>(
    'SELECT * FROM game_actions WHERE game_id = ? AND idx >= ? ORDER BY idx',
  );

  const toGame = (r: RawGame | undefined): GameRow | null =>
    r
      ? {
          id: r.id,
          roomId: r.room_id,
          roomCode: r.room_code,
          config: JSON.parse(r.config_json) as GameConfig,
          seed: r.seed,
          status: r.status,
          winner: r.winner,
          engineVersion: r.engine_version,
          createdAt: r.created_at,
          finishedAt: r.finished_at,
          turns: r.turns,
        }
      : null;

  const toPlayer = (r: RawPlayer): GamePlayerRow => ({
    seat: r.seat,
    kind: r.kind,
    userId: r.user_id,
    name: r.name,
    vp: r.vp,
  });

  const toAction = (r: RawAction): ActionRow => ({
    idx: r.idx,
    seat: r.seat,
    actor: r.actor,
    action: JSON.parse(r.action_json) as Action,
    events: JSON.parse(r.events_json) as GameEvent[],
    ts: r.ts,
  });

  return {
    create: db.transaction(
      (
        g: Omit<GameRow, 'status' | 'winner' | 'finishedAt' | 'turns' | 'roomCode'>,
        players: Array<Omit<GamePlayerRow, 'vp'>>,
      ) => {
        insertGame.run(
          g.id,
          g.roomId,
          JSON.stringify(g.config),
          g.seed,
          g.engineVersion,
          g.createdAt,
        );
        for (const p of players) insertPlayer.run(g.id, p.seat, p.kind, p.userId, p.name);
      },
    ),
    get: (id) => toGame(getGame.get(id)),
    activeForRoom: (roomId) => toGame(activeForRoom.get(roomId)),
    appendAction: (gameId, a) =>
      void insertAction.run(
        gameId,
        a.idx,
        a.seat,
        a.actor,
        JSON.stringify(a.action),
        JSON.stringify(a.events),
        a.ts,
      ),
    saveSnapshot: (gameId, state) =>
      void upsertSnapshot.run(gameId, state.version, JSON.stringify(state)),
    finish: db.transaction(
      (
        gameId: string,
        end: { winner: number | null; now: number; turns: number; vp: readonly number[] | null },
      ) => {
        finish.run(end.winner, end.now, end.turns, gameId);
        end.vp?.forEach((vp, seat) => setVp.run(vp, gameId, seat));
      },
    ),
    players: (gameId) => playersOf.all(gameId).map(toPlayer),
    listForUser: (userId, { limit = 50, status }) =>
      listForUser
        .all(userId, status ?? null, status ?? null, limit)
        .map((r) => ({ ...toGame(r)!, players: playersOf.all(r.id).map(toPlayer) })),
    latestTurn: (gameId) => latestTurn.get(gameId)?.turn ?? null,
    allActions: (gameId) => actionsFrom.all(gameId, 0).map(toAction),
    latestSnapshot: (gameId) => {
      const r = latestSnapshot.get(gameId);
      return r ? (JSON.parse(r.state_json) as GameState) : null;
    },
    actionsFrom: (gameId, fromIdx) => actionsFrom.all(gameId, fromIdx).map(toAction),
  };
}
