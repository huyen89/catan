import type { RoomInfo, RoomSettings } from '@hexhaven/shared';

/** The host may start once every seat is filled and every human is ready. */
export function canStart(room: RoomInfo): boolean {
  const seats = room.seats.slice(0, room.settings.maxSeats);
  return (
    seats.length === room.settings.maxSeats &&
    seats.every((s) => s.kind === 'bot' || (s.kind === 'human' && s.ready))
  );
}

/** The board variant a room will actually use ('auto' → base for 3–4 seats, ext56 for 5–6). */
export function effectiveVariant(s: Pick<RoomSettings, 'variant' | 'maxSeats'>): 'base' | 'ext56' {
  if (s.variant !== 'auto') return s.variant;
  return s.maxSeats >= 5 ? 'ext56' : 'base';
}
