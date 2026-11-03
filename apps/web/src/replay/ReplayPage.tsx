import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ENGINE_VERSION, RESOURCES, type PlayerView, type Seat } from '@hexhaven/engine';
import type { ReplayResponse } from '@hexhaven/shared';
import { seatColor } from '../game/colors';
import type { EventTextContext } from '../game/eventText';
import { computeHighlights } from '../game/highlights';
import { formatDateTime, variantLabel } from '../game/history';
import { DEV_LABEL, RESOURCE_LABEL, awardBadge, hexLabel } from '../game/labels';
import { api } from '../net/api';
import { errorMessage } from '../net/emit';
import { Link } from '../ui/common';
import { Board } from '../ui/game/Board';
import { LoadState, PageShell } from '../ui/history/PageShell';
import { CardsIcon, KnightIcon, ResourceIcon } from '../ui/icons';
import { useAsync } from '../ui/useAsync';
import { SPEEDS, frameCaption, positionLabel, stepDelay } from './caption';
import { focusKind, replayKeyAction, type ReplayKeyAction } from './keys';
import { ReplayTimeline, replayView } from './timeline';

const NO_HIGHLIGHTS = computeHighlights(null, null);
const noop = () => {};

/** /replay/:gameId — lazy-loaded (it pulls in the full engine reducer). */
export function ReplayPage({ gameId }: { gameId: string }) {
  const replay = useAsync(() => api.replay(gameId), gameId);
  if (replay.status === 'ready') return <ReplayLoaded replay={replay.data} />;
  return (
    <PageShell title="Replay">
      <LoadState state={replay} what="the replay">
        {() => null}
      </LoadState>
    </PageShell>
  );
}

function ReplayLoaded({ replay }: { replay: ReplayResponse }) {
  const built = useMemo(() => {
    try {
      return { ok: true as const, timeline: new ReplayTimeline(replay) };
    } catch (e) {
      return { ok: false as const, error: errorMessage(e) };
    }
  }, [replay]);
  if (!built.ok) {
    return (
      <div className="center-screen">
        <div className="card-box" role="alert">
          <h1>Can’t rebuild this game</h1>
          <p className="error">{built.error}</p>
          <Link to="/history" className="button-link">
            Back to history
          </Link>
        </div>
      </div>
    );
  }
  return <ReplayViewer replay={replay} timeline={built.timeline} />;
}

/**
 * A playback button that stays focusable when it has nothing to do (aria-disabled + guard
 * instead of `disabled`), so pressing "Go to end" does not drop keyboard focus to <body>.
 */
function CtlButton(props: {
  label: string;
  title?: string;
  testId?: string;
  off: boolean;
  onPress(): void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.title ?? props.label}
      data-testid={props.testId}
      aria-disabled={props.off}
      onClick={() => {
        if (!props.off) props.onPress();
      }}
    >
      {props.children}
    </button>
  );
}

function ReplayViewer({ replay, timeline }: { replay: ReplayResponse; timeline: ReplayTimeline }) {
  const last = timeline.length - 1;
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const summary = replay.summary;

  const nameOf = useCallback(
    (seat: Seat) => summary.players.find((p) => p.seat === seat)?.name || `Player ${seat + 1}`,
    [summary],
  );
  const colorOf = useCallback((seat: Seat) => seatColor(seat), []);
  const view = useMemo(
    () => replayView(timeline.stateAt(frame), timeline.board),
    [timeline, frame],
  );
  const meta = timeline.frames[frame]!;
  const ctx: EventTextContext = useMemo(
    () => ({
      name: nameOf,
      hexLabel: (id) => hexLabel(view.board, id),
      variant: replay.config.variant,
    }),
    [nameOf, view.board, replay.config.variant],
  );
  const caption = frameCaption(meta, ctx);

  const go = useCallback((i: number) => setFrame(timeline.clamp(i)), [timeline]);
  const togglePlay = () => {
    if (!playing && frame >= last) setFrame(0);
    setPlaying(!playing);
  };
  const step = (i: number) => {
    setPlaying(false);
    go(i);
  };
  const run = (a: ReplayKeyAction) => {
    if (a === 'togglePlay') return togglePlay();
    step(
      {
        stepForward: frame + 1,
        stepBack: frame - 1,
        nextTurn: timeline.nextTurn(frame),
        prevTurn: timeline.prevTurn(frame),
        start: 0,
        end: last,
      }[a],
    );
  };
  // The window listener is registered once and always calls the latest `run`.
  const runRef = useRef(run);
  runRef.current = run;

  // Playback: one action per tick; stops at the end.
  useEffect(() => {
    if (!playing) return;
    if (frame >= last) {
      setPlaying(false);
      return;
    }
    const id = setTimeout(() => setFrame((f) => Math.min(last, f + 1)), stepDelay(speed));
    return () => clearTimeout(id);
  }, [playing, frame, last, speed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const action = replayKeyAction(
        e.key,
        { shift: e.shiftKey, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey },
        focusKind(e.target),
      );
      if (!action) return;
      e.preventDefault();
      runRef.current(action);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="replay" data-testid="replay">
      <header className="replay-top">
        <Link to="/history" className="nav-link" testId="replay-back">
          ← History
        </Link>
        <h1>
          Replay · {variantLabel(summary.variant, replay.config.scenario)}
          <span className="muted small">
            {' '}
            {formatDateTime(summary.finishedAt ?? summary.createdAt)} · room {summary.roomCode}
          </span>
        </h1>
      </header>

      {(timeline.failure || timeline.versionMismatch || timeline.diverged) && (
        <div className="replay-warn" role="alert" data-testid="replay-warning">
          {timeline.failure ? (
            <>
              The replay stops at action {timeline.failure.actionIndex + 1} of{' '}
              {replay.actions.length}: {timeline.failure.message}.
            </>
          ) : timeline.diverged ? (
            <>This rebuild does not end the way the game did.</>
          ) : null}{' '}
          {timeline.versionMismatch && (
            <>
              Recorded with game rules v{replay.engineVersion}; this page uses v{ENGINE_VERSION}, so
              the replay may differ from what was played.
            </>
          )}
        </div>
      )}

      <main className="replay-board">
        <Board
          view={view}
          highlights={NO_HIGHLIGHTS}
          colorOf={colorOf}
          nameOf={nameOf}
          disabled
          onVertex={noop}
          onEdge={noop}
          onHex={noop}
        />
      </main>

      <aside className="replay-side">
        <ReplayPlayers view={view} nameOf={nameOf} colorOf={colorOf} active={meta.active} />
      </aside>

      <footer className="replay-controls">
        {/* Announce single steps, but don't flood screen readers during autoplay. */}
        <div
          className="replay-caption"
          aria-live={playing ? 'off' : 'polite'}
          data-testid="replay-caption"
        >
          <span className="muted small">
            {positionLabel(frame, timeline.length)}
            {meta.turn > 0 ? ` · turn ${meta.turn}` : ' · setup'}
          </span>
          {caption.map(({ text, seat }, i) => (
            <span
              key={i}
              className="log-line"
              style={seat !== null ? { ['--seat-color' as string]: colorOf(seat) } : undefined}
            >
              {seat !== null && <span className="dot" aria-hidden="true" />}
              {text}
            </span>
          ))}
        </div>
        <div className="replay-buttons" role="group" aria-label="Playback">
          <CtlButton
            label="Go to start"
            title="Go to start (Home)"
            off={frame === 0}
            onPress={() => run('start')}
          >
            ⏮
          </CtlButton>
          <CtlButton
            label="Previous turn"
            title="Previous turn (Shift+←)"
            off={frame === 0}
            onPress={() => run('prevTurn')}
          >
            ⏪
          </CtlButton>
          <CtlButton
            label="Step back"
            title="Step back (←)"
            testId="replay-back-step"
            off={frame === 0}
            onPress={() => run('stepBack')}
          >
            ◀
          </CtlButton>
          <button
            type="button"
            className="primary"
            aria-label={playing ? 'Pause' : 'Play'}
            title="Play / pause (Space)"
            data-testid="replay-play"
            onClick={togglePlay}
          >
            {playing ? '⏸' : '▶'}
          </button>
          <CtlButton
            label="Step forward"
            title="Step forward (→)"
            testId="replay-step"
            off={frame >= last}
            onPress={() => run('stepForward')}
          >
            ▶
          </CtlButton>
          <CtlButton
            label="Next turn"
            title="Next turn (Shift+→)"
            off={frame >= last}
            onPress={() => run('nextTurn')}
          >
            ⏩
          </CtlButton>
          <CtlButton
            label="Go to end"
            title="Go to end (End)"
            off={frame >= last}
            onPress={() => run('end')}
          >
            ⏭
          </CtlButton>
          <select
            aria-label="Playback speed"
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </div>
        <input
          type="range"
          className="replay-slider"
          min={0}
          max={last}
          value={frame}
          aria-label="Position in game"
          aria-valuetext={positionLabel(frame, timeline.length)}
          data-testid="replay-slider"
          onChange={(e) => step(Number(e.target.value))}
        />
      </footer>
    </div>
  );
}

function ReplayPlayers(props: {
  view: PlayerView;
  nameOf(seat: Seat): string;
  colorOf(seat: Seat): string;
  active: Seat | null;
}) {
  const { view, nameOf, colorOf, active } = props;
  return (
    <section className="panel players" aria-label="Players">
      <ul>
        {view.players.map((p) => {
          const dev = [...(p.devCards ?? []), ...(p.newDevCards ?? [])];
          return (
            <li
              key={p.seat}
              className={p.seat === active ? 'player current' : 'player'}
              style={{ ['--seat-color' as string]: colorOf(p.seat) }}
              data-testid={`replay-player-${p.seat}`}
            >
              <span className="swatch" aria-hidden="true" />
              <div className="player-main">
                <div className="player-name">
                  <span className="name-text">{nameOf(p.seat)}</span>
                  {view.winner === p.seat && <span className="badge you">winner</span>}
                </div>
                <div className="player-stats">
                  <span className="vp">{p.totalVP ?? p.publicVP} VP</span>
                  <span aria-label={`${p.resourceCount} resource cards`}>
                    <CardsIcon /> {p.resourceCount}
                  </span>
                  <span aria-label={`${p.playedKnights} knights played`}>
                    <KnightIcon /> {p.playedKnights}
                  </span>
                  {p.bonusVP > 0 && <span className="award island">+{p.bonusVP} isle</span>}
                  {view.longestRoad === p.seat && (
                    <span className="award">{awardBadge('longestRoad', view.config.variant)}</span>
                  )}
                  {view.largestArmy === p.seat && <span className="award">Army</span>}
                </div>
                {p.resources && (
                  <div className="replay-hand" aria-label={`${nameOf(p.seat)}'s hand`}>
                    {RESOURCES.map((r) => (
                      <span
                        key={r}
                        className={p.resources![r] ? 'count-item' : 'count-item zero'}
                        title={RESOURCE_LABEL[r]}
                        aria-label={`${p.resources![r]} ${RESOURCE_LABEL[r]}`}
                      >
                        <ResourceIcon res={r} size={16} />
                        {p.resources![r]}
                      </span>
                    ))}
                  </div>
                )}
                {dev.length > 0 && (
                  <div className="replay-dev small muted">
                    {dev.map((d) => DEV_LABEL[d]).join(', ')}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
