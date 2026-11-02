import { z } from 'zod';
import type { Action, GameConfig, Seat } from '@hexhaven/engine';
import type { UserInfo } from './room';

/** REST endpoints (all under /api, JSON, cookie session `sid`). */

export interface MeResponse {
  user: UserInfo | null;
  config: {
    googleClientId: string | null;
    guestInviteRequired: boolean;
    testMode: boolean;
  };
}

export const googleLoginSchema = z.strictObject({ credential: z.string().min(10).max(4096) });
export const guestLoginSchema = z.strictObject({
  name: z.string().trim().min(1).max(24),
  inviteCode: z.string().max(64).optional(),
});
export type GuestLoginBody = z.infer<typeof guestLoginSchema>;
export type GoogleLoginBody = z.infer<typeof googleLoginSchema>;

export interface LoginResponse {
  user: UserInfo;
}

export interface IceResponse {
  iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }>;
  /** Seconds until credentials expire. */
  ttl: number;
}

// ---------------------------------------------------------------- history / replay / stats (M4)

export interface GameSummaryPlayer {
  seat: Seat;
  name: string;
  kind: 'human' | 'bot';
  /** Null for bots. */
  userId: string | null;
  /** Final victory points (including hidden VP cards); null while the game is active. */
  vp: number | null;
}

export interface GameSummary {
  gameId: string;
  roomCode: string;
  variant: GameConfig['variant'];
  status: 'active' | 'finished' | 'abandoned';
  winner: Seat | null;
  /** The requesting user's seat in this game. */
  mySeat: Seat | null;
  players: GameSummaryPlayer[];
  turns: number;
  createdAt: number;
  finishedAt: number | null;
}

/** GET /api/games — games the current user played in, newest first (max 50). */
export interface GameListResponse {
  games: GameSummary[];
}

/**
 * GET /api/games/:id/replay — only for participants of a FINISHED game (hidden info is public
 * after the game). Clients rebuild every state with createGame(config, seed) + applyAction.
 */
export interface ReplayResponse {
  summary: GameSummary;
  config: GameConfig;
  seed: string;
  engineVersion: number;
  actions: Array<{ seat: Seat; action: Action; ts: number }>;
}

/** GET /api/stats — aggregate over the current user's finished games. */
export interface StatsResponse {
  played: number;
  won: number;
  /** Average final VP over finished games. */
  avgVp: number;
  byVariant: Record<string, { played: number; won: number }>;
  /** Head-to-head against other humans you have played with, by userId. */
  opponents: Array<{
    userId: string;
    name: string;
    games: number;
    yourWins: number;
    theirWins: number;
  }>;
}

export const API = {
  me: 'GET /api/me',
  google: 'POST /api/auth/google',
  guest: 'POST /api/auth/guest',
  logout: 'POST /api/auth/logout',
  ice: 'GET /api/voice/ice',
  health: 'GET /api/health',
  games: 'GET /api/games',
  replay: 'GET /api/games/:id/replay',
  stats: 'GET /api/stats',
} as const;
