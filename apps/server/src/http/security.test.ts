import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import { createGamesRepo } from '../db/games';
import { openDb } from '../db';
import {
  connect,
  disconnectAll,
  emit,
  guestLogin,
  ok,
  player,
  sleep,
  startServer,
  type TestServer,
} from '../testing/harness';

let srv: TestServer | null = null;
afterEach(async () => {
  disconnectAll();
  await srv?.close().catch(() => undefined);
  srv = null;
});

const PROD = { NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(32) };

describe('production config', () => {
  it('requires an https PUBLIC_ORIGIN (http only on localhost)', () => {
    expect(() => loadConfig(PROD)).toThrow(/PUBLIC_ORIGIN is required/);
    expect(() => loadConfig({ ...PROD, PUBLIC_ORIGIN: 'http://game.example' })).toThrow(/https/);
    expect(() => loadConfig({ ...PROD, PUBLIC_ORIGIN: 'ftp://game.example' })).toThrow(
      /http\(s\) origin/,
    );
    expect(() => loadConfig({ ...PROD, PUBLIC_ORIGIN: 'not a url' })).toThrow(/PUBLIC_ORIGIN/);
    const c = loadConfig({ ...PROD, PUBLIC_ORIGIN: 'https://game.example/path' });
    expect(c).toMatchObject({
      production: true,
      publicOrigin: 'https://game.example',
      secureCookies: true,
    });
    const local = loadConfig({ ...PROD, PUBLIC_ORIGIN: 'http://localhost:3000' });
    expect(local.publicOrigin).toBe('http://localhost:3000');
    expect(local.secureCookies).toBe(false);
    expect(loadConfig({ ...PROD, PUBLIC_ORIGIN: 'http://127.0.0.1:3000' }).production).toBe(true);
  });

  it('requires SESSION_SECRET and forbids TEST_MODE in production', () => {
    expect(() =>
      loadConfig({ NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://game.example' }),
    ).toThrow(/SESSION_SECRET/);
    expect(() =>
      loadConfig({ ...PROD, PUBLIC_ORIGIN: 'https://game.example', TEST_MODE: '1' }),
    ).toThrow(/TEST_MODE/);
  });

  it('stays permissive outside production', () => {
    const c = loadConfig({ SESSION_SECRET: 'x'.repeat(16), PUBLIC_ORIGIN: 'http://lan.box:3000' });
    expect(c.production).toBe(false);
    expect(c.publicOrigin).toBe('http://lan.box:3000');
  });
});

describe('REST origin check', () => {
  it('rejects state-changing requests from a foreign Origin', async () => {
    srv = await startServer({ publicOrigin: 'https://game.example' });
    const post = (origin?: string) =>
      fetch(`${srv!.url}/api/auth/guest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
        body: JSON.stringify({ name: 'Eve' }),
      });
    const evil = await post('https://evil.example');
    expect(evil.status).toBe(403);
    expect(await evil.json()).toMatchObject({ error: { code: 'FORBIDDEN_ORIGIN' } });
    expect((await post('https://game.example')).status).toBe(200);
    expect((await post()).status).toBe(200); // non-browser clients send no Origin
    const read = await fetch(`${srv.url}/api/health`, { headers: { origin: 'https://x.example' } });
    expect(read.status).toBe(200);
  });

  it('limits REST body size', async () => {
    srv = await startServer();
    const res = await fetch(`${srv.url}/api/auth/guest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x'.repeat(100_000) }),
    });
    expect(res.status).toBe(413);
  });
});

describe('socket limits', () => {
  it('rate-limits room creation', async () => {
    srv = await startServer();
    const a = await player(srv.url, 'A');
    const codes: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await emit(a.socket, 'room:create', {});
      codes.push(r.ok ? 'ok' : r.error.code);
    }
    expect(codes).toEqual(['ok', 'ok', 'ok', 'RATE_LIMITED']);
  });

  it('drops oversized socket packets', async () => {
    srv = await startServer();
    const a = await player(srv.url, 'A');
    const closed = new Promise<string>((r) => a.socket.once('disconnect', (reason) => r(reason)));
    a.socket.emit('chat:send', { text: 'x'.repeat(200_000) }, () => undefined);
    expect(await closed).toBe('transport close');
  });
});

describe('sessions and shutdown', () => {
  it('prunes expired sessions at boot and on an interval', async () => {
    srv = await startServer({}, { sessionSweepMs: 30 });
    const cookie = await guestLogin(srv.url, 'Old');
    const { db } = srv.server.repos;
    const count = () => (db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n;
    expect(count()).toBe(1);
    db.prepare('UPDATE sessions SET expires_at = 1').run();
    await sleep(100);
    expect(count()).toBe(0);
    expect((await fetch(`${srv.url}/api/voice/ice`, { headers: { cookie } })).status).toBe(401);
  });

  it('snapshots running games and closes cleanly on shutdown', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hexhaven-'));
    const dbPath = join(dir, 'shutdown.sqlite');
    try {
      srv = await startServer({ dbPath });
      const host = await player(srv.url, 'Host');
      const room = await ok(host.socket, 'room:create', { settings: { maxSeats: 3 } });
      await ok(host.socket, 'room:addBot', { seat: 1, difficulty: 'easy' });
      await ok(host.socket, 'room:addBot', { seat: 2, difficulty: 'easy' });
      await ok(host.socket, 'room:start', {});
      // BUY_DEV is not snapshotted during play, only the action is logged.
      await ok(host.socket, 'game:action', { expectedVersion: 0, action: { type: 'BUY_DEV' } });
      const gameId = srv.server.rooms.get(room.id)!.gameId!;
      expect(srv.server.repos.games.latestSnapshot(gameId)!.version).toBe(0);

      await srv.close();
      srv = null;
      expect(host.socket.connected).toBe(false);
      const db = openDb(dbPath);
      try {
        expect(createGamesRepo(db).latestSnapshot(gameId)!.version).toBe(1);
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('serves a CSP that allows Google Identity and the same-origin socket', async () => {
    srv = await startServer({ publicOrigin: 'https://game.example', secureCookies: true });
    const csp = (await fetch(`${srv.url}/api/health`)).headers.get('content-security-policy')!;
    expect(csp).toMatch(/script-src 'self' https:\/\/accounts\.google\.com/);
    expect(csp).toMatch(/connect-src 'self' https:\/\/accounts\.google\.com wss:\/\/game\.example/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    const login = await fetch(`${srv.url}/api/auth/guest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://game.example' },
      body: JSON.stringify({ name: 'Ann' }),
    });
    const setCookie = login.headers.getSetCookie().find((c) => c.startsWith('sid='))!;
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    // The secure cookie is still accepted over the test's plain-http socket.
    const s = await connect(srv.url, setCookie.split(';')[0], 'https://game.example');
    expect(s.connected).toBe(true);
  });
});
