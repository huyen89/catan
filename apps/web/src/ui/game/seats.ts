import { useCallback } from 'react';
import type { Seat } from '@hexhaven/engine';
import type { SeatInfo } from '@hexhaven/shared';
import { useRoomStore } from '../../store/room';

const FALLBACK_COLORS = ['#d9480f', '#1971c2', '#f8f9fa', '#e8a10c', '#2f9e44', '#862e9c'];

/** Game seat i is room seat i (the game starts only when every room seat is filled). */
export function useSeatMeta() {
  const seats = useRoomStore((s) => s.room?.seats);
  const seatInfo = useCallback((seat: Seat): SeatInfo | undefined => seats?.[seat], [seats]);
  const nameOf = useCallback((seat: Seat) => seats?.[seat]?.name || `Player ${seat + 1}`, [seats]);
  const colorOf = useCallback(
    (seat: Seat) => seats?.[seat]?.color || FALLBACK_COLORS[seat % FALLBACK_COLORS.length]!,
    [seats],
  );
  return { seatInfo, nameOf, colorOf };
}
