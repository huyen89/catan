import type Database from 'better-sqlite3';
import type { BotDifficulty, RoomSettings, RoomStatus } from '@hexhaven/shared';

export interface SeatRow {
  idx: number;
  kind: 'open' | 'human' | 'bot';
  userId: string | null;
  name: string;
  botDifficulty: BotDifficulty;
}

export interface RoomRow {
  id: string;
  code: string;
  hostUserId: string;
  status: RoomStatus;
  settings: RoomSettings;
  createdAt: number;
  updatedAt: number;
  seats: SeatRow[];
}

interface RawRoom {
  id: string;
  code: string;
  host_user_id: string;
  status: RoomStatus;
  settings_json: string;
  created_at: number;
  updated_at: number;
}

interface RawSeat {
  idx: number;
  kind: SeatRow['kind'];
  user_id: string | null;
  name: string;
  bot_difficulty: BotDifficulty;
}

export interface RoomsRepo {
  /** Insert or replace the room row and all of its seats (one transaction). */
  save(room: Omit<RoomRow, 'createdAt'> & { createdAt?: number }): void;
  setStatus(id: string, status: RoomStatus, now: number): void;
  byCode(code: string): RoomRow | null;
  byId(id: string): RoomRow | null;
  idsByStatus(status: RoomStatus): string[];
  codeExists(code: string): boolean;
  /** Delete a room unless a game was played in it (that would cascade away its history). */
  deleteIfNoGames(id: string): boolean;
  /** Remove lobby rooms that have not been touched since `before`. */
  deleteStaleLobbies(before: number): number;
  /** Boot: lobbies that already hosted a game (rematch lobbies) become 'finished'. */
  finishLobbiesWithGames(now: number): number;
  addKick(roomId: string, userId: string): void;
  kicksOf(roomId: string): string[];
}

export function createRoomsRepo(db: Database.Database): RoomsRepo {
  const upsertRoom = db.prepare(
    `INSERT INTO rooms (id, code, host_user_id, status, settings_json, created_at, updated_at)
     VALUES (@id, @code, @hostUserId, @status, @settings, @createdAt, @updatedAt)
     ON CONFLICT(id) DO UPDATE SET host_user_id = excluded.host_user_id, status = excluded.status,
       settings_json = excluded.settings_json, updated_at = excluded.updated_at`,
  );
  const deleteSeats = db.prepare('DELETE FROM room_seats WHERE room_id = ?');
  const insertSeat = db.prepare(
    `INSERT INTO room_seats (room_id, idx, kind, user_id, name, bot_difficulty)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const setStatus = db.prepare('UPDATE rooms SET status = ?, updated_at = ? WHERE id = ?');
  const byCode = db.prepare<[string], RawRoom>('SELECT * FROM rooms WHERE code = ?');
  const byId = db.prepare<[string], RawRoom>('SELECT * FROM rooms WHERE id = ?');
  const seatsOf = db.prepare<[string], RawSeat>(
    'SELECT * FROM room_seats WHERE room_id = ? ORDER BY idx',
  );
  const idsByStatus = db.prepare<[string], { id: string }>(
    'SELECT id FROM rooms WHERE status = ? ORDER BY created_at',
  );
  const codeExists = db.prepare<[string], { one: number }>(
    'SELECT 1 AS one FROM rooms WHERE code = ?',
  );
  const del = db.prepare(
    'DELETE FROM rooms WHERE id = ? AND NOT EXISTS (SELECT 1 FROM games WHERE games.room_id = rooms.id)',
  );
  const delStale = db.prepare(
    `DELETE FROM rooms WHERE status = 'lobby' AND updated_at < ?
       AND NOT EXISTS (SELECT 1 FROM games WHERE games.room_id = rooms.id)`,
  );

  const finishLobbies = db.prepare(
    `UPDATE rooms SET status = 'finished', updated_at = ? WHERE status = 'lobby'
       AND EXISTS (SELECT 1 FROM games WHERE games.room_id = rooms.id)`,
  );
  const addKick = db.prepare(
    'INSERT INTO room_kicks (room_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
  );
  const kicksOf = db.prepare<[string], { user_id: string }>(
    'SELECT user_id FROM room_kicks WHERE room_id = ?',
  );

  const hydrate = (r: RawRoom | undefined): RoomRow | null =>
    r
      ? {
          id: r.id,
          code: r.code,
          hostUserId: r.host_user_id,
          status: r.status,
          settings: JSON.parse(r.settings_json) as RoomSettings,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          seats: seatsOf.all(r.id).map((s) => ({
            idx: s.idx,
            kind: s.kind,
            userId: s.user_id,
            name: s.name,
            botDifficulty: s.bot_difficulty,
          })),
        }
      : null;

  return {
    save: db.transaction((room: Omit<RoomRow, 'createdAt'> & { createdAt?: number }) => {
      upsertRoom.run({
        id: room.id,
        code: room.code,
        hostUserId: room.hostUserId,
        status: room.status,
        settings: JSON.stringify(room.settings),
        createdAt: room.createdAt ?? room.updatedAt,
        updatedAt: room.updatedAt,
      });
      deleteSeats.run(room.id);
      for (const s of room.seats)
        insertSeat.run(room.id, s.idx, s.kind, s.userId, s.name, s.botDifficulty);
    }),
    setStatus: (id, status, now) => void setStatus.run(status, now, id),
    byCode: (code) => hydrate(byCode.get(code)),
    byId: (id) => hydrate(byId.get(id)),
    idsByStatus: (status) => idsByStatus.all(status).map((r) => r.id),
    codeExists: (code) => codeExists.get(code) !== undefined,
    deleteIfNoGames: (id) => del.run(id).changes > 0,
    deleteStaleLobbies: (before) => delStale.run(before).changes,
    finishLobbiesWithGames: (now) => finishLobbies.run(now).changes,
    addKick: (roomId, userId) => void addKick.run(roomId, userId),
    kicksOf: (roomId) => kicksOf.all(roomId).map((r) => r.user_id),
  };
}
