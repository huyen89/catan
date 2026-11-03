import { useEffect, useRef, useState } from 'react';
import type { RoomInfo } from '@hexhaven/shared';
import { getSocket } from '../net/socket';
import { runIceTest } from './iceTest';
import {
  ROUTE_LABEL,
  iceTestVerdict,
  routeDescription,
  routeKind,
  type IceTestResult,
} from './logic';
import { useVoiceStore, type PeerVoice } from './store';
import './VoiceBar.css';

export interface VoiceBarProps {
  /** userId → display name. Defaults to names seen in room:state updates. */
  names?: Record<string, string>;
}

/** Leave voice if no VoiceBar is on screen for this long (keeps lobby→game transitions alive). */
const UNMOUNT_LEAVE_MS = 2000;
let mountedBars = 0;
let unmountTimer: ReturnType<typeof setTimeout> | null = null;

function useAutoLeaveOnUnmount(): void {
  useEffect(() => {
    mountedBars++;
    if (unmountTimer) clearTimeout(unmountTimer);
    unmountTimer = null;
    return () => {
      mountedBars--;
      if (mountedBars > 0) return;
      // Nobody can see the mic controls any more: don't leave a mic open in the background.
      unmountTimer = setTimeout(() => {
        unmountTimer = null;
        if (mountedBars === 0) useVoiceStore.getState().leave();
      }, UNMOUNT_LEAVE_MS);
    };
  }, []);
}

function namesFromRoom(room: RoomInfo): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of room.seats) if (s.userId && s.kind === 'human') out[s.userId] = s.name;
  for (const s of room.spectators) out[s.userId] = s.name;
  return out;
}

function useRoomNames(enabled: boolean): Record<string, string> {
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!enabled) return;
    const socket = getSocket();
    const onRoom = (room: RoomInfo) => setNames(namesFromRoom(room));
    socket.on('room:state', onRoom);
    return () => {
      socket.off('room:state', onRoom);
    };
  }, [enabled]);
  return names;
}

function MicIcon({ off }: { off: boolean }) {
  return (
    <svg className="vb-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zm-6 9a6 6 0 0 0 5 5.9V21h2v-3.1A6 6 0 0 0 18 12h-2a4 4 0 0 1-8 0H6z"
        fill="currentColor"
      />
      {off && <path d="M4 4l16 16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />}
    </svg>
  );
}

function RouteBadge({ peer }: { peer: PeerVoice }) {
  if (!peer.route || peer.connection !== 'connected') return null;
  const kind = routeKind(peer.route);
  const description = routeDescription(peer.route);
  return (
    <span
      className={`vb-route vb-route--${kind}`}
      data-testid={`voice-route-${peer.userId}`}
      data-route={kind}
      title={description}
      aria-label={description}
      role="img"
    >
      {ROUTE_LABEL[kind].short}
    </span>
  );
}

const yesNo = (v: boolean) => (v ? 'yes' : 'no');

function ConnectionTest() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<IceTestResult | null>(null);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const run = () => {
    if (running) return;
    setRunning(true);
    setFailed(false);
    runIceTest().then(
      (r) => {
        if (!alive.current) return;
        setResult(r);
        setRunning(false);
      },
      () => {
        if (!alive.current) return;
        setFailed(true);
        setRunning(false);
      },
    );
  };

  const verdict = result && iceTestVerdict(result);
  const relays = result
    ? (['udp', 'tcp', 'tls'] as const).filter((p) => result.relay[p]).map((p) => p.toUpperCase())
    : [];
  if (result?.relay.unknown) relays.push('relay (transport unknown)');

  return (
    <details className="vb-diag">
      <summary>Connection test</summary>
      <button
        type="button"
        className="vb-btn vb-btn--quiet"
        data-testid="voice-test-connection"
        disabled={running || typeof RTCPeerConnection === 'undefined'}
        onClick={run}
      >
        {running ? 'Testing…' : 'Test connection'}
      </button>
      <div role="status" aria-live="polite">
        {failed && <p className="vb-note">The test could not run in this browser.</p>}
        {result && verdict && (
          <div className={`vb-diag-result vb-diag-result--${verdict.level}`}>
            <p className="vb-diag-verdict">{verdict.message}</p>
            <dl className="vb-diag-list" data-testid="voice-test-result">
              <dt>STUN (public address)</dt>
              <dd>{yesNo(result.stun)}</dd>
              <dt>TURN relay</dt>
              <dd>
                {relays.length > 0
                  ? relays.join(', ')
                  : result.turnConfigured
                    ? 'no answer'
                    : 'not configured'}
              </dd>
              <dt>Time</dt>
              <dd>{(result.ms / 1000).toFixed(1)} s</dd>
            </dl>
          </div>
        )}
      </div>
    </details>
  );
}

function PeerRow({ peer, name }: { peer: PeerVoice; name: string }) {
  const setVolume = useVoiceStore((s) => s.setVolume);
  return (
    <li
      className="vb-peer"
      data-testid={`voice-peer-${peer.userId}`}
      data-connection={peer.connection}
      data-speaking={peer.speaking}
      data-muted={peer.muted}
    >
      <span
        className={`vb-status vb-status--${peer.connection}`}
        title={`Connection: ${peer.connection}`}
        aria-hidden="true"
      />
      <span className={`vb-name${peer.speaking ? ' vb-name--speaking' : ''}`} title={name}>
        {name}
      </span>
      <span className="vb-badges">
        <RouteBadge peer={peer} />
        {peer.muted && (
          <span className="vb-peer-muted" role="img" aria-label={`${name} is muted`}>
            <MicIcon off />
          </span>
        )}
      </span>
      <input
        className="vb-volume"
        type="range"
        min={0}
        max={100}
        step={5}
        value={Math.round(peer.volume * 100)}
        aria-label={`Volume for ${name}`}
        onChange={(e) => setVolume(peer.userId, Number(e.currentTarget.value) / 100)}
      />
    </li>
  );
}

/** Mic join/leave/mute controls. Owned by workstream V; placed in the game/lobby layout by W. */
export function VoiceBar({ names }: VoiceBarProps = {}) {
  const joined = useVoiceStore((s) => s.joined);
  const joining = useVoiceStore((s) => s.joining);
  const muted = useVoiceStore((s) => s.muted);
  const speaking = useVoiceStore((s) => s.speaking);
  const micPending = useVoiceStore((s) => s.micPending);
  const audioBlocked = useVoiceStore((s) => s.audioBlocked);
  const error = useVoiceStore((s) => s.error);
  const peers = useVoiceStore((s) => s.peers);
  const { join, leave, toggleMute, resumeAudio, clearError } = useVoiceStore.getState();
  const roomNames = useRoomNames(!names);
  useAutoLeaveOnUnmount();

  const nameOf = (id: string) => names?.[id] ?? roomNames[id] ?? `Player ${id.slice(0, 4)}`;
  const peerList = Object.values(peers).sort((a, b) =>
    nameOf(a.userId).localeCompare(nameOf(b.userId)),
  );
  const active = joined || joining;

  return (
    <section
      className="vb"
      aria-label="Voice chat"
      data-joined={joined}
      data-muted={muted}
      data-speaking={speaking}
    >
      <div className="vb-controls">
        {!active && (
          <button
            type="button"
            className="vb-btn vb-btn--primary"
            data-testid="voice-join"
            aria-label="Join voice chat"
            onClick={() => void join()}
          >
            <MicIcon off />
            <span>Join voice</span>
          </button>
        )}
        {active && (
          <>
            <button
              type="button"
              className={`vb-btn vb-mic${muted ? '' : ' vb-mic--live'}${
                speaking ? ' vb-mic--speaking' : ''
              }`}
              data-testid="voice-mute-toggle"
              aria-pressed={!muted}
              aria-label={muted ? 'Turn microphone on' : 'Turn microphone off'}
              disabled={!joined || micPending}
              onClick={toggleMute}
            >
              <MicIcon off={muted} />
              <span>{micPending ? 'Allow mic…' : muted ? 'Mic off' : 'Mic on'}</span>
            </button>
            <button
              type="button"
              className="vb-btn vb-btn--quiet"
              data-testid="voice-leave"
              aria-label="Leave voice chat"
              onClick={leave}
            >
              Leave
            </button>
          </>
        )}
      </div>

      {joining && (
        <p className="vb-note" role="status">
          Connecting to voice…
        </p>
      )}

      {audioBlocked && (
        <button
          type="button"
          className="vb-btn vb-btn--primary vb-enable"
          data-testid="voice-enable-audio"
          onClick={resumeAudio}
        >
          Click to enable audio
        </button>
      )}

      {error && (
        <p className="vb-error" role="alert">
          <span>{error}</span>
          <button
            type="button"
            className="vb-dismiss"
            aria-label="Dismiss voice error"
            onClick={clearError}
          >
            ×
          </button>
        </p>
      )}

      {joined && (
        <ul className="vb-peers" aria-label="People in voice">
          {peerList.map((p) => (
            <PeerRow key={p.userId} peer={p} name={nameOf(p.userId)} />
          ))}
          {peerList.length === 0 && <li className="vb-note">No one else is in voice yet.</li>}
        </ul>
      )}

      <ConnectionTest />
    </section>
  );
}
