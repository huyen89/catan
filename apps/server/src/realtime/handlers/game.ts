import type { FastifyBaseLogger } from 'fastify';
import type { RoomManager } from '../../rooms/RoomManager';
import { on } from '../handle';
import type { HexSocket } from '../types';

export function registerGameHandlers(
  socket: HexSocket,
  rooms: RoomManager,
  log: FastifyBaseLogger,
): void {
  // Seat ownership is resolved from socket.data.userId inside the runner; clients never name a seat.
  on(socket, 'game:action', log, (p) => rooms.gameAction(socket, p.expectedVersion, p.action));
  on(socket, 'game:sync', log, () => rooms.gameSync(socket));
}
