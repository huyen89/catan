import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { computeHighlights } from '../../game/highlights';
import { phasePrompt } from '../../game/prompt';
import { offersAwaitingMe } from '../../game/trade';
import { remainingMs } from '../../store/gameMerge';
import { useGameStore } from '../../store/game';
import { useRoomStore } from '../../store/room';
import { VoiceBar } from '../../voice/VoiceBar';
import { ChatPanel } from '../ChatPanel';
import { Board } from './Board';
import { BuildBar, DevCards, Hand, TurnControls, type DevPicker } from './BottomBar';
import { DevPickerDialog, DiscardDialog, GameOverOverlay, StealDialog } from './Dialogs';
import { GameLog } from './GameLog';
import { PlayersPanel } from './PlayersPanel';
import { useSeatMeta } from './seats';
import { SideTabs, type SideTab } from './SideTabs';
import { TradePanel } from './TradePanel';
import { COMPACT_QUERY, useMediaQuery } from '../useMediaQuery';

function Timer() {
  const deadline = useGameStore((s) => s.payload?.deadline ?? null);
  const skew = useGameStore((s) => s.skewMs);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [deadline]);
  if (deadline === null) return null;
  const secs = Math.ceil(remainingMs(deadline, skew, now) / 1000);
  const label = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  return (
    <span
      className={secs <= 10 ? 'timer low' : 'timer'}
      data-testid="timer"
      role="timer"
      aria-label={`${secs} seconds left`}
    >
      {label}
    </span>
  );
}

export interface GameScreenProps {
  /** Extra controls in the header (room code, leave, dev tools). */
  header?: ReactNode;
  onLeave(): void;
  chatDisabled?: boolean;
}

export function GameScreen({ header, onLeave, chatDisabled }: GameScreenProps) {
  const payload = useGameStore((s) => s.payload);
  const busy = useGameStore((s) => s.busy);
  const mode = useGameStore((s) => s.mode);
  const send = useGameStore((s) => s.send);
  const setMode = useGameStore((s) => s.setMode);
  const paused = useRoomStore((s) => s.room?.paused ?? false);
  const { nameOf, colorOf } = useSeatMeta();
  const [picker, setPicker] = useState<DevPicker>(null);
  const compact = useMediaQuery(COMPACT_QUERY);
  const [sideTab, setSideTab] = useState<SideTab | null>('players');
  const view = payload?.view ?? null;
  const hl = useMemo(() => computeHighlights(view, mode), [view, mode]);

  const onVertex = useCallback(
    async (id: string) => {
      if (!hl.vertexAction || busy) return;
      const ok = await send({ type: hl.vertexAction, vertex: id });
      if (ok) setMode(null);
    },
    [hl.vertexAction, busy, send, setMode],
  );
  const onEdge = useCallback(
    async (id: string) => {
      if (!hl.edgeAction || busy) return;
      const ok = await send({ type: hl.edgeAction, edge: id });
      if (ok && hl.edgeAction === 'BUILD_ROAD' && view?.phase.kind !== 'roadBuilding')
        setMode(null);
    },
    [hl.edgeAction, busy, send, setMode, view],
  );
  const onHex = useCallback(
    (id: string) => {
      if (!busy) void send({ type: 'MOVE_ROBBER', hex: id });
    },
    [busy, send],
  );

  if (!view) return <div className="center-screen">Loading game…</div>;
  const prompt = phasePrompt(view, nameOf);
  const me = view.viewer;

  return (
    <div className="game">
      <header className="game-top">
        {header}
        <div
          className={`phase-banner ${prompt.tone}`}
          data-testid="phase-banner"
          role="status"
          aria-live="polite"
        >
          {prompt.text}
          {mode && (
            <button type="button" className="ghost small" onClick={() => setMode(null)}>
              Cancel build
            </button>
          )}
        </div>
        {me !== null && <TurnControls view={view} busy={busy} />}
        <Timer />
      </header>

      {paused && (
        <div className="paused-banner" data-testid="paused-banner" role="alert">
          Game paused: waiting for a player to reconnect.
        </div>
      )}

      <main className="game-board">
        <Board
          view={view}
          highlights={hl}
          colorOf={colorOf}
          nameOf={nameOf}
          disabled={busy}
          onVertex={onVertex}
          onEdge={onEdge}
          onHex={onHex}
        />
      </main>

      {compact ? (
        <SideTabs
          tab={sideTab}
          onTab={setSideTab}
          tradeBadge={offersAwaitingMe(view.trades, me)}
          panes={{
            players: (
              <>
                <VoiceBar />
                <PlayersPanel view={view} />
              </>
            ),
            trade: me !== null ? <TradePanel view={view} busy={busy} /> : null,
            log: <GameLog board={view.board} />,
            chat: <ChatPanel disabled={chatDisabled} />,
          }}
        />
      ) : (
        <aside className="game-side">
          <VoiceBar />
          <PlayersPanel view={view} />
          {me !== null && <TradePanel view={view} busy={busy} />}
          <GameLog board={view.board} />
          <ChatPanel disabled={chatDisabled} />
        </aside>
      )}

      <footer className="game-bottom">
        {me !== null ? (
          <>
            <Hand view={view} />
            <DevCards view={view} busy={busy} onPick={setPicker} />
            <BuildBar view={view} busy={busy} />
          </>
        ) : (
          <p className="muted">You are watching this game.</p>
        )}
      </footer>

      <DiscardDialog view={view} busy={busy} />
      <StealDialog view={view} busy={busy} />
      <DevPickerDialog picker={picker} busy={busy} onClose={() => setPicker(null)} />
      <GameOverOverlay view={view} onLeave={onLeave} />
    </div>
  );
}
