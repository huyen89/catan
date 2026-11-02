import { describe, expect, it } from 'vitest';
import type { PlayerView } from '@hexhaven/engine';
import { createFakeEngine } from '../testing/fakeEngine';
import { fallbackActions } from './fallback';

const engine = createFakeEngine();
const baseView = (): PlayerView =>
  engine.toPlayerView(engine.createGame(engine.normalizeConfig({ players: 3 }), 's'), 1);

describe('fallbackActions', () => {
  it('rejects pending trades before ending the turn', () => {
    const v = baseView();
    v.turn = { ...v.turn, current: 1 };
    v.trades = [
      {
        id: 7,
        from: 0,
        give: { brick: 1, lumber: 0, wool: 0, grain: 0, ore: 0 },
        want: { brick: 0, lumber: 1, wool: 0, grain: 0, ore: 0 },
        to: null,
        responses: { '1': 'pending', '2': 'pending' },
        counterTo: null,
      },
    ];
    expect(fallbackActions(v, 1).slice(0, 2)).toEqual([
      { type: 'RESPOND_TRADE', offerId: 7, response: 'reject' },
      { type: 'END_TURN' },
    ]);
  });

  it('discards from the largest piles', () => {
    const v = baseView();
    v.phase = { kind: 'discard', pending: { '1': 4 } };
    v.players[1]!.resources = { brick: 5, lumber: 1, wool: 2, grain: 0, ore: 0 };
    expect(fallbackActions(v, 1)[0]).toEqual({
      type: 'DISCARD',
      resources: { brick: 4, lumber: 0, wool: 0, grain: 0, ore: 0 },
    });
  });

  it('always ends with generic last resorts', () => {
    const v = baseView();
    v.phase = { kind: 'preRoll' };
    expect(fallbackActions(v, 1).map((a) => a.type)).toEqual([
      'ROLL',
      'END_TURN',
      'PASS_SPECIAL_BUILD',
    ]);
  });
});
