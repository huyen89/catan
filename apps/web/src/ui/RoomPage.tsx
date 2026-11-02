import { useEffect, useState } from 'react';
import { errorMessage } from '../net/emit';
import { joinRoom, leaveRoom } from '../net/session';
import { navigate } from '../router';
import { useRoomStore } from '../store/room';
import { GameScreen } from './game/GameScreen';
import { Lobby } from './Lobby';

export function RoomPage({ code }: { code: string }) {
  const room = useRoomStore((s) => s.room);
  const [error, setError] = useState<string | null>(null);
  const joined = room?.code === code;

  useEffect(() => {
    if (joined) return;
    let cancelled = false;
    setError(null);
    joinRoom(code).catch((e) => {
      if (!cancelled) setError(errorMessage(e));
    });
    return () => {
      cancelled = true;
    };
    // Re-join only when the code changes, not on every room update.
  }, [code]);

  if (error) {
    return (
      <div className="center-screen">
        <div className="card-box">
          <h1>Can’t join room {code}</h1>
          <p className="error" role="alert">
            {error}
          </p>
          <button type="button" className="primary" onClick={() => navigate('/')}>
            Back to home
          </button>
        </div>
      </div>
    );
  }
  if (!room || !joined) return <div className="center-screen">Joining room {code}…</div>;
  if (room.status === 'lobby') return <Lobby room={room} />;

  return (
    <GameScreen
      onLeave={() => leaveRoom()}
      header={
        <div className="room-chip">
          <span className="muted">Room</span>
          <strong data-testid="room-code">{room.code}</strong>
          <button type="button" className="ghost small" onClick={() => leaveRoom()}>
            Leave
          </button>
        </div>
      }
    />
  );
}
