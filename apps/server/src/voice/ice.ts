import { createHmac } from 'node:crypto';
import { z } from 'zod';
import type { IceResponse } from '@hexhaven/shared';

export interface IceConfig {
  provider: 'cloudflare' | 'coturn' | 'none';
  cloudflareKeyId?: string;
  cloudflareApiToken?: string;
  coturnUrls?: string[];
  coturnSecret?: string;
  ttlSec: number;
}

export type IceServer = IceResponse['iceServers'][number];

/** Public STUN server that is always offered (free, no credentials). */
export const STUN_SERVER: IceServer = { urls: 'stun:stun.cloudflare.com:3478' };

/** Fresh Cloudflare credentials are reused for this long per user to avoid hammering the API. */
export const ICE_CACHE_MS = 60_000;
const FETCH_TIMEOUT_MS = 5_000;
const MIN_TTL_SEC = 60;
const MAX_TTL_SEC = 48 * 3600;
const DEFAULT_TTL_SEC = 6 * 3600;

const cloudflareServerSchema = z.object({
  urls: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  username: z.string().optional(),
  credential: z.string().optional(),
});
const cloudflareResponseSchema = z.object({
  iceServers: z.union([cloudflareServerSchema, z.array(cloudflareServerSchema)]),
});

function clampTtl(ttlSec: number): number {
  if (!Number.isFinite(ttlSec)) return DEFAULT_TTL_SEC;
  return Math.min(MAX_TTL_SEC, Math.max(MIN_TTL_SEC, Math.floor(ttlSec)));
}

/**
 * Browsers block port 53, so TURN URLs on :53 only add connection-check timeouts
 * (Cloudflare's docs recommend dropping them).
 */
function isUsableUrl(url: string): boolean {
  return !/:53(\?|$)/.test(url);
}

/**
 * Normalizes a Cloudflare `generate-ice-servers` response (object or array form) into an
 * array, dropping unusable URLs. Throws when the shape is unexpected.
 */
export function normalizeCloudflareIceServers(json: unknown): IceServer[] {
  const parsed = cloudflareResponseSchema.parse(json);
  const list = Array.isArray(parsed.iceServers) ? parsed.iceServers : [parsed.iceServers];
  const out: IceServer[] = [];
  for (const s of list) {
    const urls = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter(isUsableUrl);
    if (urls.length === 0) continue;
    const server: IceServer = { urls };
    if (s.username !== undefined) server.username = s.username;
    if (s.credential !== undefined) server.credential = s.credential;
    out.push(server);
  }
  return out;
}

/** "TURN REST API" credentials (coturn `use-auth-secret`). */
export function coturnCredentials(
  userId: string,
  secret: string,
  ttlSec: number,
  nowMs: number = Date.now(),
): { username: string; credential: string } {
  const expiry = Math.floor(nowMs / 1000) + ttlSec;
  const username = `${expiry}:${userId}`;
  const credential = createHmac('sha1', secret).update(username).digest('base64');
  return { username, credential };
}

interface CacheEntry {
  key: string;
  fetchedAt: number;
  servers: IceServer[];
  ttl: number;
}
const cache = new Map<string, CacheEntry>();

/** Test helper: forget cached Cloudflare credentials. */
export function clearIceCache(): void {
  cache.clear();
}

function pruneCache(now: number): void {
  for (const [userId, entry] of cache) {
    if (now - entry.fetchedAt >= ICE_CACHE_MS) cache.delete(userId);
  }
}

async function fetchCloudflare(cfg: IceConfig, ttl: number): Promise<IceServer[]> {
  const url = `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(
    cfg.cloudflareKeyId ?? '',
  )}/credentials/generate-ice-servers`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.cloudflareApiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ttl }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Cloudflare TURN API responded ${res.status}`);
  return normalizeCloudflareIceServers(await res.json());
}

/**
 * Short-lived ICE servers for a user. Always includes a public STUN server.
 * Owned by workstream V. Route GET /api/voice/ice (auth required) is wired by workstream S.
 * Never throws: provider failures degrade to STUN-only (works for most home NATs).
 */
export async function getIceServers(userId: string, cfg: IceConfig): Promise<IceResponse> {
  const ttl = clampTtl(cfg.ttlSec);
  const stunOnly: IceResponse = { iceServers: [STUN_SERVER], ttl };

  if (cfg.provider === 'coturn') {
    const urls = cfg.coturnUrls?.filter((u) => u.length > 0) ?? [];
    if (!cfg.coturnSecret || urls.length === 0) {
      console.warn('[voice] TURN_PROVIDER=coturn but COTURN_URLS/COTURN_SECRET missing');
      return stunOnly;
    }
    const creds = coturnCredentials(userId, cfg.coturnSecret, ttl);
    return { iceServers: [STUN_SERVER, { urls, ...creds }], ttl };
  }

  if (cfg.provider === 'cloudflare') {
    if (!cfg.cloudflareKeyId || !cfg.cloudflareApiToken) {
      console.warn('[voice] TURN_PROVIDER=cloudflare but CF_TURN_KEY_ID/CF_TURN_API_TOKEN missing');
      return stunOnly;
    }
    const now = Date.now();
    pruneCache(now);
    const key = `${cfg.cloudflareKeyId}:${ttl}`;
    const hit = cache.get(userId);
    if (hit && hit.key === key) {
      const elapsed = Math.floor((now - hit.fetchedAt) / 1000);
      return { iceServers: [STUN_SERVER, ...hit.servers], ttl: Math.max(1, hit.ttl - elapsed) };
    }
    try {
      const servers = await fetchCloudflare(cfg, ttl);
      cache.set(userId, { key, fetchedAt: now, servers, ttl });
      return { iceServers: [STUN_SERVER, ...servers], ttl };
    } catch (err) {
      console.warn(
        '[voice] Cloudflare TURN credentials unavailable, falling back to STUN only:',
        err instanceof Error ? err.message : err,
      );
      return stunOnly;
    }
  }

  return stunOnly;
}

/** Builds an IceConfig from environment variables (TURN_PROVIDER, CF_TURN_*, COTURN_*, TURN_TTL_SEC). */
export function iceConfigFromEnv(env: NodeJS.ProcessEnv = process.env): IceConfig {
  const raw = (env.TURN_PROVIDER ?? 'none').trim().toLowerCase();
  const provider: IceConfig['provider'] = raw === 'cloudflare' || raw === 'coturn' ? raw : 'none';
  const ttlRaw = env.TURN_TTL_SEC?.trim();
  const ttlSec = ttlRaw ? clampTtl(Number(ttlRaw)) : DEFAULT_TTL_SEC;
  return {
    provider,
    cloudflareKeyId: env.CF_TURN_KEY_ID?.trim() || undefined,
    cloudflareApiToken: env.CF_TURN_API_TOKEN?.trim() || undefined,
    coturnUrls: (env.COTURN_URLS ?? '')
      .split(',')
      .map((u) => u.trim())
      .filter((u) => u.length > 0),
    coturnSecret: env.COTURN_SECRET || undefined,
    ttlSec,
  };
}
