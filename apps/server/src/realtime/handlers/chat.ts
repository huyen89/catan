import type { FastifyBaseLogger } from 'fastify';
import { AppError } from '../../errors';
import type { RoomManager } from '../../rooms/RoomManager';
import { on } from '../handle';
import { chatBucket } from '../rateLimit';
import type { HexSocket } from '../types';

export function registerChatHandlers(
  socket: HexSocket,
  rooms: RoomManager,
  log: FastifyBaseLogger,
): void {
  const bucket = chatBucket();
  on(socket, 'chat:send', log, (p) => {
    if (!bucket.take()) throw new AppError('RATE_LIMITED', 'Slow down a little');
    rooms.chat(socket, p.text);
  });
}
