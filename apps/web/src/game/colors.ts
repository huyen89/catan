/**
 * Seat colour palette, mirrored from `PLAYER_COLORS` in @hexhaven/shared (a unit test keeps the two
 * in sync). Importing the constant at runtime would evaluate every zod schema in the shared barrel
 * and pull zod into the client bundle.
 */
export const SEAT_COLORS = [
  '#d9480f',
  '#1971c2',
  '#f8f9fa',
  '#e8a10c',
  '#2f9e44',
  '#862e9c',
] as const;

export const seatColor = (seat: number): string => SEAT_COLORS[seat % SEAT_COLORS.length]!;
