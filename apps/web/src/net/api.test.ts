import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from './api';

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(body === undefined ? '' : JSON.stringify(body), { status }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('history / replay / stats API', () => {
  it('GETs the contract paths with the session cookie', async () => {
    const f = mockFetch(200, { games: [] });
    await expect(api.games()).resolves.toEqual({ games: [] });
    expect(f.mock.calls[0]![0]).toBe('/api/games');
    expect(f.mock.calls[0]![1]).toMatchObject({ method: 'GET', credentials: 'same-origin' });

    mockFetch(200, { played: 0 });
    await api.stats();
    const r = mockFetch(200, {});
    await api.replay('a/b c');
    expect(r.mock.calls[0]![0]).toBe('/api/games/a%2Fb%20c/replay');
  });

  it('turns error bodies into ApiError with the server message', async () => {
    mockFetch(403, { error: { code: 'FORBIDDEN', message: 'Not your game' } });
    const err = await api.replay('g1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 403, message: 'Not your game' });
  });
});
