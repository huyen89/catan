import { describe, expect, it } from 'vitest';
import { graphFor, totalResources } from '@hexhaven/engine';
import { createDevGame, devPayload, devRoom } from './devGame';

describe('dev fixture', () => {
  for (const players of [3, 4, 5, 6]) {
    it(`builds a consistent demo position for ${players} players`, () => {
      const s = createDevGame(players, 'fixture', true);
      const g = graphFor(s.board);
      const owned = Object.entries(s.buildings);
      expect(owned.length).toBe(players * 2);
      // distance rule holds
      for (const [v] of owned)
        for (const n of g.vertexNeighbors[v]!) expect(s.buildings[n]).toBeUndefined();
      // every road is a real edge, and resources came out of the bank
      for (const e of Object.keys(s.roads)) expect(g.edgeVertices[e]).toBeDefined();
      const held = s.players.reduce((n, p) => n + totalResources(p.resources), 0);
      const bankStart = 5 * (players >= 5 ? 24 : 19);
      expect(totalResources(s.bank) + held).toBe(bankStart);
    });
  }

  it('redacts the view for the chosen seat and keeps seats aligned with the room', () => {
    const s = createDevGame(4, 'fixture', true);
    const p = devPayload(s, 1, true, [], 'g');
    expect(p.view.viewer).toBe(1);
    expect(p.view.players[0]!.resources).toBeUndefined();
    expect(p.view.players[1]!.resources).toBeDefined();
    expect(devRoom(4).seats).toHaveLength(4);
  });

  it('can start from a fresh setup position', () => {
    const s = createDevGame(3, 'fresh', false);
    expect(s.phase.kind).toBe('setup');
    expect(Object.keys(s.buildings)).toHaveLength(0);
  });
});
