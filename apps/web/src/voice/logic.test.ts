import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SPEAKING,
  FALLBACK_ICE_SERVERS,
  SILENT,
  clampVolume,
  iceNeedsRefresh,
  isPolite,
  joinErrorMessage,
  micErrorMessage,
  parseIceResponse,
  rms,
  updateSpeaking,
  type SpeakingTracker,
} from './logic';

describe('isPolite', () => {
  it('makes exactly one side of every pair polite', () => {
    const ids = ['alice', 'bob', 'u_1', 'u_10', 'U_2'];
    for (const a of ids) {
      for (const b of ids) {
        if (a === b) continue;
        expect(isPolite(a, b)).not.toBe(isPolite(b, a));
      }
    }
    expect(isPolite('a', 'b')).toBe(true);
  });
});

describe('updateSpeaking (hysteresis)', () => {
  const run = (levels: number[], stepMs = 100): boolean[] => {
    let t: SpeakingTracker = SILENT;
    return levels.map((level, i) => {
      t = updateSpeaking(t, level, i * stepMs);
      return t.speaking;
    });
  };

  it('needs the on-threshold to start', () => {
    expect(run([0.02, 0.025, 0.029])).toEqual([false, false, false]);
    expect(run([0.01, 0.05])).toEqual([false, true]);
  });

  it('stays on while above the off-threshold (no flicker between on and off levels)', () => {
    expect(run([0.05, 0.02, 0.016, 0.02, 0.025])).toEqual([true, true, true, true, true]);
  });

  it('holds briefly after going quiet, then switches off', () => {
    // hold 400ms: loud at t=0, quiet from t=100, off once 400ms have passed
    expect(run([0.05, 0, 0, 0, 0, 0])).toEqual([true, true, true, true, false, false]);
  });

  it('respects a custom config', () => {
    const cfg = { ...DEFAULT_SPEAKING, onLevel: 0.5, holdMs: 0 };
    let t = updateSpeaking(SILENT, 0.4, 0, cfg);
    expect(t.speaking).toBe(false);
    t = updateSpeaking(t, 0.6, 1, cfg);
    t = updateSpeaking(t, 0, 2, cfg);
    expect(t.speaking).toBe(false);
  });
});

describe('rms', () => {
  it('computes root mean square', () => {
    expect(rms([])).toBe(0);
    expect(rms(new Float32Array([0, 0, 0]))).toBe(0);
    expect(rms([1, -1, 1, -1])).toBe(1);
    expect(rms([0.5, -0.5])).toBeCloseTo(0.5);
  });
});

describe('clampVolume', () => {
  it('clamps to 0..1 and defaults junk to 1', () => {
    expect(clampVolume(-1)).toBe(0);
    expect(clampVolume(0.3)).toBe(0.3);
    expect(clampVolume(7)).toBe(1);
    expect(clampVolume(Number.NaN)).toBe(1);
  });
});

describe('parseIceResponse', () => {
  it('keeps valid servers and ttl', () => {
    expect(
      parseIceResponse({
        iceServers: [
          { urls: 'stun:stun.cloudflare.com:3478' },
          { urls: ['turn:t:3478?transport=udp'], username: 'u', credential: 'c', extra: 1 },
        ],
        ttl: 600,
      }),
    ).toEqual({
      iceServers: [
        { urls: 'stun:stun.cloudflare.com:3478' },
        { urls: ['turn:t:3478?transport=udp'], username: 'u', credential: 'c' },
      ],
      ttl: 600,
    });
  });

  it('drops malformed entries and falls back to STUN when nothing is usable', () => {
    expect(
      parseIceResponse({ iceServers: [null, { urls: '' }, { urls: [1] }, { urls: [] }] }),
    ).toEqual({ iceServers: FALLBACK_ICE_SERVERS, ttl: 3600 });
    expect(parseIceResponse('nope').iceServers).toBe(FALLBACK_ICE_SERVERS);
    expect(parseIceResponse(null).iceServers).toBe(FALLBACK_ICE_SERVERS);
  });

  it('defaults a bad ttl', () => {
    expect(parseIceResponse({ iceServers: [{ urls: 'stun:x' }], ttl: -5 }).ttl).toBe(3600);
  });
});

describe('iceNeedsRefresh', () => {
  it('refreshes after half the TTL', () => {
    expect(iceNeedsRefresh(0, 100, 49_000)).toBe(false);
    expect(iceNeedsRefresh(0, 100, 51_000)).toBe(true);
  });
});

describe('error messages', () => {
  it('explains mic failures', () => {
    expect(micErrorMessage({ name: 'NotAllowedError' })).toMatch(/blocked/);
    expect(micErrorMessage({ name: 'NotFoundError' })).toMatch(/No microphone/);
    expect(micErrorMessage({ name: 'NotReadableError' })).toMatch(/busy/);
    expect(micErrorMessage({ name: 'InsecureContext' })).toMatch(/https/);
    expect(micErrorMessage(new Error('x'))).toMatch(/Could not start/);
    expect(micErrorMessage(undefined)).toMatch(/Could not start/);
  });

  it('explains join failures', () => {
    expect(joinErrorMessage('not_in_room')).toMatch(/room/);
    expect(joinErrorMessage('timeout')).toMatch(/did not answer/);
    expect(joinErrorMessage(undefined)).toBe('Could not join voice.');
  });
});
