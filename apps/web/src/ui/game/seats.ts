import { useCallback } from 'react';
import type { PlayerView, Seat } from '@hexhaven/engine';
import type { SeatInfo } from '@hexhaven/shared';
import { seatColor } from '../../game/colors';
import { useRoomStore } from '../../store/room';
import { useSession } from '../../store/session';
import { useVoiceStore } from '../../voice/store';

/** Game seat i is room seat i (the game starts only when every room seat is filled). */
export function useSeatMeta() {
  const seats = useRoomStore((s) => s.room?.seats);
  const seatInfo = useCallback((seat: Seat): SeatInfo | undefined => seats?.[seat], [seats]);
  const nameOf = useCallback((seat: Seat) => seats?.[seat]?.name || `Player ${seat + 1}`, [seats]);
  const colorOf = useCallback((seat: Seat) => seats?.[seat]?.color || seatColor(seat), [seats]);
  return { seatInfo, nameOf, colorOf };
}

export interface SeatStatus {
  info: SeatInfo | undefined;
  isBot: boolean;
  connected: boolean;
  speaking: boolean;
  /** Whose turn it is (during the special build phase, the seat currently building). */
  active: boolean;
  /** Someone the game is waiting on (discarding, answering a trade, …). */
  pending: boolean;
}

/** Live status of every seat, shared by the Players panel and the seats around the table. */
export function useSeatStatus(view: PlayerView) {
  const { seatInfo, nameOf, colorOf } = useSeatMeta();
  const myUserId = useSession((s) => s.user?.id);
  const peers = useVoiceStore((s) => s.peers);
  const selfSpeaking = useVoiceStore((s) => s.speaking);
  const activeSeat = view.phase.kind === 'specialBuild' ? view.phase.seat : view.turn.current;
  const statusOf = (seat: Seat): SeatStatus => {
    const info = seatInfo(seat);
    const speaking = info?.userId
      ? info.userId === myUserId
        ? selfSpeaking
        : !!peers[info.userId]?.speaking
      : false;
    return {
      info,
      isBot: info?.controller === 'bot',
      connected: info?.connected ?? true,
      speaking,
      active: seat === activeSeat,
      pending: view.pendingActors.includes(seat),
    };
  };
  return { statusOf, nameOf, colorOf };
}
