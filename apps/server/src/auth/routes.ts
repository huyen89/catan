import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  googleLoginSchema,
  guestLoginSchema,
  type LoginResponse,
  type MeResponse,
  type UserInfo,
} from '@hexhaven/shared';
import type { z } from 'zod';
import type { Config } from '../config';
import type { Repos } from '../db';
import type { UserRow } from '../db/users';
import { AppError } from '../errors';
import type { GoogleVerifier } from './google';
import { SESSION_COOKIE, type SessionService } from './sessions';

declare module 'fastify' {
  interface FastifyRequest {
    user: UserRow | null;
  }
}

export const toUserInfo = (u: UserRow): UserInfo => ({
  id: u.id,
  name: u.name,
  avatarUrl: u.avatarUrl,
  isGuest: u.isGuest,
});

export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body);
  if (!r.success) throw new AppError('BAD_REQUEST', 'Invalid request body', 400);
  return r.data;
}

/** preHandler: 401 unless the request carries a valid session cookie. */
export async function requireUser(req: FastifyRequest): Promise<void> {
  if (!req.user) throw new AppError('UNAUTHENTICATED', 'Login required', 401);
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export interface AuthRouteOptions {
  config: Config;
  repos: Repos;
  sessions: SessionService;
  verifyGoogleToken: GoogleVerifier | null;
  /** Called after a session is destroyed so live sockets on it can be dropped. */
  onLogout(tokenHash: string): void;
}

export async function registerAuthRoutes(app: FastifyInstance, opts: AuthRouteOptions) {
  const { config, repos, sessions } = opts;
  const authRateLimit = {
    rateLimit: { max: config.testMode ? 1000 : 20, timeWindow: '1 minute' },
  };

  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    req.user = sessions.userFor(req.cookies[SESSION_COOKIE]);
  });

  const login = (reply: FastifyReply, user: UserRow): LoginResponse => {
    const { token, expiresAt } = sessions.create(user.id);
    reply.setCookie(SESSION_COOKIE, token, sessions.cookieOptions(expiresAt));
    return { user: toUserInfo(user) };
  };

  app.post('/api/auth/google', { config: authRateLimit }, async (req, reply) => {
    const { credential } = parseBody(googleLoginSchema, req.body);
    if (!config.googleClientId || !opts.verifyGoogleToken) {
      throw new AppError('GOOGLE_DISABLED', 'Google login is not configured', 404);
    }
    const token = await opts.verifyGoogleToken(credential);
    if (!token.emailVerified) {
      throw new AppError('EMAIL_NOT_VERIFIED', 'Google account email is not verified', 403);
    }
    const email = token.email.toLowerCase();
    if (config.allowedEmails && !config.allowedEmails.includes(email)) {
      throw new AppError('EMAIL_NOT_ALLOWED', 'This account is not on the guest list', 403);
    }
    const user = repos.users.upsertGoogle(
      {
        sub: token.sub,
        email,
        name: (token.name ?? email.split('@')[0] ?? 'Player').slice(0, 64),
        avatarUrl: token.picture,
      },
      Date.now(),
    );
    return login(reply, user);
  });

  app.post('/api/auth/guest', { config: authRateLimit }, async (req, reply) => {
    const body = parseBody(guestLoginSchema, req.body);
    if (config.guestInviteCode && !safeEqual(body.inviteCode ?? '', config.guestInviteCode)) {
      throw new AppError('INVALID_INVITE', 'Invite code is wrong', 403);
    }
    return login(reply, repos.users.createGuest(body.name, Date.now()));
  });

  app.post('/api/auth/logout', { config: authRateLimit }, async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) {
      sessions.destroy(token);
      opts.onLogout(sessions.hash(token));
    }
    reply.clearCookie(SESSION_COOKIE, sessions.cookieOptions());
    return { ok: true };
  });

  app.get('/api/me', async (req): Promise<MeResponse> => ({
    user: req.user ? toUserInfo(req.user) : null,
    config: {
      googleClientId: config.googleClientId,
      guestInviteRequired: config.guestInviteCode !== null,
      testMode: config.testMode,
    },
  }));
}
