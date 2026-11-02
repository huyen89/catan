import type { HexServer, HexSocket } from '../types';

/** Callbacks into the room manager so seat badges (inVoice/muted) stay in sync. */
export interface VoiceHooks {
  onVoiceState(roomId: string, userId: string, state: { inVoice: boolean; muted: boolean }): void;
}

/**
 * Registers voice:join / voice:leave / voice:signal / voice:state for one socket.
 * Signals are relayed ONLY between users in the same room's voice channel.
 * Owned by workstream V. Called by realtime/socket.ts (workstream S) for every connection.
 */
export function registerVoiceHandlers(
  _io: HexServer,
  _socket: HexSocket,
  _hooks: VoiceHooks,
): void {
  // M0 stub
}
