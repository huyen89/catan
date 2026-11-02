import { describe, expect, it } from 'vitest';
import { getLegal } from './legal';
import { COSTS } from './resources';
import { give, inPhase, newGame, putBuilding } from './test/fixtures';

describe('getLegal', () => {
  it('setup: settlement vertices, then road edges for the actor only', () => {
    const s = newGame(4);
    const legal = getLegal(s, 0);
    expect(legal.actions).toEqual(['PLACE_SETTLEMENT']);
    expect(legal.settlementVertices).toHaveLength(54);
    expect(getLegal(s, 1).actions).toEqual([]);
    expect(getLegal(s, 1).settlementVertices).toEqual([]);
  });

  it('main: lists only affordable builds with a legal spot', () => {
    const s = inPhase(newGame(4), { kind: 'main' });
    expect(getLegal(s, 0).actions).toEqual(['END_TURN']);
    putBuilding(s, 0, '0,0,N');
    give(s, 0, { ...COSTS.city, wool: 1 });
    let legal = getLegal(s, 0);
    expect(legal.actions).toEqual(['BUILD_CITY', 'BUY_DEV', 'OFFER_TRADE', 'END_TURN']);
    expect(legal.canAfford).toEqual({ road: false, settlement: false, city: true, devCard: true });
    expect(legal.cityVertices).toEqual(['0,0,N']);
    expect(legal.roadEdges).toHaveLength(3);
    expect(legal.settlementVertices).toEqual([]);

    s.devDeck = [];
    s.players[0]!.citiesLeft = 0;
    legal = getLegal(s, 0);
    expect(legal.actions).toEqual(['OFFER_TRADE', 'END_TURN']);
    expect(legal.cityVertices).toEqual([]);
  });

  it('non-active players have nothing to do in main without offers', () => {
    const s = give(inPhase(newGame(4), { kind: 'main' }), 1, { ore: 4 });
    expect(getLegal(s, 1).actions).toEqual([]);
    expect(getLegal(s, 1).roadEdges).toEqual([]);
  });

  it('unknown seats get an empty summary', () => {
    expect(getLegal(newGame(4), 9).actions).toEqual([]);
  });

  it('year of plenty is not playable when the bank is empty', () => {
    const s = inPhase(newGame(4), { kind: 'main' });
    s.players[0]!.devCards = ['yearOfPlenty'];
    expect(getLegal(s, 0).playableDev).toEqual(['yearOfPlenty']);
    for (const r of ['brick', 'lumber', 'wool', 'grain', 'ore'] as const) {
      give(s, 1, { [r]: s.bank[r] });
    }
    expect(getLegal(s, 0).playableDev).toEqual([]);
    expect(getLegal(s, 0).actions).not.toContain('PLAY_YEAR_OF_PLENTY');
  });
});
