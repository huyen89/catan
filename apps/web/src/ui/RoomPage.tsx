import { useEffect, useState } from 'react';
import { errorMessage } from '../net/emit';
import { joinRoom, leaveRoom } from '../net/session';
import { navigate } from '../router';
import { useRoomStore } from '../store/room';
import { useSession } from '../store/session';
import { GameScreen } from './game/GameScreen';
import { Lobby } from './Lobby';

export function RoomPage({ code }: { code: string }) {
  const room = useRoomStore((s) => s.room);
  const [error, setError] = useState<string | null>(null);
  const connected = useSession((s) => s.connected);
  const joined = room?.code === code;

  useEffect(() => {
    // Wait for the socket (requests are not buffered while offline). After a reconnect the
    // session layer re-joins by itself, so only the first join happens here.
    if (joined || !connected) return;
    let cancelled = false;
    setError(null);
    joinRoom(code).catch((e) => {
      if (!cancelled) setError(errorMessage(e));
    });
    return () => {
      cancelled = true;
    };
  }, [code, connected]);

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
