import type { GameEvent, PlayerView } from '@hexhaven/engine';

export type SoundId = 'dice' | 'yourTurn' | 'build' | 'trade' | 'robber' | 'gameOver';

/** Play order when one update carries several cues (each cue plays at most once). */
export const SOUND_ORDER: readonly SoundId[] = [
  'dice',
  'robber',
  'build',
  'trade',
  'yourTurn',
  'gameOver',
];

interface Snapshot {
  gameId: string;
  version: number;
  view: Pick<PlayerView, 'viewer' | 'turn' | 'phase' | 'pendingActors'>;
}

function cueFor(e: GameEvent, me: number | null): SoundId | null {
  switch (e.type) {
    case 'rolled':
      return 'dice';
    case 'robberMoved':
    case 'stole':
      return 'robber';
    case 'built':
    case 'setupPlaced':
      return 'build';
    case 'tradeOffered':
      return me !== null && e.offer.from !== me && String(me) in e.offer.responses ? 'trade' : null;
    case 'gameOver':
      return 'gameOver';
    default:
      return null;
  }
}

/**
 * Whether `me` has to make the next move. Answering a trade offer does not count (that has its
 * own cue), so main-phase pending actors are ignored.
 */
export function mustAct(view: Snapshot['view'], me: number | null): boolean {
  if (me === null) return false;
  switch (view.phase.kind) {
    case 'gameOver':
      return false;
    case 'setup':
    case 'discard':
      return view.pendingActors.includes(me);
    case 'specialBuild':
      return view.phase.seat === me;
    default:
      return view.turn.current === me;
  }
}

/** True when the viewer must act now but did not have to before (turn start, setup, discard). */
function becameMyMove(prev: Snapshot['view'], next: Snapshot['view']): boolean {
  const me = next.viewer;
  return mustAct(next, me) && !mustAct(prev, me);
}

/**
 * Sound cues for an incoming state. Only a live, consecutive update (same game, version + 1)
 * makes noise: joining mid-game, a resync after a reconnect (version gap) or a repeat of the
 * current version are history, not news.
 *
 * The one exception is the first state of a brand-new game (version 0, e.g. after Start or a
 * rematch while sitting in the room): if the viewer places first, that is their turn starting.
 */
export function soundsFor(
  prev: Snapshot | null,
  next: Snapshot & { events: readonly GameEvent[] },
): SoundId[] {
  if (!prev || prev.gameId !== next.gameId) {
    return next.version === 0 && mustAct(next.view, next.view.viewer) ? ['yourTurn'] : [];
  }
  if (next.version !== prev.version + 1) return [];
  const me = next.view.viewer;
  const cues = new Set<SoundId>();
  for (const e of next.events) {
    const c = cueFor(e, me);
    if (c) cues.add(c);
  }
  if (becameMyMove(prev.view, next.view)) cues.add('yourTurn');
  return SOUND_ORDER.filter((s) => cues.has(s));
}
