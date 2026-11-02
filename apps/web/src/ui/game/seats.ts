import { useCallback } from 'react';
import type { Seat } from '@hexhaven/engine';
import { PLAYER_COLORS, type SeatInfo } from '@hexhaven/shared';
import { useRoomStore } from '../../store/room';

/** Game seat i is room seat i (the game starts only when every room seat is filled). */
export function useSeatMeta() {
  const seats = useRoomStore((s) => s.room?.seats);
  const seatInfo = useCallback((seat: Seat): SeatInfo | undefined => seats?.[seat], [seats]);
  const nameOf = useCallback((seat: Seat) => seats?.[seat]?.name || `Player ${seat + 1}`, [seats]);
  const colorOf = useCallback(
    (seat: Seat) => seats?.[seat]?.color || PLAYER_COLORS[seat % PLAYER_COLORS.length]!,
    [seats],
  );
  return { seatInfo, nameOf, colorOf };
}
