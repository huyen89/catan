import { describe, expect, it } from 'vitest';
import { getLegal } from '../legal';
import { give, inPhase, newGame, putBuilding } from '../test/fixtures';
import { expectOk, expectRejected } from '../test/expect';
import type { GameState, PortType } from '../types';

function withPort(type: PortType): { s: GameState; vertex: string } {
  const s = inPhase(newGame(4), { kind: 'main' });
  const port = s.board.ports.find((p) => p.type === type)!;
  putBuilding(s, 0, port.vertices[1]);
  return { s, vertex: port.vertices[1] };
}

describe('maritime trade (RULES.md#trading)', () => {
  it('4:1 by default', () => {
    const s = give(inPhase(newGame(4), { kind: 'main' }), 0, { brick: 4 });
    expect(getLegal(s, 0).maritimeRatios.brick).toBe(4);
    expect(getLegal(s, 0).actions).toContain('MARITIME_TRADE');
    const { state, events } = expectOk(s, 0, { type: 'MARITIME_TRADE', give: 'brick', get: 'ore' });
    expect(state.players[0]!.resources).toMatchObject({ brick: 0, ore: 1 });
    expect(state.bank).toMatchObject({ brick: 19, ore: 18 });
    expect(events).toEqual([
      { type: 'maritimeTrade', seat: 0, give: 'brick', giveCount: 4, get: 'ore' },
    ]);
  });

  it('3:1 with a generic port, 2:1 with a matching port', () => {
    const generic = withPort('any').s;
    expect(getLegal(generic, 0).maritimeRatios).toEqual({
      brick: 3,
      lumber: 3,
      wool: 3,
      grain: 3,
      ore: 3,
    });
    give(generic, 0, { wool: 3 });
    expect(
      expectOk(generic, 0, { type: 'MARITIME_TRADE', give: 'wool', get: 'ore' }).state.players[0]!
        .resources.wool,
    ).toBe(0);

    const special = withPort('grain').s;
    expect(getLegal(special, 0).maritimeRatios.grain).toBe(2);
    expect(getLegal(special, 0).maritimeRatios.ore).toBe(4);
    give(special, 0, { grain: 2, ore: 3 });
    expectOk(special, 0, { type: 'MARITIME_TRADE', give: 'grain', get: 'brick' });
    expectRejected(
      special,
      0,
      { type: 'MARITIME_TRADE', give: 'ore', get: 'brick' },
      'INSUFFICIENT_RESOURCES',
    );
  });

  it('rejects bad payloads, empty bank, wrong seat or phase', () => {
    const s = give(inPhase(newGame(4), { kind: 'main' }), 0, { brick: 4 });
    expectRejected(s, 0, { type: 'MARITIME_TRADE', give: 'brick', get: 'brick' }, 'INVALID_TRADE');
    expectRejected(
      s,
      0,
      { type: 'MARITIME_TRADE', give: 'x' as never, get: 'ore' },
      'INVALID_TRADE',
    );
    expectRejected(s, 1, { type: 'MARITIME_TRADE', give: 'brick', get: 'ore' }, 'NOT_YOUR_TURN');
    const empty = give(structuredClone(s), 1, { ore: 19 });
    expectRejected(empty, 0, { type: 'MARITIME_TRADE', give: 'brick', get: 'ore' }, 'BANK_EMPTY');
    const pre = inPhase(structuredClone(s), { kind: 'preRoll' });
    expectRejected(pre, 0, { type: 'MARITIME_TRADE', give: 'brick', get: 'ore' }, 'WRONG_PHASE');
    expect(
      getLegal(give(inPhase(newGame(4), { kind: 'main' }), 0, { brick: 3 }), 0).actions,
    ).not.toContain('MARITIME_TRADE');
  });
});
