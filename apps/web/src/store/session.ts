import { create } from 'zustand';
import type { MeResponse, UserInfo } from '@hexhaven/shared';
import { api } from '../net/api';
import { errorMessage } from '../net/emit';

type Config = MeResponse['config'];

interface SessionState {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  user: UserInfo | null;
  config: Config;
  /** Socket connection state (false before the first connect and while reconnecting). */
  connected: boolean;
  /** True once the socket has connected at least once (so "reconnecting" is meaningful). */
  everConnected: boolean;
  load(): Promise<void>;
  setUser(user: UserInfo | null): void;
  setConnected(connected: boolean): void;
}

const DEFAULT_CONFIG: Config = {
  googleClientId: null,
  guestInviteRequired: false,
  testMode: false,
};

export const useSession = create<SessionState>((set) => ({
  status: 'loading',
  error: null,
  user: null,
  config: DEFAULT_CONFIG,
  connected: false,
  everConnected: false,
  async load() {
    set({ status: 'loading', error: null });
    try {
      const me = await api.me();
      set({ status: 'ready', user: me.user, config: me.config ?? DEFAULT_CONFIG });
    } catch (e) {
      set({ status: 'error', error: errorMessage(e) });
    }
  },
  setUser(user) {
    set({ user });
  },
  setConnected(connected) {
    set((s) => ({ connected, everConnected: s.everConnected || connected }));
  },
}));
