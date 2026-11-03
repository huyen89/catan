import { useEffect, useState } from 'react';
import {
  effectiveScenario,
  type BotDifficulty,
  type RoomInfo,
  type RoomSettings,
  type SeatInfo,
} from '@hexhaven/shared';
import {
  canStart,
  effectiveVariant,
  parseBoundedInt,
  scenarioOptions,
  settingsPatch,
  startErrorText,
} from '../game/lobby';
import { AckFailure, errorMessage } from '../net/emit';
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

/**
 * Number input with a local draft: typing never round-trips to the server; the value is
 * validated and sent on blur or Enter (Escape reverts).
 */
function NumberSetting(props: {
  testId: string;
  min: number;
  max: number;
  value: number;
  onCommit(v: number): unknown;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const v = parseBoundedInt(draft, props.min, props.max);
    if (v === null) toastError(`Enter a number from ${props.min} to ${props.max}`);
    else if (v !== props.value) void props.onCommit(v);
    setDraft(null);
  };
  return (
    <input
      type="number"
      inputMode="numeric"
      data-testid={props.testId}
      min={props.min}
      max={props.max}
      value={draft ?? String(props.value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          setDraft(null);
        }
      }}
    />
  );
}

function SettingsForm({ room, editable }: { room: RoomInfo; editable: boolean }) {
  const s = room.settings;
  // The server applies the patch with mergeRoomSettings (which also picks an Open Seas
  // scenario's points target); the form shows whatever room:state comes back.
  const update = (patch: Partial<RoomSettings>) =>
    request(emitAck('room:settings', { settings: settingsPatch(s, patch) }));
  const num = (v: string) => Number.parseInt(v, 10);
  const spiralAllowed = effectiveVariant(s) === 'base';
  const seas = s.variant === 'seafarers';
  const scenario = effectiveScenario(s);

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
          <option value="seafarers">Open Seas</option>
        </select>
      </label>
      {seas && (
        <label>
          Scenario
          <select
            data-testid="settings-scenario"
            value={scenario}
            onChange={(e) => update({ scenario: e.target.value as RoomSettings['scenario'] })}
          >
            {scenarioOptions(s.maxSeats).map((o) => (
              <option key={o.id} value={o.id} disabled={!o.fits}>
                {o.name} ({o.range})
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Points to win
        <NumberSetting
          testId="settings-vp"
          min={5}
          max={20}
          value={s.vpToWin}
          onCommit={(v) => update({ vpToWin: v })}
        />
        {seas && <span className="muted small">Set by the scenario; you can change it.</span>}
      </label>
      <label>
        Discard above
        <NumberSetting
          testId="settings-discard"
          min={5}
          max={15}
          value={s.discardLimit}
          onCommit={(v) => update({ discardLimit: v })}
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
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  // A refused start is about the settings at the time: drop the notice once they change.
  const settingsKey = JSON.stringify(room.settings);
  useEffect(() => setStartError(null), [settingsKey]);
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

  const start = async () => {
    setStarting(true);
    setStartError(null);
    try {
      await emitAck('room:start', {});
    } catch (e) {
      const friendly = e instanceof AckFailure ? startErrorText(e.code) : null;
      if (friendly) setStartError(friendly);
      else toastError(errorMessage(e));
    } finally {
      setStarting(false);
    }
  };

  const fillBots = async () => {
    setFilling(true);
    for (const s of openSeats) {
      const res = await request(
        emitAck('room:addBot', { seat: s.index, difficulty: diffOf(s.index) }),
      );
      if (!res.ok) break;
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
                  disabled={starting || !canStart(room)}
                  title={
                    canStart(room) ? undefined : 'Every seat must be filled and every human ready'
                  }
                  onClick={start}
                >
                  Start game
                </button>
              </>
            )}
          </div>
          {startError && (
            <p className="notice" role="alert" data-testid="start-error">
              {startError}
            </p>
          )}
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
