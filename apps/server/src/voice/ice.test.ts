import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ICE_CACHE_MS,
  STUN_SERVER,
  clearIceCache,
  coturnCredentials,
  getIceServers,
  iceConfigFromEnv,
  normalizeCloudflareIceServers,
  type IceConfig,
} from './ice';

const cf: IceConfig = {
  provider: 'cloudflare',
  cloudflareKeyId: 'key123',
  cloudflareApiToken: 'tok456',
  ttlSec: 3600,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('normalizeCloudflareIceServers', () => {
  it('wraps the single-object form into an array', () => {
    const out = normalizeCloudflareIceServers({
      iceServers: {
        urls: ['turn:turn.cloudflare.com:3478?transport=udp'],
        username: 'u',
        credential: 'c',
      },
    });
    expect(out).toEqual([
      { urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'u', credential: 'c' },
    ]);
  });

  it('keeps the array form and drops port-53 URLs browsers block', () => {
    const out = normalizeCloudflareIceServers({
      iceServers: [
        { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
        {
          urls: [
            'turn:turn.cloudflare.com:3478?transport=udp',
            'turn:turn.cloudflare.com:53?transport=udp',
            'turns:turn.cloudflare.com:443?transport=tcp',
          ],
          username: 'u',
          credential: 'c',
        },
        { urls: 'turn:turn.cloudflare.com:53' },
      ],
    });
    expect(out).toEqual([
      { urls: ['stun:stun.cloudflare.com:3478'] },
      {
        urls: [
          'turn:turn.cloudflare.com:3478?transport=udp',
          'turns:turn.cloudflare.com:443?transport=tcp',
        ],
        username: 'u',
        credential: 'c',
      },
    ]);
  });

  it('rejects unexpected shapes', () => {
    expect(() => normalizeCloudflareIceServers({})).toThrow();
    expect(() => normalizeCloudflareIceServers({ iceServers: [{ urls: 5 }] })).toThrow();
  });
});

describe('coturnCredentials', () => {
  it('follows the TURN REST API scheme', () => {
    const now = 1_700_000_000_000;
    const { username, credential } = coturnCredentials('user-1', 's3cret', 600, now);
    expect(username).toBe(`${1_700_000_000 + 600}:user-1`);
    expect(credential).toBe(createHmac('sha1', 's3cret').update(username).digest('base64'));
  });
});

describe('getIceServers', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    clearIceCache();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('provider none: STUN only', async () => {
    const res = await getIceServers('u1', { provider: 'none', ttlSec: 3600 });
    expect(res).toEqual({ iceServers: [STUN_SERVER], ttl: 3600 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cloudflare: calls the API with bearer token and ttl, prepends STUN', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        iceServers: {
          urls: ['turn:turn.cloudflare.com:3478?transport=udp'],
          username: 'cfuser',
          credential: 'cfpass',
        },
      }),
    );
    const res = await getIceServers('u1', cf);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      'https://rtc.live.cloudflare.com/v1/turn/keys/key123/credentials/generate-ice-servers',
    );
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok456');
    expect(JSON.parse(init?.body as string)).toEqual({ ttl: 3600 });
    expect(res).toEqual({
      iceServers: [
        STUN_SERVER,
        {
          urls: ['turn:turn.cloudflare.com:3478?transport=udp'],
          username: 'cfuser',
          credential: 'cfpass',
        },
      ],
      ttl: 3600,
    });
  });

  it('cloudflare: caches per user briefly, then refetches', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    fetchMock.mockImplementation(async () =>
      jsonResponse({ iceServers: [{ urls: 'turn:t:3478', username: 'a', credential: 'b' }] }),
    );
    await getIceServers('u1', cf);
    vi.setSystemTime(1_000_000 + 10_000);
    const cached = await getIceServers('u1', cf);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cached.ttl).toBe(3590);
    await getIceServers('u2', cf);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.setSystemTime(1_000_000 + ICE_CACHE_MS + 1);
    await getIceServers('u1', cf);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('cloudflare: falls back to STUN on HTTP errors, network errors and bad JSON', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'nope' }, 401));
    expect((await getIceServers('u1', cf)).iceServers).toEqual([STUN_SERVER]);
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    expect((await getIceServers('u1', cf)).iceServers).toEqual([STUN_SERVER]);
    fetchMock.mockResolvedValueOnce(jsonResponse({ iceServers: 'garbage' }));
    expect((await getIceServers('u1', cf)).iceServers).toEqual([STUN_SERVER]);
    expect(console.warn).toHaveBeenCalledTimes(3);
  });

  it('cloudflare: missing credentials means STUN only without calling the API', async () => {
    const res = await getIceServers('u1', { provider: 'cloudflare', ttlSec: 3600 });
    expect(res.iceServers).toEqual([STUN_SERVER]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('coturn: short-lived HMAC credentials for the configured URLs', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000_000);
    const res = await getIceServers('u9', {
      provider: 'coturn',
      coturnUrls: ['turn:turn.example.com:3478?transport=udp'],
      coturnSecret: 'secret',
      ttlSec: 600,
    });
    const username = `${2_000_000 + 600}:u9`;
    expect(res).toEqual({
      iceServers: [
        STUN_SERVER,
        {
          urls: ['turn:turn.example.com:3478?transport=udp'],
          username,
          credential: createHmac('sha1', 'secret').update(username).digest('base64'),
        },
      ],
      ttl: 600,
    });
  });

  it('coturn: misconfiguration degrades to STUN only', async () => {
    const res = await getIceServers('u9', { provider: 'coturn', ttlSec: 600 });
    expect(res.iceServers).toEqual([STUN_SERVER]);
  });

  it('clamps absurd TTLs', async () => {
    expect((await getIceServers('u', { provider: 'none', ttlSec: 1 })).ttl).toBe(60);
    expect((await getIceServers('u', { provider: 'none', ttlSec: 1e9 })).ttl).toBe(48 * 3600);
  });
});

describe('iceConfigFromEnv', () => {
  it('parses provider, URLs and TTL', () => {
    expect(
      iceConfigFromEnv({
        TURN_PROVIDER: 'Coturn',
        COTURN_URLS: ' turn:a:3478 , turns:a:5349?transport=tcp ,',
        COTURN_SECRET: 'x',
        TURN_TTL_SEC: '900',
      }),
    ).toEqual({
      provider: 'coturn',
      cloudflareKeyId: undefined,
      cloudflareApiToken: undefined,
      coturnUrls: ['turn:a:3478', 'turns:a:5349?transport=tcp'],
      coturnSecret: 'x',
      ttlSec: 900,
    });
  });

  it('defaults to none with a 6h TTL', () => {
    const cfg = iceConfigFromEnv({ TURN_PROVIDER: 'bogus', TURN_TTL_SEC: '' });
    expect(cfg.provider).toBe('none');
    expect(cfg.ttlSec).toBe(6 * 3600);
  });
});
