import { create } from 'zustand';

export const MUTE_KEY = 'hexhaven.sound.muted';

/** Minimal Storage surface (lets tests pass a fake, or one that throws). */
export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Accessing localStorage itself throws when site data is blocked.
    return null;
  }
}

export function readMuted(storage: KeyValueStore | null = defaultStorage()): boolean {
  try {
    return storage?.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeMuted(muted: boolean, storage: KeyValueStore | null = defaultStorage()): void {
  try {
    storage?.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // Private mode / quota: the preference just won't survive a reload.
  }
}

interface SoundState {
  muted: boolean;
  setMuted(muted: boolean): void;
  toggle(): void;
}

export const useSoundStore = create<SoundState>((set, get) => ({
  muted: readMuted(),
  setMuted(muted) {
    writeMuted(muted);
    set({ muted });
  },
  toggle() {
    get().setMuted(!get().muted);
  },
}));
