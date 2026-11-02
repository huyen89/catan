import type { FastifyBaseLogger } from 'fastify';
import type { RoomManager } from '../../rooms/RoomManager';
import { AppError } from '../../errors';
import { on } from '../handle';
import { createBucket } from '../rateLimit';
import type { HexSocket } from '../types';

export function registerLobbyHandlers(
  socket: HexSocket,
  rooms: RoomManager,
  log: FastifyBaseLogger,
): void {
  const creates = createBucket();
  on(socket, 'room:create', log, (p) => {
    if (!creates.take()) throw new AppError('RATE_LIMITED', 'Too many rooms created');
    return rooms.create(socket, p.settings);
  });
  on(socket, 'room:join', log, (p) => rooms.join(socket, p.code));
  on(socket, 'room:leave', log, () => rooms.leave(socket));
  on(socket, 'room:sit', log, (p) => rooms.sit(socket, p.seat));
  on(socket, 'room:stand', log, () => rooms.stand(socket));
  on(socket, 'room:ready', log, (p) => rooms.ready(socket, p.ready));
  on(socket, 'room:addBot', log, (p) => rooms.addBot(socket, p.seat, p.difficulty));
  on(socket, 'room:removeBot', log, (p) => rooms.removeBot(socket, p.seat));
  on(socket, 'room:kick', log, (p) => rooms.kick(socket, p.userId));
  on(socket, 'room:settings', log, (p) => rooms.updateSettings(socket, p.settings));
  on(socket, 'room:start', log, () => rooms.start(socket));
  on(socket, 'room:rematch', log, () => rooms.rematch(socket));
}
