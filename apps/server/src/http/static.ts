import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

const isAppRoute = (url: string) => !url.startsWith('/api') && !url.startsWith('/socket.io');

/**
 * Serve the built web app (if present) with an SPA fallback: unknown non-API GETs return
 * index.html. Unknown API routes always get a JSON 404.
 */
export async function registerStatic(app: FastifyInstance, webDist: string): Promise<void> {
  const hasWeb = existsSync(join(webDist, 'index.html'));
  if (hasWeb) {
    await app.register(fastifyStatic, {
      root: webDist,
      setHeaders: (reply, path) => {
        if (path.endsWith('index.html')) reply.header('Cache-Control', 'no-cache');
      },
    });
  }
  app.setNotFoundHandler((req, reply) => {
    if (hasWeb && (req.method === 'GET' || req.method === 'HEAD') && isAppRoute(req.url)) {
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    }
    return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });
}
