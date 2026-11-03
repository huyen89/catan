import type { PlayerView } from '@hexhaven/engine';
import { awardBadge, awardLabel, plural } from '../../game/labels';
import { hasShips } from '../../game/prompt';
import { useSession } from '../../store/session';
import { useVoiceStore } from '../../voice/store';
import { CardsIcon, DevIcon, KnightIcon, MicIcon, ShipIcon } from '../icons';
import { useSeatMeta } from './seats';

export function PlayersPanel({ view }: { view: PlayerView }) {
  const { seatInfo, nameOf, colorOf } = useSeatMeta();
  const myUserId = useSession((s) => s.user?.id);
  const peers = useVoiceStore((s) => s.peers);
  const selfSpeaking = useVoiceStore((s) => s.speaking);
  const active = view.phase.kind === 'specialBuild' ? view.phase.seat : view.turn.current;
  const seas = hasShips(view);
  const variant = view.config.variant;

  return (
    <section className="panel players" aria-label="Players">
      <ul>
        {view.players.map((p) => {
          const info = seatInfo(p.seat);
          const isBot = info?.controller === 'bot';
          const connected = info?.connected ?? true;
          const me = p.seat === view.viewer;
          const speaking = info?.userId
            ? info.userId === myUserId
              ? selfSpeaking
              : !!peers[info.userId]?.speaking
            : false;
          const pending = view.pendingActors.includes(p.seat);
          const cls = ['player'];
          if (p.seat === active) cls.push('current');
          if (me) cls.push('me');
          if (!connected) cls.push('offline');
          return (
            <li
              key={p.seat}
              className={cls.join(' ')}
              data-testid={`player-${p.seat}`}
              data-controller={info?.controller ?? 'human'}
              data-connected={String(connected)}
              style={{ ['--seat-color' as string]: colorOf(p.seat) }}
            >
              <span className="swatch" aria-hidden="true" />
              <div className="player-main">
                <div className="player-name">
                  <span
                    className={connected ? 'conn on' : 'conn off'}
                    title={connected ? 'Connected' : 'Disconnected'}
                    aria-label={connected ? 'Connected' : 'Disconnected'}
                  />
                  <span className="name-text">{nameOf(p.seat)}</span>
                  {me && <span className="badge you">you</span>}
                  {isBot && (
                    <span className="badge ai" title="Played by the computer">
                      AI
                    </span>
                  )}
                  {pending && p.seat !== active && <span className="badge wait">acting</span>}
                  {info?.inVoice && (
                    <span
                      className={`voice ${info.muted ? 'muted' : 'live'} ${speaking ? 'speaking' : ''}`}
                      title={info.muted ? 'In voice, muted' : speaking ? 'Speaking' : 'In voice'}
                      aria-label={
                        info.muted ? 'In voice, muted' : speaking ? 'Speaking' : 'In voice'
                      }
                    >
                      <MicIcon muted={info.muted} />
                    </span>
                  )}
                </div>
                <div className="player-stats">
                  <span title="Victory points" className="vp">
                    {p.publicVP}
                    {me && p.totalVP !== undefined && p.totalVP !== p.publicVP && (
                      <span className="vp-hidden"> ({p.totalVP})</span>
                    )}{' '}
                    VP
                  </span>
                  <span title="Resource cards" aria-label={`${p.resourceCount} resource cards`}>
                    <CardsIcon /> {p.resourceCount}
                  </span>
                  <span
                    title="Development cards"
                    aria-label={`${p.devCardCount} development cards`}
                  >
                    <DevIcon /> {p.devCardCount}
                  </span>
                  <span title="Knights played" aria-label={`${p.playedKnights} knights played`}>
                    <KnightIcon /> {p.playedKnights}
                  </span>
                  {seas && (
                    <span title="Ships left" aria-label={`${p.shipsLeft} ships left`}>
                      <ShipIcon /> {p.shipsLeft}
                    </span>
                  )}
                  {p.bonusVP > 0 && (
                    <span
                      className="award island"
                      data-testid={`island-bonus-${p.seat}`}
                      title={`Island bonus: ${plural(p.bonusVP, 'point')} for settling new islands`}
                    >
                      +{p.bonusVP} isle
                    </span>
                  )}
                  {view.longestRoad === p.seat && (
                    <span className="award" title={`${awardLabel('longestRoad', variant)} (+2 VP)`}>
                      {awardBadge('longestRoad', variant)}
                    </span>
                  )}
                  {view.largestArmy === p.seat && (
                    <span className="award" title="Largest Army (+2 VP)">
                      Army
                    </span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
