import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { MIGRATIONS } from './migrations';
import { createChatRepo, type ChatRepo } from './chat';
import { createGamesRepo, type GamesRepo } from './games';
import { createRoomsRepo, type RoomsRepo } from './rooms';
import { createSessionsRepo, type SessionsRepo } from './sessions';
import { createUsersRepo, type UsersRepo } from './users';

export type Db = Database.Database;

export interface Repos {
  db: Db;
  users: UsersRepo;
  sessions: SessionsRepo;
  rooms: RoomsRepo;
  games: GamesRepo;
  chat: ChatRepo;
  /** Run `fn` in a single SQLite transaction. */
  tx<T>(fn: () => T): T;
  /** Delete all rows (test mode only). */
  clearAll(): void;
}

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

export function migrate(db: Db): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT version FROM schema_version').get() as
    { version: number } | undefined;
  let current = row?.version ?? 0;
  if (!row) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
  if (current > MIGRATIONS.length) {
    throw new Error(`Database schema v${current} is newer than this server (${MIGRATIONS.length})`);
  }
  const setVersion = db.prepare('UPDATE schema_version SET version = ?');
  while (current < MIGRATIONS.length) {
    const sql = MIGRATIONS[current]!;
    const next = current + 1;
    db.transaction(() => {
      db.exec(sql);
      setVersion.run(next);
    })();
    current = next;
  }
}

export function createRepos(db: Db): Repos {
  const tables = [
    'room_kicks',
    'game_players',
    'chat_messages',
    'game_snapshots',
    'game_actions',
    'games',
    'room_seats',
    'rooms',
    'sessions',
    'users',
  ];
  return {
    db,
    users: createUsersRepo(db),
    sessions: createSessionsRepo(db),
    rooms: createRoomsRepo(db),
    games: createGamesRepo(db),
    chat: createChatRepo(db),
    tx: <T>(fn: () => T): T => db.transaction(fn)(),
    clearAll: () => {
      db.transaction(() => {
        for (const t of tables) db.exec(`DELETE FROM ${t}`);
      })();
    },
  };
}
