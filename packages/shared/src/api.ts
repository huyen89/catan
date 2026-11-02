import { z } from 'zod';
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

export const API = {
  me: 'GET /api/me',
  google: 'POST /api/auth/google',
  guest: 'POST /api/auth/guest',
  logout: 'POST /api/auth/logout',
  ice: 'GET /api/voice/ice',
  health: 'GET /api/health',
} as const;
