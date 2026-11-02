import { useState, type FormEvent } from 'react';
import { api } from '../net/api';
import { emitAck } from '../net/socket';
import { bindSocket, enterRoom, request } from '../net/session';
import { navigate, roomPath } from '../router';
import { useSession } from '../store/session';

const CODE_RE = /^[A-Z0-9]{6}$/;

export function HomePage() {
  const user = useSession((s) => s.user);
  const connected = useSession((s) => s.connected);
  const [code, setCode] = useState('');
  const [creating, setCreating] = useState(false);
  const normalized = code.trim().toUpperCase();

  const create = async () => {
    setCreating(true);
    bindSocket();
    const res = await request(emitAck('room:create', {}));
    setCreating(false);
    if (res.ok) {
      enterRoom(res.data);
      navigate(roomPath(res.data.code));
    }
  };

  const join = (e: FormEvent) => {
    e.preventDefault();
    if (CODE_RE.test(normalized)) navigate(roomPath(normalized));
  };

  const logout = async () => {
    await request(api.logout());
    location.assign('/');
  };

  return (
    <div className="center-screen">
      <div className="card-box home">
        <h1 className="logo">Hexhaven</h1>
        <p>
          Signed in as <strong>{user?.name}</strong>
          {user?.isGuest && <span className="badge">guest</span>}{' '}
          <button type="button" className="link" onClick={logout}>
            Sign out
          </button>
        </p>
        <button
          type="button"
          className="primary big"
          data-testid="create-room"
          disabled={creating || !connected}
          onClick={create}
        >
          {creating ? 'Creating…' : 'Create a room'}
        </button>
        <div className="or">or join a friend</div>
        <form className="row" onSubmit={join}>
          <input
            data-testid="join-code"
            aria-label="Room code"
            placeholder="ROOM CODE"
            className="code-input"
            maxLength={6}
            autoCapitalize="characters"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button type="submit" data-testid="join-room" disabled={!CODE_RE.test(normalized)}>
            Join
          </button>
        </form>
      </div>
    </div>
  );
}
