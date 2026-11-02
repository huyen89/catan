import { describe, expect, it } from 'vitest';
import { resourcesOf, type GameEvent, type PlayerView, type TradeOffer } from '@hexhaven/engine';
import { mustAct, soundsFor } from './events';

type View = Pick<PlayerView, 'viewer' | 'turn' | 'phase' | 'pendingActors'>;

const view = (patch: Partial<View> = {}): View => ({
  viewer: 1,
  turn: { current: 0, number: 3, dice: null, devPlayed: false },
  phase: { kind: 'main' },
  pendingActors: [0],
  ...patch,
});

const snap = (version: number, v: View = view(), gameId = 'g1') => ({ gameId, version, view: v });
const next = (version: number, events: GameEvent[], v: View = view(), gameId = 'g1') => ({
  ...snap(version, v, gameId),
  events,
});

const offer = (patch: Partial<TradeOffer> = {}): TradeOffer => ({
  id: 1,
  from: 0,
  give: resourcesOf({ brick: 1 }),
  want: resourcesOf({ ore: 1 }),
  to: null,
  responses: { '1': 'pending', '2': 'pending' },
  counterTo: null,
  ...patch,
});

describe('soundsFor', () => {
  it('maps game events to cues, once each, in a fixed order', () => {
    const events: GameEvent[] = [
      { type: 'built', seat: 0, kind: 'road', at: 'e1' },
      { type: 'rolled', seat: 0, dice: [3, 4], total: 7 },
      { type: 'robberMoved', seat: 0, hex: 'h1' },
      { type: 'stole', thief: 0, victim: 1, resource: 'ore' },
      { type: 'built', seat: 0, kind: 'city', at: 'v1' },
    ];
    expect(soundsFor(snap(4), next(5, events))).toEqual(['dice', 'robber', 'build']);
    expect(soundsFor(snap(4), next(5, [{ type: 'gameOver', winner: 0, vp: [10, 3, 2] }]))).toEqual([
      'gameOver',
    ]);
    expect(
      soundsFor(snap(4), next(5, [{ type: 'setupPlaced', seat: 0, kind: 'road', at: 'e' }])),
    ).toEqual(['build']);
  });

  it('plays the trade cue only for offers that ask me', () => {
    const offered = (o: TradeOffer): GameEvent[] => [{ type: 'tradeOffered', offer: o }];
    expect(soundsFor(snap(1), next(2, offered(offer())))).toEqual(['trade']);
    expect(soundsFor(snap(1), next(2, offered(offer({ responses: { '2': 'pending' } }))))).toEqual(
      [],
    );
    // My own offer: no cue.
    expect(soundsFor(snap(1), next(2, offered(offer({ from: 1 }))))).toEqual([]);
    // Spectators never get it.
    const spectator = view({ viewer: null });
    expect(soundsFor(snap(1, spectator), next(2, offered(offer()), spectator))).toEqual([]);
  });

  it('chimes when it becomes my move, not while it stays mine', () => {
    const mine = view({ turn: { current: 1, number: 4, dice: null, devPlayed: false } });
    const started: GameEvent[] = [{ type: 'turnStarted', seat: 1, turn: 4 }];
    expect(soundsFor(snap(7), next(8, started, mine))).toEqual(['yourTurn']);
    expect(soundsFor(snap(8, mine), next(9, [], mine))).toEqual([]);
    // Being asked to answer a trade is not "my move".
    const asked = view({ pendingActors: [0, 1] });
    expect(soundsFor(snap(7), next(8, [], asked))).toEqual([]);
    // Having to discard after someone else's 7 is.
    const discard = view({ phase: { kind: 'discard', pending: { '1': 4 } }, pendingActors: [1] });
    expect(
      soundsFor(snap(7), next(8, [{ type: 'rolled', seat: 0, dice: [3, 4], total: 7 }], discard)),
    ).toEqual(['dice', 'yourTurn']);
  });

  it('stays silent for history: first state, resyncs, repeats and other games', () => {
    const rolled: GameEvent[] = [{ type: 'rolled', seat: 0, dice: [1, 2], total: 3 }];
    expect(soundsFor(null, next(5, rolled))).toEqual([]);
    expect(soundsFor(snap(5), next(5, rolled))).toEqual([]);
    expect(soundsFor(snap(5), next(9, rolled))).toEqual([]);
    expect(soundsFor(snap(5), next(4, rolled))).toEqual([]);
    expect(soundsFor(snap(0, view(), 'old'), next(1, rolled))).toEqual([]);
  });
});

describe('mustAct', () => {
  it('follows the phase', () => {
    expect(
      mustAct(
        view({
          phase: { kind: 'setup', index: 2, step: 'road', lastSettlement: null },
          pendingActors: [1],
        }),
        1,
      ),
    ).toBe(true);
    expect(mustAct(view({ phase: { kind: 'specialBuild', seat: 1, queue: [] } }), 1)).toBe(true);
    expect(mustAct(view({ phase: { kind: 'specialBuild', seat: 2, queue: [1] } }), 1)).toBe(false);
    expect(mustAct(view({ phase: { kind: 'gameOver', winner: 1 } }), 1)).toBe(false);
    expect(mustAct(view({ phase: { kind: 'preRoll' } }), 0)).toBe(true);
    expect(mustAct(view(), null)).toBe(false);
  });
});
