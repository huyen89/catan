import { create } from 'zustand';
import type { Action } from '@hexhaven/engine';
import type { C2SPayload, GameStatePayload } from '@hexhaven/shared';
import { sanitizeMode, type UiMode } from '../game/highlights';
import { errorMessage } from '../net/emit';
import { emitAck } from '../net/socket';
import { soundsFor } from '../sound/events';
import { useSoundStore } from '../sound/store';
import { playSounds } from '../sound/synth';
import { emptyGameSlice, mergeGameState, type GameSlice } from './gameMerge';
import { toastError } from './toast';

export type ActionSink = (payload: C2SPayload<'game:action'>) => Promise<unknown>;

const socketSink: ActionSink = (payload) => emitAck('game:action', payload);

interface GameStore extends GameSlice {
  mode: UiMode;
  /** An action is in flight; game controls are disabled until its ack arrives. */
  busy: boolean;
  sink: ActionSink;
  ingest(p: GameStatePayload): void;
  setMode(mode: UiMode): void;
  /** Submit an action. Resolves true on a successful ack; errors are shown as a toast. */
  send(action: Action): Promise<boolean>;
  setSink(sink: ActionSink | null): void;
  reset(): void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  ...emptyGameSlice(),
  mode: null,
  busy: false,
  sink: socketSink,
  ingest(p) {
    const prev = get();
    const next = mergeGameState(prev, p, Date.now());
    if (next === prev) return;
    const turnChanged = prev.payload?.view.turn.current !== p.view.turn.current;
    const sounds = soundsFor(prev.payload, p);
    set({ ...next, mode: turnChanged ? null : sanitizeMode(p.view, prev.mode) });
    if (sounds.length && !useSoundStore.getState().muted) playSounds(sounds);
  },
  setMode(mode) {
    set({ mode });
  },
  async send(action) {
    const { payload, busy, sink } = get();
    if (!payload || busy) return false;
    set({ busy: true });
    try {
      await sink({ expectedVersion: payload.view.version, action });
      return true;
    } catch (e) {
      toastError(errorMessage(e));
      return false;
    } finally {
      set({ busy: false });
    }
  },
  setSink(sink) {
    set({ sink: sink ?? socketSink });
  },
  reset() {
    set({ ...emptyGameSlice(), mode: null, busy: false });
  },
}));
