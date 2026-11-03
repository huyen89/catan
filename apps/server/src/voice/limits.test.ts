import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_VOICE_MAX_PEERS,
  VOICE_MAX_PEERS,
  signalBurstFor,
  voiceMaxPeersFromEnv,
} from './limits';

describe('voiceMaxPeersFromEnv', () => {
  it('defaults to 8 without warning when unset', () => {
    const warn = vi.fn();
    expect(DEFAULT_VOICE_MAX_PEERS).toBe(8);
    expect(voiceMaxPeersFromEnv({}, warn)).toBe(8);
    expect(voiceMaxPeersFromEnv({ VOICE_MAX_PEERS: '  ' }, warn)).toBe(8);
    expect(warn).not.toHaveBeenCalled();
  });

  it('reads a valid value silently', () => {
    const warn = vi.fn();
    expect(voiceMaxPeersFromEnv({ VOICE_MAX_PEERS: ' 4 ' }, warn)).toBe(4);
    expect(voiceMaxPeersFromEnv({ VOICE_MAX_PEERS: '16' }, warn)).toBe(16);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns and falls back on junk', () => {
    const warn = vi.fn();
    expect(voiceMaxPeersFromEnv({ VOICE_MAX_PEERS: 'lots' }, warn)).toBe(8);
    expect(voiceMaxPeersFromEnv({ VOICE_MAX_PEERS: '3.5' }, warn)).toBe(8);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0]![0]).toMatch(/VOICE_MAX_PEERS="lots".*using 8/);
  });

  it('warns and clamps out-of-range values', () => {
    const warn = vi.fn();
    expect(voiceMaxPeersFromEnv({ VOICE_MAX_PEERS: '0' }, warn)).toBe(2);
    expect(voiceMaxPeersFromEnv({ VOICE_MAX_PEERS: '100' }, warn)).toBe(16);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[1]![0]).toMatch(/outside 2\.\.16; using 16/);
  });

  it('is read once at module load', () => {
    expect(VOICE_MAX_PEERS).toBeGreaterThanOrEqual(2);
    expect(VOICE_MAX_PEERS).toBeLessThanOrEqual(16);
  });
});

describe('signalBurstFor', () => {
  it('scales the signaling burst with the cap, never below 100', () => {
    expect(signalBurstFor(2)).toBe(100);
    expect(signalBurstFor(8)).toBe(120);
    expect(signalBurstFor(16)).toBe(240);
  });
});
