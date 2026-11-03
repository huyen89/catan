import { SCENARIOS, SCENARIO_IDS, defaultScenarioFor, type ScenarioId } from '@hexhaven/engine';
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

/**
 * Who may restart a finished game: the host gets "Play again" (`room:rematch`), everyone else
 * waits for them. 'none' outside a server room (e.g. the dev fixture, or not signed in).
 */
export function rematchRole(
  room: Pick<RoomInfo, 'hostUserId'> | null,
  userId: string | null | undefined,
): 'host' | 'guest' | 'none' {
  if (!room || !userId) return 'none';
  return room.hostUserId === userId ? 'host' : 'guest';
}

/** The board variant a room will actually use ('auto' → base for 3–4 seats, ext56 for 5–6). */
export function effectiveVariant(
  s: Pick<RoomSettings, 'variant' | 'maxSeats'>,
): Exclude<RoomSettings['variant'], 'auto'> {
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

export interface ScenarioOption {
  id: ScenarioId;
  name: string;
  minPlayers: number;
  maxPlayers: number;
  /** "3–4 players". */
  range: string;
  /** The scenario supports this many seats. */
  fits: boolean;
}

/** Open Seas scenarios for the lobby picker, with their player ranges. */
export function scenarioOptions(maxSeats: number): ScenarioOption[] {
  return SCENARIO_IDS.map((id) => {
    const l = SCENARIOS[id];
    const minPlayers = l.minPlayers ?? 3;
    const maxPlayers = l.maxPlayers ?? 6;
    return {
      id,
      name: l.name ?? id,
      minPlayers,
      maxPlayers,
      range: `${minPlayers}–${maxPlayers} players`,
      fits: maxSeats >= minPlayers && maxSeats <= maxPlayers,
    };
  });
}

/** The scenario name a room would play ('New Shores'). */
export function scenarioName(id: string | undefined): string | null {
  if (!id || !Object.hasOwn(SCENARIOS, id)) return null;
  return SCENARIOS[id as ScenarioId].name ?? id;
}

/**
 * The patch the lobby actually sends for a settings change: keeps the settings consistent so
 * the server never has to reject them. Spiral numbering only exists for the standard board, and
 * an Open Seas scenario must support the seat count (else the default for that count is used).
 * vpToWin is never touched here: the server's mergeRoomSettings picks the scenario's target.
 */
export function settingsPatch(
  current: RoomSettings,
  patch: Partial<RoomSettings>,
): Partial<RoomSettings> {
  const next = { ...current, ...patch };
  const out: Partial<RoomSettings> = { ...patch };
  if (next.numberMode === 'spiral' && effectiveVariant(next) !== 'base') out.numberMode = 'random';
  if (next.variant === 'seafarers' && next.scenario !== undefined) {
    const opt = scenarioOptions(next.maxSeats).find((o) => o.id === next.scenario);
    if (!opt?.fits) {
      const fallback = defaultScenarioFor('seafarers', next.maxSeats);
      if (fallback && fallback !== next.scenario) out.scenario = fallback as ScenarioId;
    }
  }
  return out;
}

/** Friendly text for a failed room:start (null = use the server's message). */
export function startErrorText(code: string): string | null {
  switch (code) {
    case 'VARIANT_NOT_READY':
      return 'Open Seas is still being built and cannot be started yet. Choose another board to play now.';
    default:
      return null;
  }
}
