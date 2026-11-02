import type { RoomInfo, RoomSettings } from '@hexhaven/shared';

/**
 * The host may start once every seat is filled, at least one human is seated and every other
 * human is ready (the server treats the host pressing Start as their ready signal).
 */
export function canStart(room: RoomInfo): boolean {
  const seats = room.seats.slice(0, room.settings.maxSeats);
  return (
    seats.length === room.settings.maxSeats &&
    seats.some((s) => s.kind === 'human') &&
    seats.every(
      (s) => s.kind === 'bot' || (s.kind === 'human' && (s.ready || s.userId === room.hostUserId)),
    )
  );
}

/** The board variant a room will actually use ('auto' → base for 3–4 seats, ext56 for 5–6). */
export function effectiveVariant(s: Pick<RoomSettings, 'variant' | 'maxSeats'>): 'base' | 'ext56' {
  if (s.variant !== 'auto') return s.variant;
  return s.maxSeats >= 5 ? 'ext56' : 'base';
}

/** Parse a whole number typed by the user; null when it is not an integer within [min, max]. */
export function parseBoundedInt(text: string, min: number, max: number): number | null {
  const t = text.trim();
  if (!/^-?\d+$/.test(t)) return null;
  const v = Number(t);
  return v >= min && v <= max ? v : null;
}
