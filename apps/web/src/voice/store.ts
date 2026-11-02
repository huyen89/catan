import { create } from 'zustand';

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
  join(): Promise<void>;
  leave(): void;
  toggleMute(): void;
  setVolume(userId: string, volume: number): void;
}

/**
 * Voice store. Owned by workstream V; read by workstream W (player list speaking/mute badges).
 * M0 stub with inert actions.
 */
export const useVoiceStore = create<VoiceState>(() => ({
  joined: false,
  muted: true,
  speaking: false,
  error: null,
  peers: {},
  join: async () => {},
  leave: () => {},
  toggleMute: () => {},
  setVolume: () => {},
}));
