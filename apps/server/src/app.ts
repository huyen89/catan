import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { createGoogleVerifier, type GoogleVerifier } from './auth/google';
import { registerAuthRoutes, requireUser } from './auth/routes';
import { SessionService } from './auth/sessions';
import type { Config } from './config';
import { createRepos, openDb, type Repos } from './db';
import { AppError } from './errors';
import { registerHistoryRoutes } from './http/history';
import { helmetOptions } from './http/security';
import { registerStatic } from './http/static';
import { createSocketServer } from './realtime/socket';
import type { HexServer } from './realtime/types';
import { realBots, realEngine, type BotFactory, type EngineApi } from './rooms/engineApi';
import { RoomManager } from './rooms/RoomManager';
import { registerTestRoutes } from './testing/testRoutes';
import { getIceServers } from './voice/ice';

/** Injectable collaborators (tests swap in fakes). */
export interface ServerDeps {
  engine?: EngineApi;
  bots?: BotFactory;
  /** Overrides the google-auth-library verifier. */
  verifyGoogleToken?: GoogleVerifier;
  logger?: FastifyServerOptions['logger'];
  lobbyIdleMs?: number;
  random?: () => number;
  /** Expired-session prune interval (default hourly). */
  sessionSweepMs?: number;
}

export interface HexhavenServer {
  app: FastifyInstance;
  io: HexServer;
  rooms: RoomManager;
  repos: Repos;
  close(): Promise<void>;
}

const SESSION_SWEEP_MS = 60 * 60 * 1000;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function buildServer(config: Config, deps: ServerDeps = {}): Promise<HexhavenServer> {
  const app = Fastify({
    logger: deps.logger ?? { level: config.testMode ? 'warn' : 'info' },
    trustProxy: true,
    bodyLimit: 64 * 1024,
  });
  const repos = createRepos(openDb(config.dbPath));
  const sessions = new SessionService(repos, config.sessionSecret, config.secureCookies);

  await app.register(fastifyCookie);
  await app.register(fastifyHelmet, helmetOptions(config));
  await app.register(fastifyRateLimit, { global: false });

  // CSRF defence in depth (cookies are SameSite=Lax): browsers always send Origin on
  // cross-origin state-changing requests, so a mismatch is rejected outright.
  app.addHook('onRequest', async (req) => {
    if (!config.publicOrigin || SAFE_METHODS.has(req.method)) return;
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== config.publicOrigin) {
      throw new AppError('FORBIDDEN_ORIGIN', 'Cross-origin request rejected', 403);
    }
  });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    if (err instanceof AppError) return reply.status(err.httpStatus).send({ error: err.toAck() });
    if (err.statusCode && err.statusCode < 500) {
      const code = err.statusCode === 429 ? 'RATE_LIMITED' : 'BAD_REQUEST';
      return reply.status(err.statusCode).send({ error: { code, message: err.message } });
    }
    req.log.error({ err }, 'request failed');
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Internal error' } });
  });

  const sockets = createSocketServer(app.server, { config, sessions, log: app.log });
  const rooms = new RoomManager({
    io: sockets.io,
    repos,
    engine: deps.engine ?? realEngine,
    bots: deps.bots ?? realBots,
    config,
    log: app.log,
    lobbyIdleMs: deps.lobbyIdleMs,
    random: deps.random,
  });
  sockets.attach(rooms);

  const verifyGoogleToken =
    deps.verifyGoogleToken ??
    (config.googleClientId ? createGoogleVerifier(config.googleClientId) : null);
  await registerAuthRoutes(app, {
    config,
    repos,
    sessions,
    verifyGoogleToken,
    onLogout: (hash) => sockets.disconnectSession(hash),
  });

  app.get('/api/health', async () => ({ ok: true }));
  app.get(
    '/api/voice/ice',
    {
      preHandler: requireUser,
      config: { rateLimit: { max: config.testMode ? 1000 : 30, timeWindow: '1 minute' } },
    },
    async (req) => getIceServers(req.user!.id, config.ice),
  );
  await registerHistoryRoutes(app, { repos, testMode: config.testMode });

  if (config.testMode) await registerTestRoutes(app, rooms);
  await registerStatic(app, config.webDist);

  rooms.recover();

  const pruneSessions = () => {
    const n = repos.sessions.deleteExpired(Date.now());
    if (n > 0) app.log.info({ count: n }, 'pruned expired sessions');
  };
  pruneSessions();
  const sweep = setInterval(pruneSessions, deps.sessionSweepMs ?? SESSION_SWEEP_MS);
  sweep.unref();

  // Graceful shutdown (app.close, e.g. on SIGTERM): stop the sweep, snapshot running games and
  // stop their timers, drop sockets; the HTTP server then stops accepting and the DB closes.
  app.addHook('preClose', async () => {
    clearInterval(sweep);
    rooms.closeAll();
    sockets.io.disconnectSockets(true);
    sockets.io.engine.close();
  });
  app.addHook('onClose', async () => {
    repos.db.close();
  });

  return { app, io: sockets.io, rooms, repos, close: () => app.close() };
}
