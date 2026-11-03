import { FALLBACK_ICE_SERVERS, parseIceResponse } from './logic';

export interface IceFetchResult {
  iceServers: RTCIceServer[];
  ttl: number;
  /** False when the server could not be asked and the public STUN fallback is used. */
  fetched: boolean;
}

/**
 * Short-lived ICE servers from GET /api/voice/ice. Never throws: on any failure it returns the
 * public STUN fallback (voice still works on friendly NATs) with `fetched: false`.
 */
export async function fetchIceServers(): Promise<IceFetchResult> {
  try {
    const res = await fetch('/api/voice/ice', { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { iceServers, ttl } = parseIceResponse(await res.json());
    return { iceServers, ttl, fetched: iceServers !== FALLBACK_ICE_SERVERS };
  } catch (err) {
    console.warn('[voice] could not fetch ICE servers, using STUN only', err);
    return { iceServers: FALLBACK_ICE_SERVERS, ttl: 3600, fetched: false };
  }
}
