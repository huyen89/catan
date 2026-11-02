/** Default maximum number of users in one room's voice mesh (each peer uploads N-1 streams). */
export const DEFAULT_VOICE_MAX_PEERS = 8;
const MIN_VOICE_MAX_PEERS = 2;
const MAX_VOICE_MAX_PEERS = 16;

/**
 * Voice channel size cap from `VOICE_MAX_PEERS` (default 8, clamped to 2..16). A full mesh
 * gets expensive fast on phones, so the server refuses joins beyond the cap.
 */
export function voiceMaxPeersFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.VOICE_MAX_PEERS?.trim();
  if (!raw) return DEFAULT_VOICE_MAX_PEERS;
  const n = Number(raw);
  if (!Number.isInteger(n)) return DEFAULT_VOICE_MAX_PEERS;
  return Math.min(MAX_VOICE_MAX_PEERS, Math.max(MIN_VOICE_MAX_PEERS, n));
}
