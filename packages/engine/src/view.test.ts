import { describe, expect, it } from 'vitest';
import { finishSetup, give, inPhase, newGame } from './test/fixtures';
import { expectOk } from './test/expect';
import { redactEvent, toPlayerView } from './view';

describe('toPlayerView', () => {
  it("hides opponents' hands, dev cards, the rng and the deck order", () => {
    const s = inPhase(newGame(4), { kind: 'main' });
    give(s, 1, { ore: 3 });
    s.players[1]!.devCards = ['monopoly'];
    s.players[0]!.devCards = ['knight'];
    const v = toPlayerView(s, 0);
    expect(v.players[0]!.devCards).toEqual(['knight']);
    expect(v.players[1]!.resources).toBeUndefined();
    expect(v.players[1]!.devCards).toBeUndefined();
    expect(v.players[1]!.totalVP).toBeUndefined();
    expect(v.players[1]!.resourceCount).toBe(3);
    expect(v.players[1]!.devCardCount).toBe(1);
    const json = JSON.stringify(v);
    expect(json).not.toContain('"rng"');
    expect(json).not.toContain('"devDeck":');
    expect(json).not.toContain('monopoly');
    expect(toPlayerView(s, null).legal).toBeNull();
  });

  it('reveals everything at game over', () => {
    const s = inPhase(newGame(4), { kind: 'gameOver', winner: 1 });
    s.players[2]!.devCards = ['victoryPoint'];
    const v = toPlayerView(s, 0);
    expect(v.players[2]!.devCards).toEqual(['victoryPoint']);
    expect(v.players[2]!.totalVP).toBe(1);
    expect(v.players[2]!.publicVP).toBe(0);
    expect(v.legal).toBeNull();
  });

  it('returns deep copies: mutating a view never touches the GameState', () => {
    let s = finishSetup(newGame(4));
    s = inPhase(s, { kind: 'main' });
    give(s, 0, { brick: 1 });
    s = expectOk(s, 0, {
      type: 'OFFER_TRADE',
      give: { brick: 1, lumber: 0, wool: 0, grain: 0, ore: 0 },
      want: { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 1 },
      to: null,
      counterTo: null,
    }).state;
    const before = structuredClone(s);
    const v = toPlayerView(s, 0);
    v.board.hexes[0]!.token = 99;
    v.board.ports[0]!.vertices[0] = 'x';
    Object.values(v.buildings)[0]!.owner = 3;
    v.roads['x'] = 1;
    v.setupOrder.push(9);
    v.turn.current = 3;
    (v.phase as { kind: string }).kind = 'gameOver';
    v.trades[0]!.responses['1'] = 'accept';
    v.trades[0]!.give.brick = 5;
    v.config.vpToWin = 1;
    v.players[0]!.resources!.ore = 9;
    v.bank.ore = 0;
    expect(s).toEqual(before);
  });

  it('redacts stolen resources and bought cards for third parties', () => {
    const stole = { type: 'stole', thief: 0, victim: 1, resource: 'ore' } as const;
    expect(redactEvent(stole, 0)).toEqual(stole);
    expect(redactEvent(stole, 1)).toEqual(stole);
    expect(redactEvent(stole, 2)).toEqual({ ...stole, resource: null });
    const bought = { type: 'boughtDev', seat: 2, card: 'knight' } as const;
    expect(redactEvent(bought, 2)).toEqual(bought);
    expect(redactEvent(bought, null)).toEqual({ ...bought, card: null });
  });
});
