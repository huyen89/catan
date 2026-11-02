import { create } from 'zustand';
import { getSocket } from '../net/socket';
import { VoiceManager } from './VoiceManager';

export interface PeerVoice {
  userId: string;
  connection: RTCPeerConnectionState | 'new';
  speaking: boolean;
  muted: boolean;
  /** 0..1 local playback volume. */
  volume: number;
}

export interface VoiceState {
  joined: boolean;
  muted: boolean;
  /** Local mic is producing sound. */
  speaking: boolean;
  error: string | null;
  peers: Record<string, PeerVoice>;
  /** Join in flight, or re-joining after the socket reconnected. */
  joining: boolean;
  /** Waiting for the browser's microphone permission prompt. */
  micPending: boolean;
  /** The browser blocked audio playback until the user clicks (call resumeAudio). */
  audioBlocked: boolean;
  /** User id this voice session runs as (null before the first join). */
  selfUserId: string | null;
  /** Join the current room's voice channel, muted. Without an id, /api/me is asked. */
  join(selfUserId?: string): Promise<void>;
  leave(): void;
  toggleMute(): void;
  setMuted(muted: boolean): Promise<void>;
  setVolume(userId: string, volume: number): void;
  resumeAudio(): void;
  clearError(): void;
}

let manager: VoiceManager | null = null;

/** Created lazily so importing the store never touches browser media APIs. */
function voice(): VoiceManager {
  manager ??= new VoiceManager({ getSocket, setState: (p) => useVoiceStore.setState(p) });
  return manager;
}

/**
 * Voice store. Owned by workstream V; read by workstream W (player list speaking/mute badges).
 * Joining starts muted and does not ask for the microphone until the mic is first turned on.
 */
export const useVoiceStore = create<VoiceState>((set) => ({
  joined: false,
  muted: true,
  speaking: false,
  error: null,
  peers: {},
  joining: false,
  micPending: false,
  audioBlocked: false,
  selfUserId: null,
  join: (selfUserId) => voice().join(selfUserId),
  leave: () => manager?.leave(),
  toggleMute: () => manager?.toggleMute(),
  setMuted: async (muted) => manager?.setMuted(muted),
  setVolume: (userId, volume) => voice().setVolume(userId, volume),
  resumeAudio: () => manager?.resumeAudio(),
  clearError: () => set({ error: null }),
}));

function debugEnabled(): boolean {
  if (import.meta.env?.DEV) return true;
  try {
    return new URLSearchParams(window.location.search).get('debug') === '1';
  } catch {
    return false;
  }
}

declare global {
  interface Window {
    __hexVoice?: {
      state: () => VoiceState;
      peers: () => Record<string, Record<string, string | boolean>>;
      candidates: () => Promise<Record<string, string>>;
    };
  }
}

if (typeof window !== 'undefined' && debugEnabled()) {
  window.__hexVoice = {
    state: () => useVoiceStore.getState(),
    peers: () => manager?.debugPeers() ?? {},
    candidates: async () => (manager ? manager.debugCandidates() : {}),
  };
}
