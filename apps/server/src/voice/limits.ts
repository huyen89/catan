/** Default maximum number of users in one room's voice mesh (each peer uploads N-1 streams). */
export const DEFAULT_VOICE_MAX_PEERS = 8;
const MIN_VOICE_MAX_PEERS = 2;
const MAX_VOICE_MAX_PEERS = 16;

/**
 * Voice channel size cap from `VOICE_MAX_PEERS` (default 8, clamped to 2..16). A full mesh
 * gets expensive fast on phones, so the server refuses joins beyond the cap. A bad value is
 * not fatal (voice is optional): it is reported through `warn` and the default/clamp applies.
 */
export function voiceMaxPeersFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  warn: (msg: string) => void = (msg) => console.warn(msg),
): number {
  const raw = env.VOICE_MAX_PEERS?.trim();
  if (!raw) return DEFAULT_VOICE_MAX_PEERS;
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    warn(
      `[voice] VOICE_MAX_PEERS=${JSON.stringify(raw)} is not a whole number; using ${DEFAULT_VOICE_MAX_PEERS}`,
    );
    return DEFAULT_VOICE_MAX_PEERS;
  }
  const clamped = Math.min(MAX_VOICE_MAX_PEERS, Math.max(MIN_VOICE_MAX_PEERS, n));
  if (clamped !== n) {
    warn(
      `[voice] VOICE_MAX_PEERS=${n} is outside ${MIN_VOICE_MAX_PEERS}..${MAX_VOICE_MAX_PEERS}; using ${clamped}`,
    );
  }
  return clamped;
}

/** Read once at startup. */
export const VOICE_MAX_PEERS = voiceMaxPeersFromEnv();

/**
 * Signaling burst per socket. Joining a mesh costs roughly 10–12 signals per peer (offer/answer
 * plus trickled candidates), so the burst grows with the cap; 15 per peer leaves headroom.
 */
export function signalBurstFor(maxPeers: number): number {
  return Math.max(100, maxPeers * 15);
}
