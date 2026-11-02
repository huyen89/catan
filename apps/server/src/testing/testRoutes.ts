import type { FastifyInstance } from 'fastify';
import { resourceCountsSchema } from '@hexhaven/shared';
import { z } from 'zod';
import { parseBody } from '../auth/routes';
import type { RoomManager } from '../rooms/RoomManager';

const codeParams = z.strictObject({ code: z.string().trim().toUpperCase().length(6) });
const seedBody = z.strictObject({ seed: z.string().min(1).max(128) });
const giveBody = z.strictObject({
  seat: z.number().int().min(0).max(5),
  resources: resourceCountsSchema.partial(),
});

/**
 * E2E helpers. Registered ONLY when TEST_MODE=1 (see app.ts); they bypass every game rule.
 */
export async function registerTestRoutes(app: FastifyInstance, rooms: RoomManager): Promise<void> {
  app.post('/api/test/reset', async () => {
    rooms.reset();
    return { ok: true };
  });

  app.post('/api/test/rooms/:code/seed', async (req) => {
    const { code } = parseBody(codeParams, req.params);
    rooms.setTestSeed(code, parseBody(seedBody, req.body).seed);
    return { ok: true };
  });

  app.post('/api/test/rooms/:code/give', async (req) => {
    const { code } = parseBody(codeParams, req.params);
    const { seat, resources } = parseBody(giveBody, req.body);
    await rooms.testGive(code, seat, resources);
    return { ok: true };
  });

  app.get('/api/test/rooms/:code/state', async (req) => {
    const { code } = parseBody(codeParams, req.params);
    return rooms.testState(code);
  });
}
