import { useState } from 'react';
import type { BotDifficulty, RoomInfo, RoomSettings, SeatInfo } from '@hexhaven/shared';
import { canStart, effectiveVariant } from '../game/lobby';
import { emitAck } from '../net/socket';
import { leaveRoom, request } from '../net/session';
import { useSession } from '../store/session';
import { toastError, toastInfo } from '../store/toast';
import { VoiceBar } from '../voice/VoiceBar';
import { ChatPanel } from './ChatPanel';
import { MicIcon } from './icons';

const DIFFICULTIES: BotDifficulty[] = ['easy', 'normal', 'hard'];
const TIMERS = [0, 30, 60, 90, 120, 180, 300];

function SeatRow(props: {
  seat: SeatInfo;
  room: RoomInfo;
  isHost: boolean;
  myUserId: string;
  difficulty: BotDifficulty;
  setDifficulty(d: BotDifficulty): void;
}) {
  const { seat, room, isHost, myUserId } = props;
  const i = seat.index;
  const mine = seat.userId === myUserId;
  return (
    <li
      className={`seat seat-${seat.kind} ${mine ? 'me' : ''}`}
      data-testid={`seat-${i}`}
      data-kind={seat.kind}
      data-controller={seat.controller}
      style={{ ['--seat-color' as string]: seat.color }}
    >
      <span className="swatch" aria-hidden="true" />
      <div className="seat-main">
        {seat.kind === 'open' ? (
          <span className="muted">Open seat</span>
        ) : (
          <span className="seat-name">
            {seat.kind === 'human' && (
              <span
                className={seat.connected ? 'conn on' : 'conn off'}
                aria-label={seat.connected ? 'Connected' : 'Disconnected'}
                title={seat.connected ? 'Connected' : 'Disconnected'}
              />
            )}
            {seat.name}
            {mine && <span className="badge you">you</span>}
            {seat.userId === room.hostUserId && <span className="badge">host</span>}
            {seat.kind === 'bot' ? (
              <span className="badge ai">AI · {seat.botDifficulty}</span>
            ) : (
              <span className="badge">human</span>
            )}
            {seat.inVoice && (
              <span className="voice" aria-label={seat.muted ? 'In voice, muted' : 'In voice'}>
                <MicIcon muted={seat.muted} />
              </span>
            )}
          </span>
        )}
      </div>
      <div className="seat-actions">
        {seat.kind === 'human' && (
          <span className={seat.ready ? 'ready yes' : 'ready no'}>
            {seat.ready ? 'Ready' : 'Not ready'}
          </span>
        )}
        {seat.kind === 'open' && (
          <>
            <button
              type="button"
              data-testid={`sit-${i}`}
              onClick={() => request(emitAck('room:sit', { seat: i }))}
            >
              Sit here
            </button>
            {isHost && (
              <>
                <select
                  data-testid={`bot-difficulty-${i}`}
                  aria-label={`Bot difficulty for seat ${i + 1}`}
                  value={props.difficulty}
                  onChange={(e) => props.setDifficulty(e.target.value as BotDifficulty)}
                >
                  {DIFFICULTIES.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  data-testid={`add-bot-${i}`}
                  onClick={() =>
                    request(emitAck('room:addBot', { seat: i, difficulty: props.difficulty }))
                  }
                >
                  Add bot
                </button>
              </>
            )}
          </>
        )}
        {seat.kind === 'bot' && isHost && (
          <button
            type="button"
            className="ghost"
            data-testid={`remove-bot-${i}`}
            onClick={() => request(emitAck('room:removeBot', { seat: i }))}
          >
            Remove bot
          </button>
        )}
        {seat.kind === 'human' && isHost && !mine && seat.userId && (
          <button
            type="button"
            className="ghost danger"
            data-testid={`kick-${i}`}
            onClick={() => request(emitAck('room:kick', { userId: seat.userId! }))}
          >
            Kick
          </button>
        )}
      </div>
    </li>
  );
}

function SettingsForm({ room, editable }: { room: RoomInfo; editable: boolean }) {
  const s = room.settings;
  const update = (patch: Partial<RoomSettings>) => {
    const next = { ...s, ...patch };
    // Spiral numbering exists only for the standard board; fall back when switching away.
    const fixed: Partial<RoomSettings> =
      next.numberMode === 'spiral' && effectiveVariant(next) !== 'base'
        ? { ...patch, numberMode: 'random' }
        : patch;
    return request(emitAck('room:settings', { settings: fixed }));
  };
  const num = (v: string) => Number.parseInt(v, 10);
  const spiralAllowed = effectiveVariant(s) === 'base';

  return (
    <fieldset className="settings" disabled={!editable}>
      <legend>Settings{editable ? '' : ' (host only)'}</legend>
      <label>
        Seats
        <select
          data-testid="settings-max-seats"
          value={s.maxSeats}
          onChange={(e) => update({ maxSeats: num(e.target.value) })}
        >
          {[3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>
              {n} players
            </option>
          ))}
        </select>
      </label>
      <label>
        Board
        <select
          data-testid="settings-variant"
          value={s.variant}
          onChange={(e) => update({ variant: e.target.value as RoomSettings['variant'] })}
        >
          <option value="auto">Automatic</option>
          <option value="base">Standard (3–4)</option>
          <option value="ext56">Large (5–6)</option>
        </select>
      </label>
      <label>
        Points to win
        <input
          type="number"
          data-testid="settings-vp"
          min={5}
          max={20}
          value={s.vpToWin}
          onChange={(e) => {
            const v = num(e.target.value);
            if (v >= 5 && v <= 20) void update({ vpToWin: v });
          }}
        />
      </label>
      <label>
        Discard above
        <input
          type="number"
          data-testid="settings-discard"
          min={5}
          max={15}
          value={s.discardLimit}
          onChange={(e) => {
            const v = num(e.target.value);
            if (v >= 5 && v <= 15) void update({ discardLimit: v });
          }}
        />
      </label>
      <label>
        Numbers
        <select
          data-testid="settings-number-mode"
          value={s.numberMode}
          onChange={(e) => update({ numberMode: e.target.value as RoomSettings['numberMode'] })}
        >
          <option value="random">Random (no adjacent 6/8)</option>
          <option value="spiral" disabled={!spiralAllowed}>
            Spiral{spiralAllowed ? '' : ' (standard board only)'}
          </option>
        </select>
      </label>
      <label>
        Ports
        <select
          data-testid="settings-port-mode"
          value={s.portMode}
          onChange={(e) => update({ portMode: e.target.value as RoomSettings['portMode'] })}
        >
          <option value="fixed">Fixed spots</option>
          <option value="random">Random spots</option>
        </select>
      </label>
      <label>
        Turn timer
        <select
          data-testid="settings-timer"
          value={s.turnTimerSec}
          onChange={(e) => update({ turnTimerSec: num(e.target.value) })}
        >
          {(TIMERS.includes(s.turnTimerSec) ? TIMERS : [...TIMERS, s.turnTimerSec]).map((t) => (
            <option key={t} value={t}>
              {t === 0 ? 'Off' : `${t}s`}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  );
}

export function Lobby({ room }: { room: RoomInfo }) {
  const user = useSession((s) => s.user)!;
  const [difficulty, setDifficulty] = useState<Record<number, BotDifficulty>>({});
  const [filling, setFilling] = useState(false);
  const isHost = room.hostUserId === user.id;
  const seats = room.seats.slice(0, room.settings.maxSeats);
  const mySeat = seats.find((s) => s.userId === user.id);
  const openSeats = seats.filter((s) => s.kind === 'open');
  const diffOf = (i: number) => difficulty[i] ?? 'normal';

  const copyInvite = async () => {
    const link = `${location.origin}/r/${room.code}`;
    try {
      await navigator.clipboard.writeText(link);
      toastInfo('Invite link copied');
    } catch {
      toastError(`Copy failed. Share this link: ${link}`);
    }
  };

  const fillBots = async () => {
    setFilling(true);
    for (const s of openSeats) {
      const ok = await request(
        emitAck('room:addBot', { seat: s.index, difficulty: diffOf(s.index) }),
      );
      if (ok === undefined) break;
    }
    setFilling(false);
  };

  return (
    <div className="lobby">
      <header className="lobby-head">
        <div className="room-id">
          <span className="muted">Room</span>
          <strong className="code" data-testid="room-code">
            {room.code}
          </strong>
          <button type="button" data-testid="copy-invite" onClick={copyInvite}>
            Copy invite link
          </button>
        </div>
        <VoiceBar />
        <button type="button" className="ghost" onClick={() => leaveRoom()}>
          Leave room
        </button>
      </header>

      <div className="lobby-body">
        <section className="panel seats" aria-label="Seats">
          <h2>Players</h2>
          <ul>
            {seats.map((s) => (
              <SeatRow
                key={s.index}
                seat={s}
                room={room}
                isHost={isHost}
                myUserId={user.id}
                difficulty={diffOf(s.index)}
                setDifficulty={(d) => setDifficulty({ ...difficulty, [s.index]: d })}
              />
            ))}
          </ul>
          {room.spectators.length > 0 && (
            <p className="muted small">Watching: {room.spectators.map((s) => s.name).join(', ')}</p>
          )}
          <div className="actions">
            {mySeat && (
              <>
                <button
                  type="button"
                  className={mySeat.ready ? 'primary' : ''}
                  data-testid="ready-toggle"
                  aria-pressed={mySeat.ready}
                  onClick={() => request(emitAck('room:ready', { ready: !mySeat.ready }))}
                >
                  {mySeat.ready ? 'Ready ✓' : 'I’m ready'}
                </button>
                <button
                  type="button"
                  className="ghost"
                  data-testid="stand"
                  onClick={() => request(emitAck('room:stand', {}))}
                >
                  Stand up
                </button>
              </>
            )}
            {isHost && (
              <>
                <button
                  type="button"
                  data-testid="fill-bots"
                  disabled={filling || openSeats.length === 0}
                  onClick={fillBots}
                >
                  Fill empty seats with bots
                </button>
                <button
                  type="button"
                  className="primary"
                  data-testid="start-game"
                  disabled={!canStart(room)}
                  title={
                    canStart(room) ? undefined : 'Every seat must be filled and every human ready'
                  }
                  onClick={() => request(emitAck('room:start', {}))}
                >
                  Start game
                </button>
              </>
            )}
          </div>
          {!isHost && (
            <p className="muted small">The host starts the game when everyone is ready.</p>
          )}
        </section>

        <SettingsForm room={room} editable={isHost} />
        <ChatPanel />
      </div>
    </div>
  );
}
