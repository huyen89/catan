import { afterEach, describe, expect, it } from 'vitest';
import type { MeResponse } from '@hexhaven/shared';
import { loadConfig } from '../config';
import { AppError } from '../errors';
import {
  connect,
  cookieFrom,
  disconnectAll,
  guestLogin,
  startServer,
  type TestServer,
} from '../testing/harness';
import type { GoogleVerifier } from './google';

let srv: TestServer | null = null;
afterEach(async () => {
  disconnectAll();
  await srv?.close();
  srv = null;
});

const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const me = async (url: string, cookie?: string): Promise<MeResponse> =>
  (
    await fetch(`${url}/api/me`, { headers: cookie ? { cookie } : {} })
  ).json() as Promise<MeResponse>;

const fakeGoogle =
  (overrides: Partial<Awaited<ReturnType<GoogleVerifier>>> = {}): GoogleVerifier =>
  async (credential) => {
    if (credential !== 'good-credential') throw new AppError('INVALID_CREDENTIAL', 'bad', 401);
    return {
      sub: 'google-sub-1',
      email: 'Alice@Example.com',
      emailVerified: true,
      name: 'Alice',
      picture: 'https://example.com/a.png',
      ...overrides,
    };
  };

describe('config', () => {
  it('requires a session secret outside test mode', () => {
    expect(() => loadConfig({})).toThrow(/SESSION_SECRET/);
    expect(() => loadConfig({ SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
    const c = loadConfig({ SESSION_SECRET: 'x'.repeat(16), PUBLIC_ORIGIN: 'https://h.example/' });
    expect(c.publicOrigin).toBe('https://h.example');
    expect(c.secureCookies).toBe(true);
    expect(c.reconnectGraceMs).toBe(30000);
    expect(c.botDelayMs).toBe(900);
  });

  it('uses short delays in test mode and parses lists', () => {
    const c = loadConfig({ TEST_MODE: '1', ALLOWED_EMAILS: ' A@x.com, b@y.com ,' });
    expect(c.reconnectGraceMs).toBe(1500);
    expect(c.botDelayMs).toBe(0);
    expect(c.allowedEmails).toEqual(['a@x.com', 'b@y.com']);
    expect(c.ice.provider).toBe('none');
  });
});

describe('guest auth', () => {
  it('logs in a guest and reports them from /api/me', async () => {
    srv = await startServer();
    expect((await me(srv.url)).user).toBeNull();
    const res = await fetch(`${srv.url}/api/auth/guest`, json({ name: '  Bob ' }));
    expect(res.status).toBe(200);
    const setCookie = res.headers.getSetCookie()[0]!;
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).not.toMatch(/Secure/i);
    const cookie = cookieFrom(res);
    const m = await me(srv.url, cookie);
    expect(m.user).toMatchObject({ name: 'Bob', isGuest: true, avatarUrl: null });
    expect(m.config).toEqual({ googleClientId: null, guestInviteRequired: false, testMode: true });
  });

  it('rejects invalid bodies and wrong invite codes', async () => {
    srv = await startServer({ guestInviteCode: 'letmein' });
    expect((await fetch(`${srv.url}/api/auth/guest`, json({ name: '' }))).status).toBe(400);
    expect((await fetch(`${srv.url}/api/auth/guest`, json({ name: 'x', extra: 1 }))).status).toBe(
      400,
    );
    const wrong = await fetch(`${srv.url}/api/auth/guest`, json({ name: 'x', inviteCode: 'no' }));
    expect(wrong.status).toBe(403);
    expect(((await wrong.json()) as { error: { code: string } }).error.code).toBe('INVALID_INVITE');
    await expect(guestLogin(srv.url, 'x', 'letmein')).resolves.toMatch(/^sid=/);
    expect((await me(srv.url)).config.guestInviteRequired).toBe(true);
  });

  it('logout clears the session and drops its sockets', async () => {
    srv = await startServer();
    const cookie = await guestLogin(srv.url, 'Bob');
    const socket = await connect(srv.url, cookie);
    const dropped = new Promise((r) => socket.once('disconnect', r));
    const res = await fetch(`${srv.url}/api/auth/logout`, { method: 'POST', headers: { cookie } });
    expect(res.status).toBe(200);
    await dropped;
    expect((await me(srv.url, cookie)).user).toBeNull();
  });

  it('ignores garbage session cookies', async () => {
    srv = await startServer();
    expect((await me(srv.url, 'sid=not-a-real-token')).user).toBeNull();
  });
});

describe('google auth', () => {
  it('is disabled without GOOGLE_CLIENT_ID', async () => {
    srv = await startServer();
    const res = await fetch(`${srv.url}/api/auth/google`, json({ credential: 'good-credential' }));
    expect(res.status).toBe(404);
  });

  it('verifies the credential and upserts the user by sub', async () => {
    srv = await startServer({ googleClientId: 'client-id' }, { verifyGoogleToken: fakeGoogle() });
    const bad = await fetch(`${srv.url}/api/auth/google`, json({ credential: 'bad-credential' }));
    expect(bad.status).toBe(401);

    const res = await fetch(`${srv.url}/api/auth/google`, json({ credential: 'good-credential' }));
    expect(res.status).toBe(200);
    const first = await me(srv.url, cookieFrom(res));
    expect(first.user).toMatchObject({ name: 'Alice', isGuest: false });
    expect(first.config.googleClientId).toBe('client-id');

    const again = await fetch(
      `${srv.url}/api/auth/google`,
      json({ credential: 'good-credential' }),
    );
    expect((await me(srv.url, cookieFrom(again))).user?.id).toBe(first.user?.id);
  });

  it('enforces ALLOWED_EMAILS and verified emails', async () => {
    srv = await startServer(
      { googleClientId: 'client-id', allowedEmails: ['bob@example.com'] },
      { verifyGoogleToken: fakeGoogle() },
    );
    const res = await fetch(`${srv.url}/api/auth/google`, json({ credential: 'good-credential' }));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'EMAIL_NOT_ALLOWED',
    );
    await srv.close();

    srv = await startServer(
      { googleClientId: 'client-id', allowedEmails: ['alice@example.com'] },
      { verifyGoogleToken: fakeGoogle() },
    );
    const okRes = await fetch(
      `${srv.url}/api/auth/google`,
      json({ credential: 'good-credential' }),
    );
    expect(okRes.status).toBe(200);
    await srv.close();

    srv = await startServer(
      { googleClientId: 'client-id' },
      { verifyGoogleToken: fakeGoogle({ emailVerified: false }) },
    );
    const unverified = await fetch(
      `${srv.url}/api/auth/google`,
      json({ credential: 'good-credential' }),
    );
    expect(unverified.status).toBe(403);
  });
});

describe('http surface', () => {
  it('serves health, protects ICE and sets security headers', async () => {
    srv = await startServer();
    const health = await fetch(`${srv.url}/api/health`);
    expect(await health.json()).toEqual({ ok: true });
    const csp = health.headers.get('content-security-policy')!;
    expect(csp).toContain('https://accounts.google.com');
    expect(csp).toContain("default-src 'self'");

    expect((await fetch(`${srv.url}/api/voice/ice`)).status).toBe(401);
    const cookie = await guestLogin(srv.url, 'Bob');
    const ice = await fetch(`${srv.url}/api/voice/ice`, { headers: { cookie } });
    expect(ice.status).toBe(200);
    expect(((await ice.json()) as { iceServers: unknown[] }).iceServers.length).toBeGreaterThan(0);

    const missing = await fetch(`${srv.url}/api/nope`);
    expect(missing.status).toBe(404);
  });

  it('registers test routes only in TEST_MODE', async () => {
    srv = await startServer();
    expect((await fetch(`${srv.url}/api/test/reset`, { method: 'POST' })).status).toBe(200);
    await srv.close();

    srv = await startServer({ testMode: false });
    expect((await fetch(`${srv.url}/api/test/reset`, { method: 'POST' })).status).toBe(404);
    expect((await fetch(`${srv.url}/api/test/rooms/ABCDEF/state`)).status).toBe(404);
  });
});

describe('socket auth', () => {
  it('rejects unauthenticated sockets', async () => {
    srv = await startServer();
    await expect(connect(srv.url)).rejects.toThrow(/UNAUTHENTICATED/);
    await expect(connect(srv.url, 'sid=forged')).rejects.toThrow(/UNAUTHENTICATED/);
  });

  it('rejects a foreign Origin when PUBLIC_ORIGIN is set', async () => {
    srv = await startServer({ publicOrigin: 'https://game.example' });
    const cookie = await guestLogin(srv.url, 'Bob');
    await expect(connect(srv.url, cookie, 'https://evil.example')).rejects.toThrow(
      /FORBIDDEN_ORIGIN/,
    );
    const s = await connect(srv.url, cookie, 'https://game.example');
    expect(s.connected).toBe(true);
  });
});
