import { describe, expect, it } from 'vitest';
import { resourcesOf, type TradeOffer } from '@hexhaven/engine';
import {
  acceptedSeats,
  adjustCount,
  counterDraft,
  discardLimits,
  discardReady,
  draftProblem,
  draftToAction,
  emptyDraft,
  maritimeGiveOptions,
  myResponse,
  offerRole,
  offersAwaitingMe,
  liveDraft,
  toggleRecipient,
  turnKey,
} from './trade';

const r = resourcesOf;
const hand = r({ brick: 2, lumber: 1, ore: 3 });

const offer: TradeOffer = {
  id: 7,
  from: 0,
  give: r({ brick: 1 }),
  want: r({ ore: 2 }),
  to: null,
  responses: { '1': 'accept', '2': 'pending', '3': 'accept' },
  counterTo: null,
};

describe('adjustCount', () => {
  it('clamps between 0 and max without mutating', () => {
    const c = r({ brick: 1 });
    expect(adjustCount(c, 'brick', -5).brick).toBe(0);
    expect(adjustCount(c, 'brick', 5, 2).brick).toBe(2);
    expect(adjustCount(c, 'ore', 1).ore).toBe(1);
    expect(c.brick).toBe(1);
  });
});

describe('draftProblem', () => {
  it('requires both sides', () => {
    expect(draftProblem(emptyDraft(), hand)).toMatch(/give/);
    expect(draftProblem({ ...emptyDraft(), give: r({ brick: 1 }) }, hand)).toMatch(/want/);
  });
  it('rejects the same resource on both sides', () => {
    expect(
      draftProblem({ ...emptyDraft(), give: r({ ore: 1 }), want: r({ ore: 1 }) }, hand),
    ).toMatch(/both sides/);
  });
  it('rejects giving more than the hand holds', () => {
    expect(
      draftProblem({ ...emptyDraft(), give: r({ brick: 3 }), want: r({ wool: 1 }) }, hand),
    ).toMatch(/don't have/);
    expect(
      draftProblem({ ...emptyDraft(), give: r({ brick: 1 }), want: r({ wool: 1 }) }, undefined),
    ).not.toBeNull();
  });
  it('rejects an empty recipient list', () => {
    expect(
      draftProblem({ ...emptyDraft(), give: r({ brick: 1 }), want: r({ wool: 1 }), to: [] }, hand),
    ).toMatch(/player/);
  });
  it('accepts a valid draft', () => {
    expect(
      draftProblem({ ...emptyDraft(), give: r({ brick: 2 }), want: r({ wool: 1 }) }, hand),
    ).toBeNull();
  });
});

describe('draftToAction', () => {
  it('builds OFFER_TRADE, sorting recipients and mapping [] to everyone', () => {
    const a = draftToAction({
      ...emptyDraft(),
      give: r({ brick: 1 }),
      want: r({ ore: 1 }),
      to: [3, 1],
    });
    expect(a).toEqual({
      type: 'OFFER_TRADE',
      give: r({ brick: 1 }),
      want: r({ ore: 1 }),
      to: [1, 3],
      counterTo: null,
    });
    expect(draftToAction({ ...emptyDraft(), to: [] }).to).toBeNull();
  });
});

describe('counter offers', () => {
  it('swaps sides and targets the offerer', () => {
    expect(counterDraft(offer)).toEqual({
      give: r({ ore: 2 }),
      want: r({ brick: 1 }),
      to: [0],
      counterTo: 7,
    });
  });
});

describe('offer helpers', () => {
  it('classifies the viewer relationship', () => {
    expect(offerRole(offer, 0)).toBe('mine');
    expect(offerRole(offer, 2)).toBe('toMe');
    expect(offerRole({ ...offer, responses: { '1': 'pending' } }, 2)).toBe('other');
    expect(offerRole(offer, null)).toBe('other');
  });
  it('lists accepters and my response', () => {
    expect(acceptedSeats(offer)).toEqual([1, 3]);
    expect(myResponse(offer, 2)).toBe('pending');
    expect(myResponse(offer, null)).toBeUndefined();
  });
  it('toggles recipients; empty or full selections collapse to everyone', () => {
    const others = [1, 2, 3];
    expect(toggleRecipient(null, 2, others)).toEqual([2]);
    expect(toggleRecipient([1, 3], 2, others)).toBeNull();
    expect(toggleRecipient([3], 1, others)).toEqual([1, 3]);
    expect(toggleRecipient([1], 1, others)).toBeNull();
  });
});

describe('liveDraft', () => {
  const turn = { number: 4, current: 0 };
  const counter = { ...counterDraft(offer) };
  it('keeps a draft composed this turn while its countered offer is open', () => {
    expect(liveDraft(counter, turnKey(turn), turn, [offer])).toBe(counter);
  });
  it('drops a counter-offer draft once the countered offer is gone', () => {
    expect(liveDraft(counter, turnKey(turn), turn, [])).toEqual(emptyDraft());
  });
  it('drops any draft when the turn changes', () => {
    const plain = { ...emptyDraft(), give: r({ brick: 1 }) };
    expect(liveDraft(plain, turnKey(turn), turn, [])).toBe(plain);
    expect(liveDraft(plain, turnKey(turn), { number: 5, current: 1 }, [])).toEqual(emptyDraft());
  });
});

describe('maritime and discard helpers', () => {
  it('offers only resources meeting the ratio', () => {
    const ratios = r({ brick: 2, lumber: 4, wool: 4, grain: 4, ore: 3 });
    expect(maritimeGiveOptions(hand, ratios)).toEqual(['brick', 'ore']);
    expect(maritimeGiveOptions(undefined, ratios)).toEqual([]);
  });
  it('requires an exact discard count from the hand', () => {
    expect(discardReady(r({ brick: 2 }), 2, hand)).toBe(true);
    expect(discardReady(r({ brick: 1 }), 2, hand)).toBe(false);
    expect(discardReady(r({ lumber: 2 }), 2, hand)).toBe(false);
    expect(discardReady(r({}), 0, hand)).toBe(false);
  });
  it('limits further picks to the remaining count', () => {
    const lim = discardLimits(r({ brick: 1 }), 2, hand);
    expect(lim).toEqual(r({ brick: 2, lumber: 1, ore: 1 }));
    expect(discardLimits(r({ brick: 2 }), 2, hand)).toEqual(r({ brick: 2 }));
  });
});

describe('offersAwaitingMe', () => {
  it('counts open offers where my answer is still pending', () => {
    expect(offersAwaitingMe([offer], 2)).toBe(1);
    expect(offersAwaitingMe([offer], 1)).toBe(0);
    expect(offersAwaitingMe([offer], 0)).toBe(0);
    expect(offersAwaitingMe([offer, { ...offer, id: 8 }], 2)).toBe(2);
    expect(offersAwaitingMe([offer], null)).toBe(0);
  });
});
