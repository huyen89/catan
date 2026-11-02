import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SPEAKING,
  FALLBACK_ICE_SERVERS,
  SILENT,
  ICE_DISCONNECTED_GRACE_MS,
  candidateInfo,
  clampVolume,
  hasTurnServer,
  iceNeedsRefresh,
  iceRestartDelay,
  iceTestVerdict,
  mutedFromAck,
  routeDescription,
  routeKind,
  selectedRoute,
  summarizeIceTest,
  isPolite,
  joinErrorMessage,
  micErrorMessage,
  parseIceResponse,
  rms,
  updateSpeaking,
  type SpeakingTracker,
} from './logic';

describe('isPolite', () => {
  it('makes exactly one side of every pair polite', () => {
    const ids = ['alice', 'bob', 'u_1', 'u_10', 'U_2'];
    for (const a of ids) {
      for (const b of ids) {
        if (a === b) continue;
        expect(isPolite(a, b)).not.toBe(isPolite(b, a));
      }
    }
    expect(isPolite('a', 'b')).toBe(true);
  });
});

describe('updateSpeaking (hysteresis)', () => {
  const run = (levels: number[], stepMs = 100): boolean[] => {
    let t: SpeakingTracker = SILENT;
    return levels.map((level, i) => {
      t = updateSpeaking(t, level, i * stepMs);
      return t.speaking;
    });
  };

  it('needs the on-threshold to start', () => {
    expect(run([0.02, 0.025, 0.029])).toEqual([false, false, false]);
    expect(run([0.01, 0.05])).toEqual([false, true]);
  });

  it('stays on while above the off-threshold (no flicker between on and off levels)', () => {
    expect(run([0.05, 0.02, 0.016, 0.02, 0.025])).toEqual([true, true, true, true, true]);
  });

  it('holds briefly after going quiet, then switches off', () => {
    // hold 400ms: loud at t=0, quiet from t=100, off once 400ms have passed
    expect(run([0.05, 0, 0, 0, 0, 0])).toEqual([true, true, true, true, false, false]);
  });

  it('respects a custom config', () => {
    const cfg = { ...DEFAULT_SPEAKING, onLevel: 0.5, holdMs: 0 };
    let t = updateSpeaking(SILENT, 0.4, 0, cfg);
    expect(t.speaking).toBe(false);
    t = updateSpeaking(t, 0.6, 1, cfg);
    t = updateSpeaking(t, 0, 2, cfg);
    expect(t.speaking).toBe(false);
  });
});

describe('rms', () => {
  it('computes root mean square', () => {
    expect(rms([])).toBe(0);
    expect(rms(new Float32Array([0, 0, 0]))).toBe(0);
    expect(rms([1, -1, 1, -1])).toBe(1);
    expect(rms([0.5, -0.5])).toBeCloseTo(0.5);
  });
});

describe('clampVolume', () => {
  it('clamps to 0..1 and defaults junk to 1', () => {
    expect(clampVolume(-1)).toBe(0);
    expect(clampVolume(0.3)).toBe(0.3);
    expect(clampVolume(7)).toBe(1);
    expect(clampVolume(Number.NaN)).toBe(1);
  });
});

describe('parseIceResponse', () => {
  it('keeps valid servers and ttl', () => {
    expect(
      parseIceResponse({
        iceServers: [
          { urls: 'stun:stun.cloudflare.com:3478' },
          { urls: ['turn:t:3478?transport=udp'], username: 'u', credential: 'c', extra: 1 },
        ],
        ttl: 600,
      }),
    ).toEqual({
      iceServers: [
        { urls: 'stun:stun.cloudflare.com:3478' },
        { urls: ['turn:t:3478?transport=udp'], username: 'u', credential: 'c' },
      ],
      ttl: 600,
    });
  });

  it('drops malformed entries and falls back to STUN when nothing is usable', () => {
    expect(
      parseIceResponse({ iceServers: [null, { urls: '' }, { urls: [1] }, { urls: [] }] }),
    ).toEqual({ iceServers: FALLBACK_ICE_SERVERS, ttl: 3600 });
    expect(parseIceResponse('nope').iceServers).toBe(FALLBACK_ICE_SERVERS);
    expect(parseIceResponse(null).iceServers).toBe(FALLBACK_ICE_SERVERS);
  });

  it('defaults a bad ttl', () => {
    expect(parseIceResponse({ iceServers: [{ urls: 'stun:x' }], ttl: -5 }).ttl).toBe(3600);
  });
});

describe('iceNeedsRefresh', () => {
  it('refreshes after half the TTL', () => {
    expect(iceNeedsRefresh(0, 100, 49_000)).toBe(false);
    expect(iceNeedsRefresh(0, 100, 51_000)).toBe(true);
  });
});

describe('error messages', () => {
  it('explains mic failures', () => {
    expect(micErrorMessage({ name: 'NotAllowedError' })).toMatch(/blocked/);
    expect(micErrorMessage({ name: 'NotFoundError' })).toMatch(/No microphone/);
    expect(micErrorMessage({ name: 'NotReadableError' })).toMatch(/busy/);
    expect(micErrorMessage({ name: 'InsecureContext' })).toMatch(/https/);
    expect(micErrorMessage(new Error('x'))).toMatch(/Could not start/);
    expect(micErrorMessage(undefined)).toMatch(/Could not start/);
  });

  it('explains join failures', () => {
    expect(joinErrorMessage('not_in_room')).toMatch(/room/);
    expect(joinErrorMessage('timeout')).toMatch(/did not answer/);
    expect(joinErrorMessage('voice_full')).toMatch(/full/);
    expect(joinErrorMessage(undefined)).toBe('Could not join voice.');
  });
});

describe('mutedFromAck', () => {
  it('maps peers to their mic state', () => {
    const m = mutedFromAck([
      { userId: 'a', muted: false },
      { userId: 'b', muted: true },
    ]);
    expect([...m]).toEqual([
      ['a', false],
      ['b', true],
    ]);
    expect(mutedFromAck([]).size).toBe(0);
  });
});

describe('iceRestartDelay', () => {
  it('restarts at once on failure, after a grace period on disconnect, else cancels', () => {
    expect(iceRestartDelay('failed')).toBe(0);
    expect(iceRestartDelay('disconnected')).toBe(ICE_DISCONNECTED_GRACE_MS);
    expect(ICE_DISCONNECTED_GRACE_MS).toBe(5000);
    for (const s of ['new', 'checking', 'connected', 'completed', 'closed'] as const) {
      expect(iceRestartDelay(s)).toBeNull();
    }
  });
});

const HOST = 'candidate:1 1 udp 2122260223 192.168.1.20 54400 typ host generation 0';
const SRFLX =
  'candidate:2 1 udp 1686052607 203.0.113.7 54400 typ srflx raddr 192.168.1.20 rport 54400';
const RELAY = 'candidate:3 1 udp 41885439 198.51.100.9 61000 typ relay raddr 203.0.113.7 rport 1';

describe('candidateInfo', () => {
  it('reads the type from fields or the SDP line', () => {
    expect(candidateInfo({ candidate: HOST })).toEqual({ type: 'host', relayProtocol: null });
    expect(candidateInfo({ candidate: SRFLX, type: null })).toEqual({
      type: 'srflx',
      relayProtocol: null,
    });
    expect(candidateInfo({ candidateType: 'prflx' }).type).toBe('prflx');
    expect(candidateInfo({ candidate: 'garbage' }).type).toBeNull();
    expect(candidateInfo({ type: 'weird' }).type).toBeNull();
  });

  it('finds the relay transport from relayProtocol or the TURN url', () => {
    expect(candidateInfo({ candidate: RELAY, relayProtocol: 'TCP' }).relayProtocol).toBe('tcp');
    expect(
      candidateInfo({ type: 'relay', url: 'turns:turn.example.com:5349?transport=tcp' })
        .relayProtocol,
    ).toBe('tls');
    expect(
      candidateInfo({ type: 'relay', url: 'turn:turn.example.com:3478?transport=udp' })
        .relayProtocol,
    ).toBe('udp');
    expect(candidateInfo({ candidate: RELAY }).relayProtocol).toBeNull();
    // Non-relay candidates never report a relay transport.
    expect(candidateInfo({ candidate: HOST, relayProtocol: 'udp' }).relayProtocol).toBeNull();
  });
});

describe('connection self-test', () => {
  const turn: RTCIceServer[] = [
    { urls: 'stun:stun.example.com:3478' },
    { urls: ['turn:t.example.com:3478?transport=udp'], username: 'u', credential: 'c' },
  ];

  it('detects TURN servers', () => {
    expect(hasTurnServer(turn)).toBe(true);
    expect(hasTurnServer([{ urls: 'turns:t.example.com:5349' }])).toBe(true);
    expect(hasTurnServer(FALLBACK_ICE_SERVERS)).toBe(false);
  });

  it('summarizes gathered candidates', () => {
    const r = summarizeIceTest({
      iceFetched: true,
      iceServers: turn,
      candidates: [
        { candidate: HOST },
        { candidate: SRFLX },
        { candidate: RELAY, relayProtocol: 'udp' },
        { candidate: RELAY, url: 'turns:t.example.com:5349?transport=tcp' },
      ],
      ms: 812.4,
    });
    expect(r).toEqual({
      iceFetched: true,
      turnConfigured: true,
      stun: true,
      relay: { udp: true, tcp: false, tls: true, unknown: false },
      ms: 812,
    });
    expect(iceTestVerdict(r).level).toBe('ok');
  });

  it('counts relays of unknown transport', () => {
    const r = summarizeIceTest({
      iceFetched: true,
      iceServers: turn,
      candidates: [{ candidate: RELAY }],
      ms: -3,
    });
    expect(r.relay).toEqual({ udp: false, tcp: false, tls: false, unknown: true });
    expect(r.stun).toBe(false);
    expect(r.ms).toBe(0);
    expect(iceTestVerdict(r).level).toBe('ok');
  });

  it('warns when only STUN works and explains why', () => {
    const base = { candidates: [{ candidate: HOST }, { candidate: SRFLX }], ms: 100 };
    const noTurn = summarizeIceTest({
      ...base,
      iceFetched: true,
      iceServers: FALLBACK_ICE_SERVERS,
    });
    expect(iceTestVerdict(noTurn)).toEqual({
      level: 'warn',
      message: expect.stringMatching(/No relay \(TURN\) server is configured.*mobile data/),
    });
    const deadTurn = summarizeIceTest({ ...base, iceFetched: true, iceServers: turn });
    expect(iceTestVerdict(deadTurn).message).toMatch(/did not answer/);
    const noFetch = summarizeIceTest({
      ...base,
      iceFetched: false,
      iceServers: FALLBACK_ICE_SERVERS,
    });
    expect(iceTestVerdict(noFetch).message).toMatch(/Could not get voice server details/);
  });

  it('errors when nothing but host candidates came back', () => {
    const r = summarizeIceTest({
      iceFetched: true,
      iceServers: turn,
      candidates: [{ candidate: HOST }],
      ms: 5000,
    });
    expect(iceTestVerdict(r)).toEqual({
      level: 'error',
      message: expect.stringMatching(/firewall/),
    });
  });
});

describe('selectedRoute', () => {
  const local = (id: string, candidateType: string, relayProtocol?: string) => ({
    id,
    type: 'local-candidate',
    candidateType,
    relayProtocol,
  });
  const remote = (id: string, candidateType: string) => ({
    id,
    type: 'remote-candidate',
    candidateType,
  });
  const pair = (id: string, l: string, r: string, extra: Record<string, unknown> = {}) => ({
    id,
    type: 'candidate-pair',
    localCandidateId: l,
    remoteCandidateId: r,
    ...extra,
  });

  it("follows the transport's selectedCandidatePairId", () => {
    const stats = [
      local('L1', 'host'),
      local('L2', 'relay', 'tcp'),
      remote('R1', 'srflx'),
      pair('P1', 'L1', 'R1', { nominated: true, state: 'succeeded' }),
      pair('P2', 'L2', 'R1', { nominated: true, state: 'succeeded' }),
      { id: 'T', type: 'transport', selectedCandidatePairId: 'P2' },
    ];
    const route = selectedRoute(stats);
    expect(route).toEqual({ local: 'relay', remote: 'srflx', relayProtocol: 'tcp' });
    expect(routeKind(route!)).toBe('relay');
    expect(routeDescription(route!)).toBe(
      'Relayed through the TURN server over TCP (relay → srflx)',
    );
  });

  it('falls back to a selected pair, then a nominated succeeded pair', () => {
    const base = [local('L1', 'host'), remote('R1', 'host'), remote('R2', 'srflx')];
    expect(
      selectedRoute([
        ...base,
        pair('P1', 'L1', 'R1', { nominated: true, state: 'succeeded' }),
        pair('P2', 'L1', 'R2', { selected: true }),
      ]),
    ).toEqual({ local: 'host', remote: 'srflx', relayProtocol: null });
    const route = selectedRoute([
      ...base,
      pair('P1', 'L1', 'R2', { nominated: true, state: 'in-progress' }),
      pair('P2', 'L1', 'R1', { nominated: true, state: 'succeeded' }),
    ]);
    expect(route).toEqual({ local: 'host', remote: 'host', relayProtocol: null });
    expect(routeKind(route!)).toBe('host');
    expect(routeKind({ local: 'prflx', remote: 'host', relayProtocol: null })).toBe('srflx');
  });

  it('returns null without a usable pair', () => {
    expect(selectedRoute([])).toBeNull();
    expect(selectedRoute([pair('P1', 'L1', 'R1', { nominated: true, state: 'succeeded' })])).toBe(
      null,
    );
    expect(
      selectedRoute([
        local('L1', 'host'),
        remote('R1', 'host'),
        pair('P1', 'L1', 'R1', { state: 'failed' }),
      ]),
    ).toBeNull();
  });
});
