/** Pure helpers for the voice client (no DOM access at import time; unit-tested in node). */

export const FALLBACK_ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }];

/**
 * Perfect negotiation roles: exactly one side of each pair is polite. The impolite side also
 * initiates the first offer, so the initial negotiation never collides.
 */
export function isPolite(selfUserId: string, peerUserId: string): boolean {
  return selfUserId < peerUserId;
}

export interface SpeakingConfig {
  /** RMS level (0..1) that switches speaking on. */
  onLevel: number;
  /** RMS level below which speaking may switch off (after holdMs). */
  offLevel: number;
  /** Keep "speaking" this long after the level last exceeded offLevel. */
  holdMs: number;
}

export const DEFAULT_SPEAKING: SpeakingConfig = { onLevel: 0.03, offLevel: 0.015, holdMs: 400 };

export interface SpeakingTracker {
  speaking: boolean;
  /** Last time (ms) the level kept the indicator on. */
  lastLoudAt: number;
}

export const SILENT: SpeakingTracker = { speaking: false, lastLoudAt: -Infinity };

/** Hysteresis + hold so the indicator doesn't flicker between syllables. */
export function updateSpeaking(
  prev: SpeakingTracker,
  level: number,
  now: number,
  cfg: SpeakingConfig = DEFAULT_SPEAKING,
): SpeakingTracker {
  if (level >= cfg.onLevel) return { speaking: true, lastLoudAt: now };
  if (!prev.speaking) return prev;
  if (level >= cfg.offLevel) return { speaking: true, lastLoudAt: now };
  if (now - prev.lastLoudAt < cfg.holdMs) return prev;
  return { speaking: false, lastLoudAt: prev.lastLoudAt };
}

/** Root-mean-square of time-domain samples in [-1, 1]. */
export function rms(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i]!;
    sum += v * v;
  }
  return Math.sqrt(sum / samples.length);
}

export function clampVolume(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(1, Math.max(0, v));
}

function isIceUrls(u: unknown): u is string | string[] {
  return (
    (typeof u === 'string' && u.length > 0) ||
    (Array.isArray(u) && u.length > 0 && u.every((x) => typeof x === 'string' && x.length > 0))
  );
}

/**
 * Validates the GET /api/voice/ice response. Malformed entries are dropped; an unusable
 * response yields the public STUN fallback so voice still works on friendly NATs.
 */
export function parseIceResponse(json: unknown): { iceServers: RTCIceServer[]; ttl: number } {
  const fallback = { iceServers: FALLBACK_ICE_SERVERS, ttl: 3600 };
  if (typeof json !== 'object' || json === null) return fallback;
  const { iceServers, ttl } = json as { iceServers?: unknown; ttl?: unknown };
  const list = Array.isArray(iceServers) ? iceServers : [];
  const out: RTCIceServer[] = [];
  for (const s of list) {
    if (typeof s !== 'object' || s === null) continue;
    const { urls, username, credential } = s as Record<string, unknown>;
    if (!isIceUrls(urls)) continue;
    const server: RTCIceServer = { urls };
    if (typeof username === 'string') server.username = username;
    if (typeof credential === 'string') server.credential = credential;
    out.push(server);
  }
  if (out.length === 0) return fallback;
  const ttlSec = typeof ttl === 'number' && Number.isFinite(ttl) && ttl > 0 ? ttl : 3600;
  return { iceServers: out, ttl: ttlSec };
}

/** True when cached ICE credentials are past half their lifetime. */
export function iceNeedsRefresh(fetchedAtMs: number, ttlSec: number, nowMs: number): boolean {
  return nowMs - fetchedAtMs > (ttlSec * 1000) / 2;
}

/** Human-readable message for getUserMedia failures. */
export function micErrorMessage(err: unknown): string {
  const name = typeof err === 'object' && err !== null ? (err as { name?: unknown }).name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'PermissionDeniedError':
      return 'Microphone access was blocked. Allow it in your browser’s site settings, then try again.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'No microphone was found. Plug one in and try again.';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'Your microphone is busy or unavailable (is another app using it?).';
    case 'InsecureContext':
      return 'The microphone needs a secure (https://) connection.';
    default:
      return 'Could not start the microphone.';
  }
}

/** Human-readable message for a failed voice:join ack. */
export function joinErrorMessage(code: string | undefined): string {
  switch (code) {
    case 'not_in_room':
      return 'Join a room before joining voice.';
    case 'voice_full':
      return 'Voice chat is full right now. You can still play and use the chat.';
    case 'rate_limited':
      return 'Too many attempts — wait a moment and try again.';
    case 'timeout':
      return 'The server did not answer. Check your connection and try again.';
    case 'unauthenticated':
      return 'Sign in to use voice.';
    default:
      return 'Could not join voice.';
  }
}
