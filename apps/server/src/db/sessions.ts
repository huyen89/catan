import type Database from 'better-sqlite3';

export interface SessionsRepo {
  create(tokenHash: string, userId: string, expiresAt: number): void;
  /** User id for a live session, or null when missing/expired. */
  userIdFor(tokenHash: string, now: number): string | null;
  delete(tokenHash: string): void;
  deleteExpired(now: number): number;
}

export function createSessionsRepo(db: Database.Database): SessionsRepo {
  const insert = db.prepare(
    'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
  );
  const select = db.prepare<[string, number], { user_id: string }>(
    'SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?',
  );
  const del = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
  const delExpired = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');

  return {
    create: (h, userId, expiresAt) => void insert.run(h, userId, expiresAt),
    userIdFor: (h, now) => select.get(h, now)?.user_id ?? null,
    delete: (h) => void del.run(h),
    deleteExpired: (now) => delExpired.run(now).changes,
  };
}
