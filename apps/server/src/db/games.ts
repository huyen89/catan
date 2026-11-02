import type Database from 'better-sqlite3';
import type { Action, GameConfig, GameEvent, GameState, Seat } from '@hexhaven/engine';

export type Actor = 'human' | 'bot' | 'timeout';

export interface GameRow {
  id: string;
  roomId: string;
  config: GameConfig;
  seed: string;
  status: 'active' | 'finished' | 'abandoned';
  winner: number | null;
  engineVersion: number;
  createdAt: number;
  finishedAt: number | null;
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
  config_json: string;
  seed: string;
  status: GameRow['status'];
  winner: number | null;
  engine_version: number;
  created_at: number;
  finished_at: number | null;
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
  create(g: Omit<GameRow, 'status' | 'winner' | 'finishedAt'>): void;
  get(id: string): GameRow | null;
  activeForRoom(roomId: string): GameRow | null;
  appendAction(gameId: string, a: ActionRow): void;
  /** Insert (or overwrite) the snapshot at `state.version`. */
  saveSnapshot(gameId: string, state: GameState): void;
  finish(gameId: string, winner: number | null, now: number): void;
  latestSnapshot(gameId: string): GameState | null;
  actionsFrom(gameId: string, fromIdx: number): ActionRow[];
}

export function createGamesRepo(db: Database.Database): GamesRepo {
  const insertGame = db.prepare(
    `INSERT INTO games (id, room_id, config_json, seed, status, winner, engine_version, created_at)
     VALUES (?, ?, ?, ?, 'active', NULL, ?, ?)`,
  );
  const getGame = db.prepare<[string], RawGame>('SELECT * FROM games WHERE id = ?');
  const activeForRoom = db.prepare<[string], RawGame>(
    `SELECT * FROM games WHERE room_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
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
    `UPDATE games SET status = 'finished', winner = ?, finished_at = ? WHERE id = ?`,
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
          config: JSON.parse(r.config_json) as GameConfig,
          seed: r.seed,
          status: r.status,
          winner: r.winner,
          engineVersion: r.engine_version,
          createdAt: r.created_at,
          finishedAt: r.finished_at,
        }
      : null;

  return {
    create: (g) =>
      void insertGame.run(
        g.id,
        g.roomId,
        JSON.stringify(g.config),
        g.seed,
        g.engineVersion,
        g.createdAt,
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
    finish: (gameId, winner, now) => void finish.run(winner, now, gameId),
    latestSnapshot: (gameId) => {
      const r = latestSnapshot.get(gameId);
      return r ? (JSON.parse(r.state_json) as GameState) : null;
    },
    actionsFrom: (gameId, fromIdx) =>
      actionsFrom.all(gameId, fromIdx).map((r) => ({
        idx: r.idx,
        seat: r.seat,
        actor: r.actor,
        action: JSON.parse(r.action_json) as Action,
        events: JSON.parse(r.events_json) as GameEvent[],
        ts: r.ts,
      })),
  };
}
