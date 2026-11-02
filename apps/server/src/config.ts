import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { IceConfig } from './voice/ice';

const HERE = dirname(fileURLToPath(import.meta.url));
/** apps/web/dist relative to apps/server/src. */
const DEFAULT_WEB_DIST = resolve(HERE, '../../web/dist');
const TEST_SESSION_SECRET = 'test-mode-session-secret-not-for-production';

const optionalString = z
  .string()
  .trim()
  .transform((s) => (s === '' ? undefined : s))
  .optional();

const csv = optionalString.transform((s) =>
  s
    ? s
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
    : undefined,
);

const envSchema = z.object({
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  DB_PATH: z.string().min(1).default('./data/hexhaven.sqlite'),
  SESSION_SECRET: optionalString,
  PUBLIC_ORIGIN: optionalString.pipe(z.url().optional()),
  GOOGLE_CLIENT_ID: optionalString,
  ALLOWED_EMAILS: csv,
  GUEST_INVITE_CODE: optionalString,
  TEST_MODE: optionalString,
  RECONNECT_GRACE_MS: z.coerce.number().int().min(0).optional(),
  BOT_DELAY_MS: z.coerce.number().int().min(0).optional(),
  WEB_DIST: optionalString,
  TURN_PROVIDER: z.enum(['cloudflare', 'coturn', 'none']).default('none'),
  CF_TURN_KEY_ID: optionalString,
  CF_TURN_API_TOKEN: optionalString,
  COTURN_URLS: csv,
  COTURN_SECRET: optionalString,
  TURN_TTL_SEC: z.coerce.number().int().min(60).max(86400).default(3600),
});

export interface Config {
  port: number;
  host: string;
  dbPath: string;
  sessionSecret: string;
  /** Normalised origin (scheme://host[:port]) or null when not configured. */
  publicOrigin: string | null;
  /** Cookies get the Secure flag when the public origin is https. */
  secureCookies: boolean;
  googleClientId: string | null;
  /** Lower-cased allow-list of Google account emails; null = any verified account. */
  allowedEmails: string[] | null;
  guestInviteCode: string | null;
  testMode: boolean;
  reconnectGraceMs: number;
  botDelayMs: number;
  webDist: string;
  ice: IceConfig;
}

/** Load `.env` from the working directory if present (real env vars win). */
export function loadDotEnv(path = resolve(process.cwd(), '.env')): void {
  if (existsSync(path)) process.loadEnvFile(path);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);
  }
  const e = parsed.data;
  const testMode = e.TEST_MODE === '1';

  const sessionSecret = e.SESSION_SECRET ?? (testMode ? TEST_SESSION_SECRET : undefined);
  if (!sessionSecret || sessionSecret.length < 16) {
    throw new Error('Invalid configuration: SESSION_SECRET is required (at least 16 characters)');
  }
  const publicOrigin = e.PUBLIC_ORIGIN ? new URL(e.PUBLIC_ORIGIN).origin : null;

  return {
    port: e.PORT,
    host: e.HOST,
    dbPath: e.DB_PATH,
    sessionSecret,
    publicOrigin,
    secureCookies: publicOrigin?.startsWith('https:') ?? false,
    googleClientId: e.GOOGLE_CLIENT_ID ?? null,
    allowedEmails: e.ALLOWED_EMAILS?.map((x) => x.toLowerCase()) ?? null,
    guestInviteCode: e.GUEST_INVITE_CODE ?? null,
    testMode,
    reconnectGraceMs: e.RECONNECT_GRACE_MS ?? (testMode ? 1500 : 30000),
    botDelayMs: e.BOT_DELAY_MS ?? (testMode ? 0 : 900),
    webDist: e.WEB_DIST ? resolve(e.WEB_DIST) : DEFAULT_WEB_DIST,
    ice: {
      provider: e.TURN_PROVIDER,
      cloudflareKeyId: e.CF_TURN_KEY_ID,
      cloudflareApiToken: e.CF_TURN_API_TOKEN,
      coturnUrls: e.COTURN_URLS,
      coturnSecret: e.COTURN_SECRET,
      ttlSec: e.TURN_TTL_SEC,
    },
  };
}
