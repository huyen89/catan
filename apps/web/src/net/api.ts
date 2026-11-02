import type { GuestLoginBody, LoginResponse, MeResponse } from '@hexhaven/shared';

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Pull a readable message out of an error body: `{error:{message}}`, `{error:"…"}` or `{message}`. */
export function apiErrorMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const b = body as { error?: unknown; message?: unknown };
    if (b.error && typeof b.error === 'object') {
      const m = (b.error as { message?: unknown }).message;
      if (typeof m === 'string' && m) return m;
    }
    if (typeof b.error === 'string' && b.error) return b.error;
    if (typeof b.message === 'string' && b.message) return b.message;
  }
  return `Request failed (${status})`;
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) throw new ApiError(res.status, apiErrorMessage(data, res.status));
  return data as T;
}

export const api = {
  me: () => request<MeResponse>('GET', '/api/me'),
  guest: (body: GuestLoginBody) => request<LoginResponse>('POST', '/api/auth/guest', body),
  google: (credential: string) =>
    request<LoginResponse>('POST', '/api/auth/google', { credential }),
  logout: () => request<unknown>('POST', '/api/auth/logout', {}),
};
