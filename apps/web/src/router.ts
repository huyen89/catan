import { create } from 'zustand';

export type Route =
  | { name: 'home' }
  | { name: 'room'; code: string }
  | { name: 'history' }
  | { name: 'stats' }
  | { name: 'replay'; gameId: string }
  | {
      name: 'devBoard';
      players: number;
      seed: string;
      demo: boolean;
      seat: number;
      /** Open Seas scenario id (validated by the fixture), or null for the classic boards. */
      scenario: string | null;
      /** Open Seas demo scene (validated by the fixture). */
      scene: string | null;
    }
  | { name: 'notFound' };

const ROOM_RE = /^\/r\/([A-Za-z0-9]{6})\/?$/;
const REPLAY_RE = /^\/replay\/([A-Za-z0-9_-]{1,64})\/?$/;

/** Pure path → route matcher. */
export function parseRoute(pathname: string, search = ''): Route {
  if (pathname === '/' || pathname === '') return { name: 'home' };
  const m = ROOM_RE.exec(pathname);
  if (m) return { name: 'room', code: m[1]!.toUpperCase() };
  if (pathname === '/history' || pathname === '/history/') return { name: 'history' };
  if (pathname === '/stats' || pathname === '/stats/') return { name: 'stats' };
  const r = REPLAY_RE.exec(pathname);
  if (r) return { name: 'replay', gameId: r[1]! };
  if (pathname === '/dev/board' || pathname === '/dev/board/') {
    const q = new URLSearchParams(search);
    const players = Math.min(6, Math.max(3, Number(q.get('players')) || 4));
    const seat = Math.min(players - 1, Math.max(0, Number(q.get('seat')) || 0));
    return {
      name: 'devBoard',
      players,
      seed: q.get('seed') || 'dev',
      demo: q.get('demo') !== '0',
      seat,
      scenario: q.get('scenario') || null,
      scene: q.get('scene') || null,
    };
  }
  return { name: 'notFound' };
}

export const roomPath = (code: string): string => `/r/${code.toUpperCase()}`;
export const replayPath = (gameId: string): string => `/replay/${encodeURIComponent(gameId)}`;

interface RouterState {
  path: string;
  search: string;
}

const current = (): RouterState => ({
  path: typeof location === 'undefined' ? '/' : location.pathname,
  search: typeof location === 'undefined' ? '' : location.search,
});

export const useRouter = create<RouterState>(() => current());

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => useRouter.setState(current()));
}

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  if (opts.replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  useRouter.setState(current());
}

export function useRoute(): Route {
  const { path, search } = useRouter();
  return parseRoute(path, search);
}
