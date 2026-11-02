import { describe, expect, it } from 'vitest';
import { resourcesOf, type GameEvent } from '@hexhaven/engine';
import { eventSeat, eventText, type EventTextContext } from './eventText';

const names = ['Alice', 'Bruno', 'Chen', 'Dana'];
const ctx: EventTextContext = {
  name: (s) => names[s] ?? `P${s}`,
  hexLabel: (id) => (id === '0,0' ? 'Forest (8)' : id),
};
const r = resourcesOf;

const cases: Array<[GameEvent, string]> = [
  [{ type: 'setupPlaced', seat: 0, kind: 'settlement', at: '0,0,N' }, 'Alice placed a settlement'],
  [
    { type: 'setupResources', seat: 1, resources: r({ ore: 1, wool: 2 }) },
    'Bruno received 2 wool, 1 ore',
  ],
  [{ type: 'setupResources', seat: 1, resources: r({}) }, 'Bruno received no starting resources'],
  [{ type: 'rolled', seat: 2, dice: [3, 4], total: 7 }, 'Chen rolled 3 + 4 = 7'],
  [
    { type: 'produced', gains: { '0': r({ grain: 2 }), '1': r({}), '3': r({ ore: 1 }) } },
    'Alice got 2 grain; Dana got 1 ore',
  ],
  [{ type: 'produced', gains: {} }, 'Nobody produced anything'],
  [
    { type: 'discardRequired', pending: { '0': 4, '2': 0, '3': 5 } },
    'Must discard: Alice (4), Dana (5)',
  ],
  [
    { type: 'discarded', seat: 0, resources: r({ brick: 2, wool: 2 }) },
    'Alice discarded 4 cards (2 brick, 2 wool)',
  ],
  [{ type: 'robberMoved', seat: 1, hex: '0,0' }, 'Bruno moved the robber to Forest (8)'],
  [{ type: 'stole', thief: 1, victim: 0, resource: null }, 'Bruno stole a card from Alice'],
  [{ type: 'stole', thief: 1, victim: 0, resource: 'ore' }, 'Bruno stole 1 ore from Alice'],
  [{ type: 'built', seat: 3, kind: 'city', at: '0,0,S' }, 'Dana built a city'],
  [{ type: 'boughtDev', seat: 0, card: null }, 'Alice bought a development card'],
  [{ type: 'boughtDev', seat: 0, card: 'monopoly' }, 'Alice bought a development card (Monopoly)'],
  [{ type: 'playedDev', seat: 0, card: 'yearOfPlenty' }, 'Alice played Year of Plenty'],
  [
    { type: 'monopoly', seat: 2, resource: 'grain', taken: { '0': 2, '1': 3 } },
    'Chen claimed 5 grain with Monopoly',
  ],
  [{ type: 'yearOfPlenty', seat: 0, resources: ['ore', 'ore'] }, 'Alice took 2 ore from the bank'],
  [
    { type: 'yearOfPlenty', seat: 0, resources: ['ore', 'wool'] },
    'Alice took 1 ore and 1 wool from the bank',
  ],
  [
    { type: 'maritimeTrade', seat: 0, give: 'brick', giveCount: 3, get: 'ore' },
    'Alice traded 3 brick with the bank for 1 ore',
  ],
  [
    {
      type: 'tradeOffered',
      offer: {
        id: 4,
        from: 0,
        give: r({ lumber: 1 }),
        want: r({ ore: 1 }),
        to: [1, 3],
        responses: { '1': 'pending', '3': 'pending' },
        counterTo: null,
      },
    },
    'Alice offers 1 lumber for 1 ore to Bruno, Dana',
  ],
  [
    {
      type: 'tradeOffered',
      offer: {
        id: 5,
        from: 1,
        give: r({ ore: 1 }),
        want: r({ lumber: 2 }),
        to: [0],
        responses: { '0': 'pending' },
        counterTo: 4,
      },
    },
    'Bruno counters with 1 ore for 2 lumber to Alice',
  ],
  [
    { type: 'tradeResponded', offerId: 4, seat: 1, response: 'accept' },
    'Bruno accepted trade offer #4',
  ],
  [
    { type: 'traded', offerId: 4, a: 0, b: 1, aGave: r({ lumber: 1 }), bGave: r({ ore: 1 }) },
    'Alice traded 1 lumber to Bruno for 1 ore',
  ],
  [{ type: 'tradeCancelled', offerId: 4 }, 'Trade offer #4 was withdrawn'],
  [{ type: 'awardChanged', award: 'longestRoad', holder: 2 }, 'Chen now holds Longest Road'],
  [{ type: 'awardChanged', award: 'largestArmy', holder: null }, 'Nobody holds Largest Army now'],
  [{ type: 'turnStarted', seat: 3, turn: 12 }, 'Turn 12: Dana'],
  [{ type: 'specialBuildTurn', seat: 2 }, 'Chen may build (special build phase)'],
  [{ type: 'gameOver', winner: 1, vp: [7, 10, 4, 5] }, 'Bruno wins with 10 points!'],
];

describe('eventText', () => {
  it.each(cases)('%j', (event, text) => {
    expect(eventText(event, ctx)).toBe(text);
  });

  it('covers every GameEvent type', () => {
    const types = new Set(cases.map(([e]) => e.type));
    expect(types.size).toBe(22);
  });

  it('picks the acting seat for colouring', () => {
    expect(eventSeat({ type: 'stole', thief: 2, victim: 0, resource: null })).toBe(2);
    expect(eventSeat({ type: 'tradeCancelled', offerId: 1 })).toBeNull();
    expect(eventSeat({ type: 'produced', gains: {} })).toBeNull();
  });
});
