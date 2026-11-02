/**
 * Ordered schema migrations. Append only: never edit a migration that has shipped.
 * Migration N (1-based) brings the schema to version N.
 */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    google_sub TEXT UNIQUE,
    email TEXT,
    name TEXT NOT NULL,
    avatar_url TEXT,
    is_guest INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE INDEX sessions_expiry ON sessions(expires_at);

  CREATE TABLE rooms (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    host_user_id TEXT NOT NULL REFERENCES users(id),
    status TEXT NOT NULL CHECK (status IN ('lobby', 'in_game', 'finished')),
    settings_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX rooms_status ON rooms(status);

  CREATE TABLE room_seats (
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('open', 'human', 'bot')),
    user_id TEXT REFERENCES users(id),
    name TEXT NOT NULL,
    bot_difficulty TEXT NOT NULL,
    PRIMARY KEY (room_id, idx)
  );

  CREATE TABLE games (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    config_json TEXT NOT NULL,
    seed TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'finished', 'abandoned')),
    winner INTEGER,
    engine_version INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    finished_at INTEGER
  );
  CREATE INDEX games_room ON games(room_id);

  CREATE TABLE game_actions (
    game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    seat INTEGER NOT NULL,
    actor TEXT NOT NULL CHECK (actor IN ('human', 'bot', 'timeout')),
    action_json TEXT NOT NULL,
    events_json TEXT NOT NULL,
    ts INTEGER NOT NULL,
    PRIMARY KEY (game_id, idx)
  ) WITHOUT ROWID;

  CREATE TABLE game_snapshots (
    game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    state_json TEXT NOT NULL,
    PRIMARY KEY (game_id, version)
  ) WITHOUT ROWID;

  CREATE TABLE chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    text TEXT NOT NULL,
    ts INTEGER NOT NULL
  );
  CREATE INDEX chat_room ON chat_messages(room_id, id);
  `,
];
