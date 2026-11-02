import { lazy, Suspense, useEffect } from 'react';
import { bindSocket } from './net/session';
import { navigate, useRoute } from './router';
import { useSession } from './store/session';
import { useToasts } from './store/toast';
import { HomePage } from './ui/HomePage';
import { LoginPage } from './ui/LoginPage';
import { RoomPage } from './ui/RoomPage';

// The dev fixture pulls in the full engine reducer; keep it out of the main chunk.
const DevBoard = lazy(() => import('./dev/DevBoard').then((m) => ({ default: m.DevBoard })));

function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className="toasts" aria-live="assertive">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} data-testid="toast" role="status">
          <span>{t.text}</span>
          <button
            type="button"
            className="ghost small"
            aria-label="Dismiss"
            onClick={() => dismiss(t.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function ConnectionBanner() {
  const connected = useSession((s) => s.connected);
  const everConnected = useSession((s) => s.everConnected);
  if (connected || !everConnected) return null;
  return (
    <div className="conn-banner" role="alert">
      Connection lost. Reconnecting…
    </div>
  );
}

function Routed() {
  const route = useRoute();
  const status = useSession((s) => s.status);
  const error = useSession((s) => s.error);
  const user = useSession((s) => s.user);
  const load = useSession((s) => s.load);

  useEffect(() => {
    if (user) bindSocket();
  }, [user]);

  if (route.name === 'devBoard') {
    return (
      <Suspense fallback={<div className="center-screen">Loading…</div>}>
        <DevBoard
          key={`${route.players}-${route.seed}-${route.demo}`}
          players={route.players}
          seed={route.seed}
          demo={route.demo}
          seat={route.seat}
        />
      </Suspense>
    );
  }
  if (status === 'loading') return <div className="center-screen">Loading…</div>;
  if (status === 'error') {
    return (
      <div className="center-screen">
        <div className="card-box">
          <h1>Can’t reach the server</h1>
          <p className="error">{error}</p>
          <button type="button" className="primary" onClick={() => load()}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  // Not logged in: show the login page in place, so the URL (e.g. an invite link) is kept.
  if (!user) return <LoginPage />;

  switch (route.name) {
    case 'home':
      return <HomePage />;
    case 'room':
      return <RoomPage key={route.code} code={route.code} />;
    case 'notFound':
      return (
        <div className="center-screen">
          <div className="card-box">
            <h1>Page not found</h1>
            <button type="button" className="primary" onClick={() => navigate('/')}>
              Go home
            </button>
          </div>
        </div>
      );
  }
}

export function App() {
  const load = useSession((s) => s.load);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <>
      <Routed />
      <ConnectionBanner />
      <Toasts />
    </>
  );
}
