import type { AddressInfo } from 'node:net';
import type {
  Ack,
  C2SAckData,
  C2SEvent,
  C2SPayload,
  ClientToServerEvents,
  ServerToClientEvents,
} from '@hexhaven/shared';
import { io as ioClient, type Socket } from 'socket.io-client';
import { buildServer, type HexhavenServer, type ServerDeps } from '../app';
import { loadConfig, type Config } from '../config';
import { createFakeBot, createFakeEngine } from './fakeEngine';

export type TestClient = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface TestServer {
  server: HexhavenServer;
  config: Config;
  url: string;
  close(): Promise<void>;
}

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    ...loadConfig({ TEST_MODE: '1', DB_PATH: ':memory:', WEB_DIST: '/nonexistent-web-dist' }),
    reconnectGraceMs: 200,
    ...overrides,
  };
}

/** buildServer on an ephemeral port with the fake engine/bot unless overridden. */
export async function startServer(
  overrides: Partial<Config> = {},
  deps: ServerDeps = {},
): Promise<TestServer> {
  const config = testConfig(overrides);
  const server = await buildServer(config, {
    engine: createFakeEngine(),
    bots: createFakeBot().bots,
    logger: false,
    ...deps,
  });
  await server.app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = server.app.server.address() as AddressInfo;
  return {
    server,
    config,
    url: `http://127.0.0.1:${port}`,
    close: () => server.close(),
  };
}

/** Guest login; returns the `sid=...` cookie pair. */
export async function guestLogin(url: string, name: string, inviteCode?: string): Promise<string> {
  const res = await fetch(`${url}/api/auth/guest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(inviteCode === undefined ? { name } : { name, inviteCode }),
  });
  if (res.status !== 200) throw new Error(`guest login failed: ${res.status}`);
  return cookieFrom(res);
}

export function cookieFrom(res: Response): string {
  const raw = res.headers.getSetCookie().find((c) => c.startsWith('sid='));
  if (!raw) throw new Error('no sid cookie');
  return raw.split(';')[0]!;
}

const openClients = new Set<TestClient>();

export function connect(url: string, cookie?: string, origin?: string): Promise<TestClient> {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = origin;
  const socket: TestClient = ioClient(url, {
    transports: ['websocket'],
    extraHeaders: headers,
    reconnection: false,
    forceNew: true,
  });
  openClients.add(socket);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (e) => reject(e));
  });
}

export function disconnectAll(): void {
  for (const s of openClients) s.disconnect();
  openClients.clear();
}

export function emit<E extends C2SEvent>(
  socket: TestClient,
  event: E,
  payload: C2SPayload<E>,
): Promise<Ack<C2SAckData[E]>> {
  return new Promise((resolve) => {
    (socket.emit as (e: string, p: unknown, cb: (r: Ack<C2SAckData[E]>) => void) => void)(
      event,
      payload,
      resolve,
    );
  });
}

/** Like emit but throws on `{ok:false}`. */
export async function ok<E extends C2SEvent>(
  socket: TestClient,
  event: E,
  payload: C2SPayload<E>,
): Promise<C2SAckData[E]> {
  const r = await emit(socket, event, payload);
  if (!r.ok) throw new Error(`${event} failed: ${r.error.code} ${r.error.message}`);
  return r.data;
}

/** Resolve with the next `event` payload matching `pred` (rejects after `ms`). */
export function next<K extends keyof ServerToClientEvents>(
  socket: TestClient,
  event: K,
  pred: (p: Parameters<ServerToClientEvents[K]>[0]) => boolean = () => true,
  ms = 5000,
): Promise<Parameters<ServerToClientEvents[K]>[0]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`timed out waiting for ${String(event)}`));
    }, ms);
    const handler = (p: Parameters<ServerToClientEvents[K]>[0]) => {
      if (!pred(p)) return;
      off();
      resolve(p);
    };
    const s = socket as unknown as {
      on(e: string, h: (p: unknown) => void): void;
      off(e: string, h: (p: unknown) => void): void;
    };
    const off = () => {
      clearTimeout(timer);
      s.off(event, handler as (p: unknown) => void);
    };
    s.on(event, handler as (p: unknown) => void);
  });
}

/** Log a guest in and open a socket for them. */
export async function player(url: string, name: string) {
  const cookie = await guestLogin(url, name);
  const socket = await connect(url, cookie);
  const me = (await (await fetch(`${url}/api/me`, { headers: { cookie } })).json()) as {
    user: { id: string };
  };
  return { cookie, socket, userId: me.user.id };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
