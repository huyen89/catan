import { z } from 'zod';
import { SCENARIO_IDS, defaultScenarioFor, variantFor } from '@hexhaven/engine';

export const PLAYER_COLORS = [
  '#d9480f',
  '#1971c2',
  '#f8f9fa',
  '#e8a10c',
  '#2f9e44',
  '#862e9c',
] as const;

export const botDifficultySchema = z.enum(['easy', 'normal', 'hard']);
export type BotDifficulty = z.infer<typeof botDifficultySchema>;

export const roomSettingsSchema = z.strictObject({
  /** Number of seats at the table (3..6). */
  maxSeats: z.number().int().min(3).max(6),
  /** 'auto' picks base for 3-4 and ext56 for 5-6. 'seafarers' is Open Seas. */
  variant: z.enum(['auto', 'base', 'ext56', 'seafarers']),
  /**
   * Open Seas scenario; only used with variant 'seafarers'. Absent = the engine's default for
   * the seat count (defaultScenarioFor).
   */
  scenario: z.enum(SCENARIO_IDS).optional(),
  vpToWin: z.number().int().min(5).max(20),
  discardLimit: z.number().int().min(5).max(15),
  numberMode: z.enum(['random', 'spiral']),
  portMode: z.enum(['fixed', 'random']),
  /** Seconds for a main turn. 0 = no timer. */
  turnTimerSec: z.number().int().min(0).max(600),
});
export type RoomSettings = z.infer<typeof roomSettingsSchema>;

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  maxSeats: 4,
  variant: 'auto',
  vpToWin: 10,
  discardLimit: 7,
  numberMode: 'random',
  portMode: 'fixed',
  turnTimerSec: 90,
};

/** The Open Seas scenario a room would play: its own setting, else the default for its seats. */
export function effectiveScenario(s: Pick<RoomSettings, 'scenario' | 'maxSeats'>): string {
  return s.scenario ?? defaultScenarioFor('seafarers', s.maxSeats) ?? 'newShores';
}

/**
 * Apply a settings patch. Unless the patch sets vpToWin itself, entering Open Seas or changing
 * which scenario it plays (scenario or seat count) resets vpToWin to that scenario's target, and
 * leaving Open Seas resets it to the default. Used for room:create and room:settings.
 */
export function mergeRoomSettings(
  current: RoomSettings,
  patch: Partial<RoomSettings>,
): RoomSettings {
  const defined = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined),
  ) as Partial<RoomSettings>;
  const next: RoomSettings = { ...current, ...defined };
  if (defined.vpToWin !== undefined) return next;
  const wasSea = current.variant === 'seafarers';
  if (next.variant === 'seafarers') {
    const id = effectiveScenario(next);
    if (!wasSea || id !== effectiveScenario(current)) {
      next.vpToWin =
        variantFor({ variant: 'seafarers', scenario: id }).layout.defaultVpToWin ??
        DEFAULT_ROOM_SETTINGS.vpToWin;
    }
  } else if (wasSea) {
    next.vpToWin = DEFAULT_ROOM_SETTINGS.vpToWin;
  }
  return next;
}

export interface UserInfo {
  id: string;
  name: string;
  avatarUrl: string | null;
  isGuest: boolean;
}

export interface SeatInfo {
  index: number;
  kind: 'open' | 'human' | 'bot';
  userId: string | null;
  name: string;
  avatarUrl: string | null;
  color: string;
  ready: boolean;
  /** Human seats: is a socket currently connected. Bots: always true. */
  connected: boolean;
  /** Who is making moves for this seat right now ('bot' while a disconnected human is covered). */
  controller: 'human' | 'bot';
  botDifficulty: BotDifficulty;
  inVoice: boolean;
  muted: boolean;
}

export type RoomStatus = 'lobby' | 'in_game' | 'finished';

export interface RoomInfo {
  id: string;
  code: string;
  hostUserId: string;
  status: RoomStatus;
  settings: RoomSettings;
  seats: SeatInfo[];
  gameId: string | null;
  /** True when no human is connected and the game is frozen. */
  paused: boolean;
  /** Users in the room who are not seated. */
  spectators: Array<{ userId: string; name: string }>;
}

export interface ChatMessage {
  id: number;
  roomId: string;
  userId: string;
  name: string;
  text: string;
  ts: number;
}
