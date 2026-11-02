import type { IceResponse } from '@hexhaven/shared';

export interface IceConfig {
  provider: 'cloudflare' | 'coturn' | 'none';
  cloudflareKeyId?: string;
  cloudflareApiToken?: string;
  coturnUrls?: string[];
  coturnSecret?: string;
  ttlSec: number;
}

/**
 * Short-lived ICE servers for a user. Always includes a public STUN server.
 * Owned by workstream V. Route GET /api/voice/ice (auth required) is wired by workstream S.
 */
export async function getIceServers(_userId: string, cfg: IceConfig): Promise<IceResponse> {
  return { iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }], ttl: cfg.ttlSec };
}
