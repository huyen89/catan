import type {
  Ack,
  MeResponse,
  ServerToClientEvents,
  VoicePeer,
  VoiceSignalData,
} from '@hexhaven/shared';
import type { HexClientSocket } from '../net/socket';
import {
  FALLBACK_ICE_SERVERS,
  SILENT,
  clampVolume,
  iceNeedsRefresh,
  iceRestartDelay,
  isPolite,
  joinErrorMessage,
  micErrorMessage,
  mutedFromAck,
  rms,
  selectedRoute,
  updateSpeaking,
  type SpeakingTracker,
} from './logic';
import { fetchIceServers } from './iceServers';
import type { PeerVoice, VoiceState } from './store';

type SetState = (partial: Partial<VoiceState> | ((s: VoiceState) => Partial<VoiceState>)) => void;

export interface VoiceManagerDeps {
  getSocket: () => HexClientSocket;
  setState: SetState;
}

const ACK_TIMEOUT_MS = 8000;
const SPEAKING_INTERVAL_MS = 100;
const REJOIN_WAIT_MS = 1500;
/** A restart that has not reconnected by then may be retried. */
const RESTART_RETRY_MS = 10_000;
/** The selected pair can still change right after connecting (e.g. host → relay); look again. */
const ROUTE_RECHECK_MS = 3000;
const VOLUME_KEY = 'hexhaven.voice.volumes';

const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  video: false,
};

/** Analyser-based level meter for one stream. */
class Meter {
  private readonly source: MediaStreamAudioSourceNode;
  private readonly analyser: AnalyserNode;
  private readonly buf: Float32Array<ArrayBuffer>;
  tracker: SpeakingTracker = SILENT;

  constructor(ctx: AudioContext, stream: MediaStream) {
    this.source = ctx.createMediaStreamSource(stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.buf = new Float32Array(this.analyser.fftSize);
    // Not connected to the destination: playback goes through <audio> elements.
    this.source.connect(this.analyser);
  }

  level(): number {
    this.analyser.getFloatTimeDomainData(this.buf);
    return rms(this.buf);
  }

  dispose(): void {
    this.source.disconnect();
  }
}

interface Peer {
  userId: string;
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  settingRemoteAnswer: boolean;
  restarting: boolean;
  /** Pending ICE restart (ICE 'disconnected' for a while), or the retry guard. */
  restartTimer: ReturnType<typeof setTimeout> | null;
  /** Bumped per restartIce() call so a stale async attempt can tell it was superseded. */
  restartAttempt: number;
  /** One delayed getStats re-check after connecting. */
  routeTimer: ReturnType<typeof setTimeout> | null;
  /** ICE transport whose onselectedcandidatepairchange we listen to (where supported). */
  iceTransport: RTCIceTransport | null;
  /** Serializes incoming signals so description/candidate order is preserved. */
  queue: Promise<void>;
  audio: HTMLAudioElement;
  meter: Meter | null;
  muted: boolean;
}

interface Session {
  selfId: string;
  joined: boolean;
  /** Socket dropped; waiting to re-join after reconnect. */
  reconnecting: boolean;
  listeners: Array<[string, (...args: never[]) => void]>;
}

function query(name: string): string | null {
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch {
    return null;
  }
}

function loadVolumes(): Map<string, number> {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    const obj = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    return new Map(
      Object.entries(obj)
        .filter((e): e is [string, number] => typeof e[1] === 'number')
        .map(([k, v]) => [k, clampVolume(v)]),
    );
  } catch {
    return new Map();
  }
}

function ackErrorCode(err: unknown): string {
  return err instanceof Error && /timed? ?out/i.test(err.message) ? 'timeout' : 'unknown';
}

/**
 * Audio-only WebRTC full mesh (≤6 peers) signaled over the app socket.
 *
 * Negotiation: "perfect negotiation" with polite = selfId < peerId. Only the impolite side adds
 * an audio transceiver, so it sends the first offer; the polite side answers on the transceiver
 * created by that offer. The mic track is attached with replaceTrack, so turning the mic on
 * later never needs renegotiation and joining (muted) does not ask for mic permission.
 */
export class VoiceManager {
  private session: Session | null = null;
  /** A join is between click and voice:join emit (fetching identity / ICE servers). */
  private starting = false;
  private generation = 0;
  private readonly peers = new Map<string, Peer>();
  private readonly remoteMuted = new Map<string, boolean>();
  private readonly volumes = loadVolumes();
  private localStream: MediaStream | null = null;
  private localMeter: Meter | null = null;
  private micPending: Promise<MediaStreamTrack | null> | null = null;
  private muted = true;
  private audioCtx: AudioContext | null = null;
  private audioBlocked = false;
  private iceServers: RTCIceServer[] = FALLBACK_ICE_SERVERS;
  private iceFetchedAt = 0;
  private iceTtl = 3600;
  private speakingTimer: ReturnType<typeof setInterval> | null = null;
  private audioContainer: HTMLElement | null = null;
  private readonly relayOnly = query('voiceRelay') === '1';

  constructor(private readonly deps: VoiceManagerDeps) {}

  private get socket(): HexClientSocket {
    return this.deps.getSocket();
  }

  // ------------------------------------------------------------------ public API

  async join(selfUserId?: string): Promise<void> {
    if (this.session || this.starting) return;
    if (typeof RTCPeerConnection === 'undefined') {
      this.deps.setState({ error: 'This browser does not support voice chat.' });
      return;
    }
    const gen = ++this.generation;
    this.starting = true;
    this.deps.setState({ joining: true, error: null });
    // Created inside the click handler so the browser allows audio output.
    this.ensureAudioContext();
    try {
      const selfId = selfUserId ?? (await this.fetchSelfId());
      if (gen !== this.generation) return;
      if (!selfId) return this.teardown(false, joinErrorMessage('unauthenticated'));
      this.deps.setState({ selfUserId: selfId });
      await this.refreshIce();
      if (gen !== this.generation) return;
      this.session = { selfId, joined: false, reconnecting: false, listeners: [] };
      // Listen before emitting so no peer signal sent right after our ack is missed.
      this.attachListeners(this.session);
    } finally {
      this.starting = false;
    }
    await this.sendJoin(gen);
  }

  leave(): void {
    this.teardown(this.session !== null, null);
  }

  async setMuted(muted: boolean): Promise<void> {
    const session = this.session;
    if (!session?.joined) return;
    if (!muted) {
      const track = await this.ensureMic();
      if (!track || this.session !== session) return;
      track.enabled = true;
    } else if (this.localStream) {
      for (const t of this.localStream.getAudioTracks()) t.enabled = false;
    }
    this.muted = muted;
    this.deps.setState(muted ? { muted, speaking: false } : { muted, error: null });
    if (this.localMeter && muted) this.localMeter.tracker = SILENT;
    this.emitState();
  }

  toggleMute(): void {
    void this.setMuted(!this.muted);
  }

  setVolume(userId: string, volume: number): void {
    const v = clampVolume(volume);
    this.volumes.set(userId, v);
    try {
      localStorage.setItem(VOLUME_KEY, JSON.stringify(Object.fromEntries(this.volumes)));
    } catch {
      // Storage unavailable (private mode); volume still applies for this session.
    }
    const peer = this.peers.get(userId);
    if (peer) peer.audio.volume = v;
    this.patchPeer(userId, { volume: v });
  }

  /** Retry playback after the browser's autoplay policy blocked it (needs a user gesture). */
  resumeAudio(): void {
    void this.audioCtx?.resume();
    const plays = [...this.peers.values()].map((p) => p.audio.play());
    void Promise.all(plays).then(
      () => this.setAudioBlocked(false),
      () => this.setAudioBlocked(true),
    );
  }

  /** Snapshot for e2e/debugging (window.__hexVoice). */
  debugPeers(): Record<string, Record<string, string | boolean>> {
    const out: Record<string, Record<string, string | boolean>> = {};
    for (const [id, p] of this.peers) {
      out[id] = {
        polite: p.polite,
        connectionState: p.pc.connectionState,
        iceConnectionState: p.pc.iceConnectionState,
        signalingState: p.pc.signalingState,
        transceivers: p.pc
          .getTransceivers()
          .map((t) => `${t.mid}:${t.currentDirection}`)
          .join(','),
      };
    }
    return out;
  }

  /** Selected candidate pair types per peer, e.g. {bob: 'host/relay'} (debug). */
  async debugCandidates(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const [id, p] of this.peers) {
      const route = selectedRoute((await p.pc.getStats()).values());
      if (route) out[id] = `${route.local}/${route.remote}`;
    }
    return out;
  }

  // ------------------------------------------------------------------ session lifecycle

  private async fetchSelfId(): Promise<string | null> {
    try {
      const res = await fetch('/api/me', { credentials: 'include' });
      if (!res.ok) return null;
      const me = (await res.json()) as MeResponse;
      return me.user?.id ?? null;
    } catch {
      return null;
    }
  }

  private async refreshIce(): Promise<void> {
    const { iceServers, ttl } = await fetchIceServers();
    this.iceServers = iceServers;
    this.iceTtl = ttl;
    this.iceFetchedAt = Date.now();
  }

  private async sendJoin(gen: number): Promise<void> {
    let ack: Ack<{ peers: VoicePeer[] }>;
    try {
      ack = await this.socket.timeout(ACK_TIMEOUT_MS).emitWithAck('voice:join', {});
    } catch (err) {
      if (gen === this.generation) this.teardown(false, joinErrorMessage(ackErrorCode(err)));
      return;
    }
    const session = this.session;
    if (gen !== this.generation || !session) return;
    if (!ack.ok) return this.teardown(false, joinErrorMessage(ack.error.code));

    session.joined = true;
    session.reconnecting = false;
    this.deps.setState({ joined: true, joining: false, muted: this.muted, error: null });
    // The ack's mic states are newer than any voice:state seen before joining.
    this.remoteMuted.clear();
    for (const [id, muted] of mutedFromAck(ack.data.peers)) this.remoteMuted.set(id, muted);
    for (const peer of ack.data.peers) this.ensurePeer(peer.userId);
    // The server marks a fresh join as muted; restore an open mic after a reconnect.
    if (!this.muted) this.emitState();
    this.startSpeakingLoop();
  }

  private attachListeners(session: Session): void {
    const s = this.socket;
    const on = <E extends keyof ServerToClientEvents>(ev: E, fn: ServerToClientEvents[E]) => {
      s.on(ev, fn as never);
      session.listeners.push([ev, fn as never]);
    };
    const onSys = (ev: 'connect' | 'disconnect', fn: () => void) => {
      s.on(ev, fn);
      session.listeners.push([ev, fn]);
    };

    on('voice:peerJoined', ({ userId }) => {
      if (!session.joined || userId === session.selfId) return;
      // A user re-joining (new tab, reconnect) is a new endpoint: start over.
      this.closePeer(userId);
      this.ensurePeer(userId);
      // Newcomers learn mute states from voice:state; repeat ours for them.
      this.emitState();
    });
    on('voice:peerLeft', ({ userId }) => {
      if (userId === session.selfId) {
        if (session.joined) {
          this.teardown(false, 'Voice ended: you left the room or joined voice in another tab.');
        }
        return;
      }
      this.closePeer(userId);
      this.remoteMuted.delete(userId);
    });
    on('voice:signal', ({ from, data }) => {
      if (!session.joined || from === session.selfId) return;
      const peer = this.ensurePeer(from);
      peer.queue = peer.queue
        .then(() => this.handleSignal(peer, data))
        .catch((err: unknown) => console.warn('[voice] signal handling failed', err));
    });
    on('voice:state', ({ userId, muted, inVoice }) => {
      if (userId === session.selfId) return;
      if (!inVoice) {
        this.remoteMuted.delete(userId);
        return;
      }
      this.remoteMuted.set(userId, muted);
      const peer = this.peers.get(userId);
      if (peer) {
        peer.muted = muted;
        if (muted && peer.meter) peer.meter.tracker = SILENT;
        this.patchPeer(userId, muted ? { muted, speaking: false } : { muted });
      }
    });
    on('room:closed', () => {
      if (this.session === session) this.teardown(false, null);
    });
    onSys('disconnect', () => {
      if (!session.joined) return;
      // The server dropped us from voice; peers will tear down their side too.
      session.joined = false;
      session.reconnecting = true;
      this.closeAllPeers();
      this.deps.setState({ joined: false, joining: true });
    });
    onSys('connect', () => {
      if (!session.reconnecting) return;
      const gen = this.generation;
      // Give the server a moment to restore our room membership before re-joining voice.
      let done = false;
      const go = () => {
        if (done) return;
        done = true;
        s.off('room:state', go);
        clearTimeout(timer);
        if (gen === this.generation && this.session === session) void this.sendJoin(gen);
      };
      const timer = setTimeout(go, REJOIN_WAIT_MS);
      s.on('room:state', go);
    });
  }

  private teardown(notifyServer: boolean, error: string | null): void {
    const session = this.session;
    this.generation++;
    this.session = null;
    if (session) {
      for (const [ev, fn] of session.listeners) this.socket.off(ev as never, fn as never);
      if (notifyServer && this.socket.connected) this.socket.emit('voice:leave', {}, () => {});
    }
    this.closeAllPeers();
    this.remoteMuted.clear();
    if (this.speakingTimer) clearInterval(this.speakingTimer);
    this.speakingTimer = null;
    this.localMeter?.dispose();
    this.localMeter = null;
    for (const t of this.localStream?.getTracks() ?? []) t.stop();
    this.localStream = null;
    this.micPending = null;
    this.muted = true;
    void this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
    this.audioBlocked = false;
    this.audioContainer?.remove();
    this.audioContainer = null;
    this.deps.setState({
      joined: false,
      joining: false,
      muted: true,
      speaking: false,
      micPending: false,
      audioBlocked: false,
      peers: {},
      error,
    });
  }

  private emitState(): void {
    if (this.session?.joined) this.socket.emit('voice:state', { muted: this.muted }, () => {});
  }

  // ------------------------------------------------------------------ microphone

  private async ensureMic(): Promise<MediaStreamTrack | null> {
    const existing = this.localStream?.getAudioTracks()[0];
    if (existing && existing.readyState === 'live') return existing;
    this.micPending ??= this.openMic();
    return this.micPending;
  }

  private async openMic(): Promise<MediaStreamTrack | null> {
    const gen = this.generation;
    this.deps.setState({ micPending: true });
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw Object.assign(new Error('insecure'), { name: 'InsecureContext' });
      }
      const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
      if (gen !== this.generation) {
        for (const t of stream.getTracks()) t.stop();
        return null;
      }
      const track = stream.getAudioTracks()[0];
      if (!track) throw Object.assign(new Error('no track'), { name: 'NotFoundError' });
      track.enabled = false;
      track.addEventListener('ended', () => {
        if (this.localStream !== stream) return;
        this.localStream = null;
        this.localMeter?.dispose();
        this.localMeter = null;
        void this.setMuted(true);
        this.deps.setState({ error: 'Your microphone was disconnected.' });
      });
      this.localStream = stream;
      for (const peer of this.peers.values()) this.attachLocalTrack(peer);
      if (this.audioCtx) {
        try {
          this.localMeter = new Meter(this.audioCtx, stream);
        } catch {
          this.localMeter = null;
        }
      }
      return track;
    } catch (err) {
      if (gen === this.generation) this.deps.setState({ error: micErrorMessage(err) });
      return null;
    } finally {
      if (gen === this.generation) {
        this.micPending = null;
        this.deps.setState({ micPending: false });
      }
    }
  }

  /** Put the mic track on every negotiated audio sender (no renegotiation needed). */
  private attachLocalTrack(peer: Peer): void {
    const track = this.localStream?.getAudioTracks()[0] ?? null;
    for (const t of peer.pc.getTransceivers()) {
      if (t.receiver.track.kind !== 'audio' || t.currentDirection === 'stopped') continue;
      if (t.direction !== 'sendrecv' && t.direction !== 'sendonly') continue;
      if (t.sender.track !== track) {
        void t.sender.replaceTrack(track).catch(() => {});
      }
    }
  }

  // ------------------------------------------------------------------ peers

  private ensurePeer(userId: string): Peer {
    const existing = this.peers.get(userId);
    if (existing) return existing;
    const session = this.session!;
    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceTransportPolicy: this.relayOnly ? 'relay' : 'all',
    });
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.setAttribute('playsinline', '');
    audio.volume = this.volumes.get(userId) ?? 1;
    audio.dataset.voicePeer = userId;
    this.ensureAudioContainer().append(audio);

    const peer: Peer = {
      userId,
      pc,
      polite: isPolite(session.selfId, userId),
      makingOffer: false,
      ignoreOffer: false,
      settingRemoteAnswer: false,
      restarting: false,
      restartTimer: null,
      restartAttempt: 0,
      routeTimer: null,
      iceTransport: null,
      queue: Promise.resolve(),
      audio,
      meter: null,
      muted: this.remoteMuted.get(userId) ?? true,
    };
    this.peers.set(userId, peer);
    this.patchPeer(userId, {
      userId,
      connection: pc.connectionState,
      speaking: false,
      muted: peer.muted,
      volume: audio.volume,
      route: null,
    });

    pc.onicecandidate = ({ candidate }) => {
      const c = candidate
        ? {
            candidate: candidate.candidate,
            sdpMid: candidate.sdpMid,
            sdpMLineIndex: candidate.sdpMLineIndex,
            usernameFragment: candidate.usernameFragment,
          }
        : null;
      this.sendSignal(userId, { candidate: c });
    };
    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        this.sendDescription(peer);
      } catch (err) {
        console.warn('[voice] negotiation failed', err);
      } finally {
        peer.makingOffer = false;
      }
    };
    pc.onconnectionstatechange = () => {
      if (this.peers.get(userId) !== peer) return;
      this.patchPeer(userId, { connection: pc.connectionState });
    };
    pc.oniceconnectionstatechange = () => this.onIceState(peer);
    pc.ontrack = (ev) => {
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);
      if (audio.srcObject !== stream) audio.srcObject = stream;
      this.play(audio);
      peer.meter?.dispose();
      peer.meter = null;
      if (this.audioCtx) {
        try {
          peer.meter = new Meter(this.audioCtx, stream);
        } catch {
          peer.meter = null;
        }
      }
    };

    if (!peer.polite) {
      // The impolite side owns the transceiver and makes the first offer.
      const track = this.localStream?.getAudioTracks()[0];
      pc.addTransceiver(track ?? 'audio', {
        direction: 'sendrecv',
        streams: this.localStream ? [this.localStream] : [],
      });
    }
    return peer;
  }

  private async handleSignal(peer: Peer, data: VoiceSignalData): Promise<void> {
    if (this.peers.get(peer.userId) !== peer) return;
    const { pc } = peer;
    if ('description' in data) {
      const description = data.description;
      const readyForOffer =
        !peer.makingOffer && (pc.signalingState === 'stable' || peer.settingRemoteAnswer);
      const offerCollision = description.type === 'offer' && !readyForOffer;
      peer.ignoreOffer = !peer.polite && offerCollision;
      if (peer.ignoreOffer) return;
      peer.settingRemoteAnswer = description.type === 'answer';
      await pc.setRemoteDescription(description);
      peer.settingRemoteAnswer = false;
      if (description.type === 'offer') {
        // Answer with our mic on the transceiver the offer created.
        for (const t of pc.getTransceivers()) {
          if (t.receiver.track.kind === 'audio' && t.direction === 'recvonly') {
            t.direction = 'sendrecv';
          }
        }
        this.attachLocalTrack(peer);
        await pc.setLocalDescription();
        this.sendDescription(peer);
      }
    } else if (data.candidate) {
      try {
        await pc.addIceCandidate(data.candidate);
      } catch (err) {
        if (!peer.ignoreOffer) throw err;
      }
    }
  }

  /**
   * ICE 'failed' restarts at once; 'disconnected' often heals by itself, so it restarts only
   * if it lasts ICE_DISCONNECTED_GRACE_MS. Recovering cancels a pending restart.
   */
  private onIceState(peer: Peer): void {
    if (this.peers.get(peer.userId) !== peer) return;
    const state = peer.pc.iceConnectionState;
    if (state === 'connected' || state === 'completed') {
      peer.restarting = false;
      this.watchRoute(peer);
    }
    const delay = iceRestartDelay(state);
    if (peer.restarting) return;
    this.clearRestartTimer(peer);
    if (delay === null) return;
    if (delay === 0) {
      void this.restartIce(peer);
      return;
    }
    peer.restartTimer = setTimeout(() => {
      peer.restartTimer = null;
      if (peer.pc.iceConnectionState === 'disconnected') void this.restartIce(peer);
    }, delay);
  }

  private clearRestartTimer(peer: Peer): void {
    if (peer.restartTimer) clearTimeout(peer.restartTimer);
    peer.restartTimer = null;
  }

  /**
   * restartIce() with perfect negotiation: it fires negotiationneeded and the normal
   * offer/answer path (with collision handling) carries the new ICE credentials.
   */
  private async restartIce(peer: Peer): Promise<void> {
    if (peer.restarting || this.peers.get(peer.userId) !== peer) return;
    peer.restarting = true;
    const attempt = ++peer.restartAttempt;
    this.clearRestartTimer(peer);
    if (iceNeedsRefresh(this.iceFetchedAt, this.iceTtl, Date.now())) {
      await this.refreshIce();
      // While we waited, the peer may have closed, ICE may have recovered by itself (which
      // clears `restarting`), or a newer attempt may have started: then don't restart.
      if (this.peers.get(peer.userId) !== peer) return;
      if (!peer.restarting || peer.restartAttempt !== attempt) return;
      const state = peer.pc.iceConnectionState;
      if (state === 'connected' || state === 'completed') {
        peer.restarting = false;
        return;
      }
      peer.pc.setConfiguration({ ...peer.pc.getConfiguration(), iceServers: this.iceServers });
    }
    peer.pc.restartIce();
    // Allow another attempt if this one has not reconnected by then.
    peer.restartTimer = setTimeout(() => {
      peer.restartTimer = null;
      peer.restarting = false;
      this.onIceState(peer);
    }, RESTART_RETRY_MS);
  }

  /**
   * Keep the route badge current: read it now, once more shortly after (the pair can still
   * switch), and on every selected-pair change where the browser exposes the ICE transport.
   */
  private watchRoute(peer: Peer): void {
    void this.updateRoute(peer);
    if (peer.routeTimer) clearTimeout(peer.routeTimer);
    peer.routeTimer = setTimeout(() => {
      peer.routeTimer = null;
      void this.updateRoute(peer);
    }, ROUTE_RECHECK_MS);
    const transport =
      peer.pc.getReceivers()[0]?.transport?.iceTransport ??
      peer.pc.getSenders()[0]?.transport?.iceTransport ??
      null;
    if (transport && transport !== peer.iceTransport) {
      if (peer.iceTransport) peer.iceTransport.onselectedcandidatepairchange = null;
      peer.iceTransport = transport;
      transport.onselectedcandidatepairchange = () => void this.updateRoute(peer);
    }
  }

  /** Record which candidate pair carries this peer's audio (badge: LAN / P2P / TURN). */
  private async updateRoute(peer: Peer): Promise<void> {
    if (this.peers.get(peer.userId) !== peer) return;
    try {
      const route = selectedRoute((await peer.pc.getStats()).values());
      if (this.peers.get(peer.userId) === peer) this.patchPeer(peer.userId, { route });
    } catch {
      // Stats unavailable (closed connection); keep the previous value.
    }
  }

  private sendDescription(peer: Peer): void {
    const d = peer.pc.localDescription;
    if (!d) return;
    this.sendSignal(peer.userId, { description: { type: d.type, sdp: d.sdp } });
  }

  private sendSignal(to: string, data: VoiceSignalData): void {
    if (!this.session?.joined) return;
    this.socket.emit('voice:signal', { to, data }, (res) => {
      if (!res.ok && res.error.code !== 'peer_not_in_voice') {
        console.warn('[voice] signal rejected:', res.error.code);
      }
    });
  }

  private closePeer(userId: string): void {
    const peer = this.peers.get(userId);
    if (!peer) return;
    this.peers.delete(userId);
    this.clearRestartTimer(peer);
    if (peer.routeTimer) clearTimeout(peer.routeTimer);
    peer.routeTimer = null;
    if (peer.iceTransport) peer.iceTransport.onselectedcandidatepairchange = null;
    peer.iceTransport = null;
    peer.pc.onicecandidate = null;
    peer.pc.onnegotiationneeded = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.oniceconnectionstatechange = null;
    peer.pc.ontrack = null;
    peer.pc.close();
    peer.meter?.dispose();
    peer.audio.pause();
    peer.audio.srcObject = null;
    peer.audio.remove();
    this.deps.setState((s) => {
      const peers = { ...s.peers };
      delete peers[userId];
      return { peers };
    });
  }

  private closeAllPeers(): void {
    for (const id of [...this.peers.keys()]) this.closePeer(id);
  }

  private patchPeer(userId: string, patch: Partial<PeerVoice>): void {
    this.deps.setState((s) => {
      const prev = s.peers[userId];
      if (!prev && !this.peers.has(userId)) return {};
      const base: PeerVoice = prev ?? {
        userId,
        connection: 'new',
        speaking: false,
        muted: true,
        volume: this.volumes.get(userId) ?? 1,
        route: null,
      };
      return { peers: { ...s.peers, [userId]: { ...base, ...patch } } };
    });
  }

  // ------------------------------------------------------------------ audio output

  private ensureAudioContext(): void {
    if (this.audioCtx || typeof AudioContext === 'undefined') return;
    try {
      this.audioCtx = new AudioContext();
    } catch {
      this.audioCtx = null;
    }
  }

  private ensureAudioContainer(): HTMLElement {
    if (!this.audioContainer) {
      const el = document.createElement('div');
      el.hidden = true;
      el.dataset.hexVoiceAudio = '';
      document.body.append(el);
      this.audioContainer = el;
    }
    return this.audioContainer;
  }

  private play(audio: HTMLAudioElement): void {
    audio.play().then(
      () => {
        if (this.audioBlocked) this.resumeAudio();
      },
      (err: unknown) => {
        if ((err as { name?: string }).name === 'NotAllowedError') this.setAudioBlocked(true);
      },
    );
  }

  private setAudioBlocked(blocked: boolean): void {
    if (this.audioBlocked === blocked) return;
    this.audioBlocked = blocked;
    this.deps.setState({ audioBlocked: blocked });
  }

  // ------------------------------------------------------------------ speaking detection

  private startSpeakingLoop(): void {
    if (this.speakingTimer || !this.audioCtx) return;
    this.speakingTimer = setInterval(() => this.sampleSpeaking(), SPEAKING_INTERVAL_MS);
  }

  private sampleSpeaking(): void {
    const now = performance.now();
    const changes: Record<string, boolean> = {};
    let self: boolean | null = null;

    if (this.localMeter) {
      const before = this.localMeter.tracker.speaking;
      const level = this.muted ? 0 : this.localMeter.level();
      this.localMeter.tracker = updateSpeaking(this.localMeter.tracker, level, now);
      if (this.localMeter.tracker.speaking !== before) self = this.localMeter.tracker.speaking;
    }
    for (const peer of this.peers.values()) {
      if (!peer.meter) continue;
      const before = peer.meter.tracker.speaking;
      const level = peer.muted ? 0 : peer.meter.level();
      peer.meter.tracker = updateSpeaking(peer.meter.tracker, level, now);
      if (peer.meter.tracker.speaking !== before)
        changes[peer.userId] = peer.meter.tracker.speaking;
    }

    if (self === null && Object.keys(changes).length === 0) return;
    this.deps.setState((s) => {
      const patch: Partial<VoiceState> = {};
      if (self !== null) patch.speaking = self;
      if (Object.keys(changes).length > 0) {
        const peers = { ...s.peers };
        for (const [id, speaking] of Object.entries(changes)) {
          const p = peers[id];
          if (p) peers[id] = { ...p, speaking };
        }
        patch.peers = peers;
      }
      return patch;
    });
  }
}
