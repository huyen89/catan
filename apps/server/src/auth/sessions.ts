import { createHmac, randomBytes } from 'node:crypto';
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { Repos } from '../db';
import type { UserRow } from '../db/users';

export const SESSION_COOKIE = 'sid';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Cookie-token sessions. The cookie holds 32 random bytes; the DB stores only a keyed SHA-256
 * (HMAC with SESSION_SECRET), so a leaked database cannot be replayed as cookies.
 */
export class SessionService {
  constructor(
    private readonly repos: Repos,
    private readonly secret: string,
    private readonly secureCookies: boolean,
  ) {}

  hash(token: string): string {
    return createHmac('sha256', this.secret).update(token).digest('hex');
  }

  create(userId: string, now = Date.now()): { token: string; expiresAt: number } {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = now + SESSION_TTL_MS;
    this.repos.sessions.create(this.hash(token), userId, expiresAt);
    return { token, expiresAt };
  }

  /** Resolve a cookie token to its user, or null for missing/expired/unknown tokens. */
  userFor(token: string | undefined, now = Date.now()): UserRow | null {
    if (!token || token.length > 128) return null;
    const userId = this.repos.sessions.userIdFor(this.hash(token), now);
    return userId ? this.repos.users.get(userId) : null;
  }

  destroy(token: string): void {
    this.repos.sessions.delete(this.hash(token));
  }

  cookieOptions(expiresAt?: number): CookieSerializeOptions {
    return {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: this.secureCookies,
      ...(expiresAt !== undefined ? { expires: new Date(expiresAt) } : {}),
    };
  }
}
