import type { RoomInfo } from '@hexhaven/shared';
import { navigate } from '../router';
import { useGameStore } from '../store/game';
import { useRoomStore } from '../store/room';
import { useSession } from '../store/session';
import { toastError, toastInfo } from '../store/toast';
import { errorMessage } from './emit';
import { emitAck, getSocket } from './socket';

let bound = false;
/** Room code the user is currently in (re-joined automatically after a reconnect). */
let activeCode: string | null = null;
let rejoinOnConnect = false;

/** Attach server→client listeners once. Call only after the user is logged in (cookie set). */
export function bindSocket(): void {
  if (bound) return;
  bound = true;
  const s = getSocket();
  const session = useSession.getState();

  s.on('connect', () => {
    session.setConnected(true);
    if (rejoinOnConnect && activeCode) {
      rejoinOnConnect = false;
      joinRoom(activeCode).catch((e) => toastError(errorMessage(e)));
    }
  });
  s.on('disconnect', () => {
    session.setConnected(false);
    rejoinOnConnect = true;
  });
  s.on('room:state', (room) => {
    if (activeCode && room.code !== activeCode) return;
    useRoomStore.getState().setRoom(room);
    if (room.status !== 'lobby' && !useGameStore.getState().payload) void syncGame();
    if (room.status === 'lobby' && useGameStore.getState().payload) useGameStore.getState().reset();
  });
  s.on('room:closed', ({ reason }) => {
    clearRoom();
    toastInfo(reason ? `Room closed: ${reason}` : 'Room closed');
    navigate('/');
  });
  s.on('game:state', (p) => useGameStore.getState().ingest(p));
  s.on('chat:message', (m) => useRoomStore.getState().addChat(m));
  s.on('chat:history', (ms) => useRoomStore.getState().setChat(ms));
  s.on('server:error', (e) => toastError(e.message));
}

function clearRoom(): void {
  activeCode = null;
  useRoomStore.getState().reset();
  useGameStore.getState().reset();
}

/** Mark a room (e.g. one just created) as the active one without re-joining it. */
export function enterRoom(room: RoomInfo): void {
  if (activeCode !== room.code) useGameStore.getState().reset();
  activeCode = room.code;
  useRoomStore.getState().setRoom(room);
}

export async function joinRoom(code: string): Promise<RoomInfo> {
  bindSocket();
  activeCode = code;
  const room = await emitAck('room:join', { code });
  enterRoom(room);
  if (room.status !== 'lobby') await syncGame();
  return room;
}

let syncing = false;
export async function syncGame(): Promise<void> {
  if (syncing) return;
  syncing = true;
  try {
    const p = await emitAck('game:sync', {});
    useGameStore.getState().ingest(p);
  } catch (e) {
    toastError(errorMessage(e));
  } finally {
    syncing = false;
  }
}

export async function leaveRoom(): Promise<void> {
  try {
    await emitAck('room:leave', {});
  } catch (e) {
    toastError(errorMessage(e));
  }
  clearRoom();
  navigate('/');
}

/** Wrap a lobby/room request: shows a toast on failure and resolves to undefined. */
export async function request<T>(p: Promise<T>): Promise<T | undefined> {
  try {
    return await p;
  } catch (e) {
    toastError(errorMessage(e));
    return undefined;
  }
}
