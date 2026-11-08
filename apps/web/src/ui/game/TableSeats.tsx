import type { PlayerView } from '@hexhaven/engine';
import { awardBadge } from '../../game/labels';
import { tableSlots } from '../../game/table';
import { useSession } from '../../store/session';
import { useVoiceStore } from '../../voice/store';
import { DevIcon, KnightIcon, MicIcon } from '../icons';
import { useSeatMeta } from './seats';

/** Card backs fanned under a seat plate, one per resource card (capped so big hands stay tidy). */
function CardFan({ count }: { count: number }) {
  const shown = Math.min(count, 9);
  return (
    <span className="fan">
      {Array.from({ length: shown }, (_, i) => {
        const angle = shown > 1 ? (i - (shown - 1) / 2) * (40 / Math.max(shown - 1, 4)) : 0;
        return (
          <span
            key={i}
            className="fan-card"
            style={{ transform: `rotate(${angle}deg)`, left: `${i * 7}px` }}
          />
        );
      })}
      <span className="fan-count" style={{ left: `${Math.max(shown - 1, 0) * 7 + 30}px` }}>
        {count}
      </span>
    </span>
  );
}

/**
 * The players sitting around the table: a name plate, avatar, victory points and a fan of card
 * backs for each seat, placed around the board relative to the viewer. Purely visual: the same
 * facts, with full labels, are in the Players panel, so this layer is hidden from screen readers.
 */
export function TableSeats({ view }: { view: PlayerView }) {
  const { seatInfo, nameOf, colorOf } = useSeatMeta();
  const myUserId = useSession((s) => s.user?.id);
  const peers = useVoiceStore((s) => s.peers);
  const selfSpeaking = useVoiceStore((s) => s.speaking);
  const slots = tableSlots(view.players.length, view.viewer);
  const active = view.phase.kind === 'specialBuild' ? view.phase.seat : view.turn.current;
  const variant = view.config.variant;

  return (
    <div className="table-seats" aria-hidden="true">
      {view.players.map((p) => {
        const info = seatInfo(p.seat);
        const name = nameOf(p.seat);
        const isBot = info?.controller === 'bot';
        const connected = info?.connected ?? true;
        const speaking = info?.userId
          ? info.userId === myUserId
            ? selfSpeaking
            : !!peers[info.userId]?.speaking
          : false;
        const cls = ['tseat', `tseat-${slots.get(p.seat) ?? 'br'}`];
        if (p.seat === active) cls.push('active');
        else if (view.pendingActors.includes(p.seat)) cls.push('acting');
        if (p.seat === view.viewer) cls.push('me');
        if (!connected) cls.push('offline');
        if (speaking) cls.push('speaking');
        return (
          <div
            key={p.seat}
            className={cls.join(' ')}
            data-testid={`table-seat-${p.seat}`}
            style={{ ['--seat-color' as string]: colorOf(p.seat) }}
          >
            <div className="tseat-avatar">
              <span>{isBot ? '⚙' : (name.trim()[0] ?? '?').toUpperCase()}</span>
              {info?.inVoice && (
                <span className={info.muted ? 'tseat-mic muted' : 'tseat-mic'}>
                  <MicIcon muted={info.muted} />
                </span>
              )}
            </div>
            <div className="tseat-plate">
              <div className="tseat-name">
                <span className="tseat-name-text">{name}</span>
                {isBot && <span className="tseat-tag">AI</span>}
              </div>
              <div className="tseat-stats">
                <span className="tseat-vp" title="Victory points">
                  <svg viewBox="0 0 16 16" className="ico">
                    <path
                      d="M4,1.5 H12 V5 A4,4 0 0 1 8,9 A4,4 0 0 1 4,5 Z M7,9 H9 V12 H11 V14.5 H5 V12 H7 Z M4,3 H1.5 V4.5 A2.5,2.5 0 0 0 4,7 M12,3 H14.5 V4.5 A2.5,2.5 0 0 1 12,7"
                      fill="currentColor"
                      stroke="currentColor"
                      strokeWidth={0.6}
                    />
                  </svg>
                  {p.publicVP}
                </span>
                <span className="tseat-stat">
                  <DevIcon />
                  {p.devCardCount}
                </span>
                <span className="tseat-stat">
                  <KnightIcon />
                  {p.playedKnights}
                </span>
                {view.longestRoad === p.seat && (
                  <span className="tseat-award">{awardBadge('longestRoad', variant)}</span>
                )}
                {view.largestArmy === p.seat && <span className="tseat-award">Army</span>}
              </div>
            </div>
            <CardFan count={p.resourceCount} />
          </div>
        );
      })}
    </div>
  );
}

const PIPS: Record<number, Array<[number, number]>> = {
  1: [[0, 0]],
  2: [
    [-1, -1],
    [1, 1],
  ],
  3: [
    [-1, -1],
    [0, 0],
    [1, 1],
  ],
  4: [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ],
  5: [
    [-1, -1],
    [1, -1],
    [0, 0],
    [-1, 1],
    [1, 1],
  ],
  6: [
    [-1, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [1, 1],
  ],
};

function TableDie({ value, tilt }: { value: number; tilt: number }) {
  return (
    <span className="tdie" style={{ ['--tilt' as string]: `${tilt}deg` }}>
      {(PIPS[value] ?? []).map(([x, y], i) => (
        <span
          key={i}
          className="tdie-pip"
          style={{ left: `${50 + x * 27}%`, top: `${50 + y * 27}%` }}
        />
      ))}
    </span>
  );
}

/**
 * This turn's dice, lying on the table. They tumble in whenever a new roll lands, and are left
 * out before the first roll of a turn.
 */
export function TableDice({ view }: { view: PlayerView }) {
  const dice = view.turn.dice;
  if (!dice) return null;
  const total = dice[0] + dice[1];
  // A new key per roll remounts the dice, which replays the tumble animation.
  return (
    <div
      className="table-dice"
      key={`${view.turn.number}:${dice[0]}:${dice[1]}`}
      aria-hidden="true"
    >
      <TableDie value={dice[0]} tilt={-12} />
      <TableDie value={dice[1]} tilt={9} />
      <span className={total === 7 ? 'dice-total seven' : 'dice-total'}>{total}</span>
    </div>
  );
}
