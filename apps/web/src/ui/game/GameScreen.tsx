import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { computeHighlights, type HexAction } from '../../game/highlights';
import { modeHint, phasePrompt } from '../../game/prompt';
import { offersAwaitingMe } from '../../game/trade';
import { SoundToggle } from '../../sound/SoundToggle';
import { remainingMs } from '../../store/gameMerge';
import { useGameStore } from '../../store/game';
import { useRoomStore } from '../../store/room';
import { VoiceBar } from '../../voice/VoiceBar';
import { ChatPanel } from '../ChatPanel';
import { Board } from './Board';
import { BuildBar, DevCards, Hand, TurnControls, type DevPicker } from './BottomBar';
import {
  DevPickerDialog,
  DiscardDialog,
  GameOverOverlay,
  GoldDialog,
  StealDialog,
} from './Dialogs';
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
  const piece = useGameStore((s) => s.piece);
  const setPiece = useGameStore((s) => s.setPiece);
  const shipFrom = useGameStore((s) => s.shipFrom);
  const setShipFrom = useGameStore((s) => s.setShipFrom);
  const paused = useRoomStore((s) => s.room?.paused ?? false);
  const { nameOf, colorOf } = useSeatMeta();
  const [picker, setPicker] = useState<DevPicker>(null);
  const compact = useMediaQuery(COMPACT_QUERY);
  const [sideTab, setSideTab] = useState<SideTab | null>('players');
  const view = payload?.view ?? null;
  const hl = useMemo(
    () => computeHighlights(view, mode, { piece, shipFrom }),
    [view, mode, piece, shipFrom],
  );

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
      const action = hl.edgeAction;
      if (!action || busy) return;
      if (action === 'MOVE_SHIP') {
        if (hl.shipFrom && (await send({ type: 'MOVE_SHIP', from: hl.shipFrom, to: id })))
          setMode(null);
        return;
      }
      const ok = await send({ type: action, edge: id });
      if (
        ok &&
        (action === 'BUILD_ROAD' || action === 'BUILD_SHIP') &&
        view?.phase.kind !== 'roadBuilding'
      )
        setMode(null);
    },
    [hl.edgeAction, hl.shipFrom, busy, send, setMode, view],
  );
  const onHex = useCallback(
    (id: string, action: HexAction) => {
      if (!busy) void send({ type: action, hex: id });
    },
    [busy, send],
  );
  const onShip = useCallback(
    (id: string) => setShipFrom(shipFrom === id ? null : id),
    [shipFrom, setShipFrom],
  );

  if (!view) return <div className="center-screen">Loading game…</div>;
  const prompt = phasePrompt(view, nameOf);
  const hint = modeHint(mode, hl);
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
          <span>
            {prompt.text}
            {hint && <span className="mode-hint"> · {hint}</span>}
          </span>
          {hl.pieces.length > 1 && (
            <span className="piece-toggle" role="group" aria-label="Piece to place">
              {hl.pieces.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={piece === p ? 'small on' : 'small'}
                  data-testid={`piece-${p}`}
                  aria-pressed={piece === p}
                  onClick={() => setPiece(p)}
                >
                  {p === 'road' ? 'Road' : 'Ship'}
                </button>
              ))}
            </span>
          )}
          {mode && (
            <button type="button" className="ghost small" onClick={() => setMode(null)}>
              {mode === 'moveShip' ? 'Cancel move' : 'Cancel build'}
            </button>
          )}
        </div>
        {me !== null && <TurnControls view={view} busy={busy} />}
        <Timer />
        <SoundToggle />
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
          onShip={onShip}
        />
      </main>

      <SideTabs
        compact={compact}
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
          log: <GameLog board={view.board} variant={view.config.variant} />,
          chat: <ChatPanel disabled={chatDisabled} />,
        }}
      />

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
      <GoldDialog view={view} busy={busy} />
      <StealDialog view={view} busy={busy} />
      <DevPickerDialog picker={picker} busy={busy} onClose={() => setPicker(null)} />
      <GameOverOverlay view={view} onLeave={onLeave} />
    </div>
  );
}
