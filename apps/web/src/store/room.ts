import { create } from 'zustand';
import type { ChatMessage, RoomInfo } from '@hexhaven/shared';

export const CHAT_CAP = 200;

interface RoomState {
  room: RoomInfo | null;
  chat: ChatMessage[];
  setRoom(room: RoomInfo | null): void;
  addChat(m: ChatMessage): void;
  setChat(ms: ChatMessage[]): void;
  reset(): void;
}

export const useRoomStore = create<RoomState>((set, get) => ({
  room: null,
  chat: [],
  setRoom(room) {
    const prev = get().room;
    // A different room starts with an empty chat.
    if (prev && room && prev.id !== room.id) set({ room, chat: [] });
    else set({ room });
  },
  addChat(m) {
    const chat = get().chat;
    if (chat.some((c) => c.id === m.id)) return;
    set({ chat: [...chat, m].slice(-CHAT_CAP) });
  },
  setChat(ms) {
    set({ chat: ms.slice(-CHAT_CAP) });
  },
  reset() {
    set({ room: null, chat: [] });
  },
}));
