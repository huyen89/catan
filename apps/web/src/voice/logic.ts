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

/** Mic states of the peers listed in a voice:join ack (authoritative at join time). */
export function mutedFromAck(
  peers: ReadonlyArray<{ userId: string; muted: boolean }>,
): Map<string, boolean> {
  return new Map(peers.map((p) => [p.userId, p.muted] as const));
}

// ------------------------------------------------------------------ ICE restart policy

/** How long ICE may stay 'disconnected' before we restart it (it often recovers by itself). */
export const ICE_DISCONNECTED_GRACE_MS = 5000;

/**
 * What to do when a peer's ICE connection state changes: restart after the returned delay
 * (0 = now), or `null` to cancel any pending restart.
 */
export function iceRestartDelay(state: RTCIceConnectionState): number | null {
  if (state === 'failed') return 0;
  if (state === 'disconnected') return ICE_DISCONNECTED_GRACE_MS;
  return null;
}

// ------------------------------------------------------------------ candidate types

export type CandidateType = 'host' | 'srflx' | 'prflx' | 'relay';
export type RelayProtocol = 'udp' | 'tcp' | 'tls';

const CANDIDATE_TYPES: readonly string[] = ['host', 'srflx', 'prflx', 'relay'];

function asCandidateType(v: unknown): CandidateType | null {
  return typeof v === 'string' && CANDIDATE_TYPES.includes(v) ? (v as CandidateType) : null;
}

/** Fields of an RTCIceCandidate (or an RTCIceCandidateStats entry) we care about. */
export interface CandidateLike {
  candidate?: string;
  type?: string | null;
  candidateType?: string | null;
  relayProtocol?: string | null;
  url?: string | null;
}

export interface CandidateInfo {
  type: CandidateType | null;
  /** For relay candidates: the transport between the browser and the TURN server. */
  relayProtocol: RelayProtocol | null;
}

/** Relay transport from the TURN URL the candidate came from (turns: = TLS). */
function relayProtocolFromUrl(url: string | null | undefined): RelayProtocol | null {
  if (!url) return null;
  if (/^turns:/i.test(url)) return 'tls';
  const m = /[?&]transport=(udp|tcp)/i.exec(url);
  return m ? (m[1]!.toLowerCase() as RelayProtocol) : null;
}

/**
 * Normalizes a gathered candidate or a candidate stats entry. Browsers differ in which
 * fields they fill, so the SDP `candidate:` line is the fallback for the type.
 */
export function candidateInfo(c: CandidateLike): CandidateInfo {
  let type = asCandidateType(c.type) ?? asCandidateType(c.candidateType);
  if (!type && c.candidate) type = asCandidateType(/\styp\s(\w+)/.exec(c.candidate)?.[1]);
  let relayProtocol: RelayProtocol | null = null;
  if (type === 'relay') {
    const rp = c.relayProtocol?.toLowerCase();
    relayProtocol = rp === 'udp' || rp === 'tcp' || rp === 'tls' ? rp : relayProtocolFromUrl(c.url);
  }
  return { type, relayProtocol };
}

// ------------------------------------------------------------------ connection self-test

export interface IceTestResult {
  /** The ICE endpoint answered (false = STUN-only fallback was used). */
  iceFetched: boolean;
  /** The server handed out at least one turn:/turns: URL. */
  turnConfigured: boolean;
  /** A server-reflexive candidate was gathered: STUN works and the public address is known. */
  stun: boolean;
  /** Relay candidates by transport; `unknown` = the browser did not say which. */
  relay: Record<RelayProtocol | 'unknown', boolean>;
  ms: number;
}

export function hasTurnServer(iceServers: readonly RTCIceServer[]): boolean {
  return iceServers.some((s) =>
    (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) => /^turns?:/i.test(u)),
  );
}

export function summarizeIceTest(input: {
  iceFetched: boolean;
  iceServers: readonly RTCIceServer[];
  candidates: readonly CandidateLike[];
  ms: number;
}): IceTestResult {
  const relay = { udp: false, tcp: false, tls: false, unknown: false };
  let stun = false;
  for (const c of input.candidates) {
    const info = candidateInfo(c);
    if (info.type === 'srflx') stun = true;
    if (info.type === 'relay') relay[info.relayProtocol ?? 'unknown'] = true;
  }
  return {
    iceFetched: input.iceFetched,
    turnConfigured: hasTurnServer(input.iceServers),
    stun,
    relay,
    ms: Math.max(0, Math.round(input.ms)),
  };
}

export interface IceTestVerdict {
  level: 'ok' | 'warn' | 'error';
  message: string;
}

/** Plain-language outcome of the connection test. */
export function iceTestVerdict(r: IceTestResult): IceTestVerdict {
  const anyRelay = Object.values(r.relay).some(Boolean);
  if (anyRelay) {
    return { level: 'ok', message: 'Relay server reachable: voice should work on any network.' };
  }
  const problem = !r.iceFetched
    ? 'Could not get voice server details from the game server'
    : !r.turnConfigured
      ? 'No relay (TURN) server is configured'
      : 'The relay (TURN) server did not answer';
  if (r.stun) {
    return {
      level: 'warn',
      message: `${problem}: voice works on most home Wi-Fi but may fail on mobile data or strict networks.`,
    };
  }
  return {
    level: 'error',
    message: `${problem}, and no public address was found. Check your connection or firewall.`,
  };
}

// ------------------------------------------------------------------ selected route per peer

export interface PeerRoute {
  local: CandidateType;
  remote: CandidateType;
  /** Our side's relay transport when the local candidate is a relay. */
  relayProtocol: RelayProtocol | null;
}

type StatsEntry = Record<string, unknown>;

/**
 * The candidate pair in use, from an RTCStatsReport's entries. Uses the transport's
 * selectedCandidatePairId (spec), else a `selected` pair (Firefox), else a nominated
 * succeeded pair.
 */
export function selectedRoute(entries: Iterable<StatsEntry>): PeerRoute | null {
  const byId = new Map<string, StatsEntry>();
  const pairs: StatsEntry[] = [];
  let selectedId: string | null = null;
  for (const s of entries) {
    if (typeof s.id === 'string') byId.set(s.id, s);
    if (s.type === 'candidate-pair') pairs.push(s);
    if (s.type === 'transport' && typeof s.selectedCandidatePairId === 'string') {
      selectedId = s.selectedCandidatePairId;
    }
  }
  const pair =
    (selectedId ? byId.get(selectedId) : undefined) ??
    pairs.find((p) => p.selected === true) ??
    pairs.find((p) => p.nominated === true && p.state === 'succeeded');
  if (!pair) return null;
  const local = byId.get(String(pair.localCandidateId)) as CandidateLike | undefined;
  const remote = byId.get(String(pair.remoteCandidateId)) as CandidateLike | undefined;
  if (!local || !remote) return null;
  const l = candidateInfo(local);
  const r = candidateInfo(remote);
  if (!l.type || !r.type) return null;
  return { local: l.type, remote: r.type, relayProtocol: l.relayProtocol };
}

export type RouteKind = 'host' | 'srflx' | 'relay';

/** Coarse route for a badge: relayed if either side relays, direct via NAT, or local. */
export function routeKind(route: PeerRoute): RouteKind {
  const types = [route.local, route.remote];
  if (types.includes('relay')) return 'relay';
  if (types.includes('srflx') || types.includes('prflx')) return 'srflx';
  return 'host';
}

export const ROUTE_LABEL: Record<RouteKind, { short: string; long: string }> = {
  host: { short: 'LAN', long: 'Direct (same network)' },
  srflx: { short: 'P2P', long: 'Direct over the internet' },
  relay: { short: 'TURN', long: 'Relayed through the TURN server' },
};

export function routeDescription(route: PeerRoute): string {
  const kind = routeKind(route);
  const via =
    kind === 'relay' && route.relayProtocol ? ` over ${route.relayProtocol.toUpperCase()}` : '';
  return `${ROUTE_LABEL[kind].long}${via} (${route.local} → ${route.remote})`;
}
