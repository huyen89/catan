import { describe, expect, it } from 'vitest';
import { MUTE_KEY, readMuted, writeMuted, type KeyValueStore } from './store';

const memory = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
};

const broken: KeyValueStore = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('mute preference', () => {
  it('round-trips through storage', () => {
    const s = memory();
    expect(readMuted(s)).toBe(false);
    writeMuted(true, s);
    expect(s.data.get(MUTE_KEY)).toBe('1');
    expect(readMuted(s)).toBe(true);
    writeMuted(false, s);
    expect(readMuted(s)).toBe(false);
  });

  it('falls back to unmuted when storage is missing or throws', () => {
    expect(readMuted(null)).toBe(false);
    expect(readMuted(broken)).toBe(false);
    expect(() => writeMuted(true, broken)).not.toThrow();
    expect(() => writeMuted(true, null)).not.toThrow();
  });
});
