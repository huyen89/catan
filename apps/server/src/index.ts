import { buildServer } from './app';
import { loadConfig, loadDotEnv } from './config';

loadDotEnv();
const config = loadConfig();
const server = await buildServer(config);
await server.app.listen({ port: config.port, host: config.host });

let closing = false;
const shutdown = (signal: string) => {
  if (closing) return;
  closing = true;
  server.app.log.info({ signal }, 'shutting down');
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  server.close().then(
    () => process.exit(0),
    (err: unknown) => {
      server.app.log.error({ err }, 'shutdown failed');
      process.exit(1);
    },
  );
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
