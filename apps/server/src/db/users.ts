import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

export interface UserRow {
  id: string;
  googleSub: string | null;
  email: string | null;
  name: string;
  avatarUrl: string | null;
  isGuest: boolean;
  createdAt: number;
}

interface RawUser {
  id: string;
  google_sub: string | null;
  email: string | null;
  name: string;
  avatar_url: string | null;
  is_guest: number;
  created_at: number;
}

const toUser = (r: RawUser): UserRow => ({
  id: r.id,
  googleSub: r.google_sub,
  email: r.email,
  name: r.name,
  avatarUrl: r.avatar_url,
  isGuest: r.is_guest === 1,
  createdAt: r.created_at,
});

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export interface UsersRepo {
  get(id: string): UserRow | null;
  createGuest(name: string, now: number): UserRow;
  /** Insert or refresh a Google account by its stable `sub`. */
  upsertGoogle(p: GoogleProfile, now: number): UserRow;
}

export function createUsersRepo(db: Database.Database): UsersRepo {
  const byId = db.prepare<[string], RawUser>('SELECT * FROM users WHERE id = ?');
  const bySub = db.prepare<[string], RawUser>('SELECT * FROM users WHERE google_sub = ?');
  const insert = db.prepare(
    `INSERT INTO users (id, google_sub, email, name, avatar_url, is_guest, created_at)
     VALUES (@id, @googleSub, @email, @name, @avatarUrl, @isGuest, @createdAt)`,
  );
  const updateGoogle = db.prepare(
    'UPDATE users SET email = @email, name = @name, avatar_url = @avatarUrl WHERE google_sub = @sub',
  );

  const get = (id: string) => {
    const r = byId.get(id);
    return r ? toUser(r) : null;
  };

  return {
    get,
    createGuest(name, now) {
      const id = randomUUID();
      insert.run({
        id,
        googleSub: null,
        email: null,
        name,
        avatarUrl: null,
        isGuest: 1,
        createdAt: now,
      });
      return get(id)!;
    },
    upsertGoogle: db.transaction((p: GoogleProfile, now: number): UserRow => {
      const existing = bySub.get(p.sub);
      if (existing) {
        updateGoogle.run({ sub: p.sub, email: p.email, name: p.name, avatarUrl: p.avatarUrl });
        return toUser(bySub.get(p.sub)!);
      }
      const id = randomUUID();
      insert.run({
        id,
        googleSub: p.sub,
        email: p.email,
        name: p.name,
        avatarUrl: p.avatarUrl,
        isGuest: 0,
        createdAt: now,
      });
      return get(id)!;
    }),
  };
}
