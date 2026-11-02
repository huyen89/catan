import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../net/api';
import { errorMessage } from '../net/emit';
import { useSession } from '../store/session';

interface GoogleIdApi {
  initialize(opts: { client_id: string; callback(resp: { credential: string }): void }): void;
  renderButton(el: HTMLElement, opts: Record<string, string | number>): void;
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdApi } };
  }
}

const GSI_SRC = 'https://accounts.google.com/gsi/client';
let gsiPromise: Promise<void> | null = null;

/** Load Google Identity Services once, on demand. */
function loadGsi(): Promise<void> {
  gsiPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GSI_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gsiPromise = null;
      reject(new Error('Could not load Google sign-in'));
    };
    document.head.appendChild(s);
  });
  return gsiPromise;
}

function GoogleButton({ clientId, onError }: { clientId: string; onError(msg: string): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const setUser = useSession((s) => s.setUser);

  useEffect(() => {
    let cancelled = false;
    loadGsi()
      .then(() => {
        const id = window.google?.accounts.id;
        if (cancelled || !id || !ref.current) return;
        id.initialize({
          client_id: clientId,
          callback: ({ credential }) => {
            api
              .google(credential)
              .then((r) => setUser(r.user))
              .catch((e) => onError(errorMessage(e)));
          },
        });
        id.renderButton(ref.current, {
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'pill',
          width: 260,
        });
      })
      .catch((e) => onError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [clientId, setUser, onError]);

  return <div ref={ref} className="google-btn" aria-label="Continue with Google" />;
}

export function LoginPage() {
  const config = useSession((s) => s.config);
  const setUser = useSession((s) => s.setUser);
  const [name, setName] = useState('');
  const [invite, setInvite] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await api.guest({
        name: name.trim(),
        ...(config.guestInviteRequired ? { inviteCode: invite.trim() } : {}),
      });
      setUser(r.user);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="center-screen">
      <div className="card-box login">
        <h1 className="logo">Hexhaven</h1>
        <p className="muted">Trade, build and settle a hex island with friends.</p>
        {config.googleClientId && (
          <>
            <GoogleButton clientId={config.googleClientId} onError={setError} />
            <div className="or">or play as a guest</div>
          </>
        )}
        <form onSubmit={submit} className="stack">
          <label>
            Your name
            <input
              data-testid="guest-name"
              value={name}
              maxLength={24}
              autoComplete="nickname"
              required
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {config.guestInviteRequired && (
            <label>
              Invite code
              <input
                data-testid="guest-invite"
                value={invite}
                maxLength={64}
                required
                onChange={(e) => setInvite(e.target.value)}
              />
            </label>
          )}
          <button
            type="submit"
            className="primary"
            data-testid="guest-login"
            disabled={submitting || !name.trim()}
          >
            {submitting ? 'Joining…' : 'Play as guest'}
          </button>
        </form>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
