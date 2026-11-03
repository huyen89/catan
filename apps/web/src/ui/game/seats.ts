import { useCallback } from 'react';
import type { Seat } from '@hexhaven/engine';
import type { SeatInfo } from '@hexhaven/shared';
import { seatColor } from '../../game/colors';
import { useRoomStore } from '../../store/room';

/** Game seat i is room seat i (the game starts only when every room seat is filled). */
export function useSeatMeta() {
  const seats = useRoomStore((s) => s.room?.seats);
  const seatInfo = useCallback((seat: Seat): SeatInfo | undefined => seats?.[seat], [seats]);
  const nameOf = useCallback((seat: Seat) => seats?.[seat]?.name || `Player ${seat + 1}`, [seats]);
  const colorOf = useCallback((seat: Seat) => seats?.[seat]?.color || seatColor(seat), [seats]);
  return { seatInfo, nameOf, colorOf };
}
