import { describe, expect, it } from 'vitest';
import { DEFAULT_VOICE_MAX_PEERS, voiceMaxPeersFromEnv } from './limits';

describe('voiceMaxPeersFromEnv', () => {
  it('defaults to 8', () => {
    expect(DEFAULT_VOICE_MAX_PEERS).toBe(8);
    expect(voiceMaxPeersFromEnv({})).toBe(8);
    expect(voiceMaxPeersFromEnv({ VOICE_MAX_PEERS: '' })).toBe(8);
    expect(voiceMaxPeersFromEnv({ VOICE_MAX_PEERS: 'lots' })).toBe(8);
    expect(voiceMaxPeersFromEnv({ VOICE_MAX_PEERS: '3.5' })).toBe(8);
  });

  it('reads and clamps the value', () => {
    expect(voiceMaxPeersFromEnv({ VOICE_MAX_PEERS: ' 4 ' })).toBe(4);
    expect(voiceMaxPeersFromEnv({ VOICE_MAX_PEERS: '0' })).toBe(2);
    expect(voiceMaxPeersFromEnv({ VOICE_MAX_PEERS: '100' })).toBe(16);
  });
});
