import { describe, expect, it } from 'vitest';
import { finishSetup, give, inPhase, newGame, playRandomGame } from './test/fixtures';
import { expectOk } from './test/expect';
import { lateGameState } from './test/lateGame';
import type { GameEvent, GameState, Seat } from './types';
import {
  EVENT_VISIBILITY,
  PLAYER_VISIBILITY,
  STATE_VISIBILITY,
  redactEvent,
  toPlayerView,
} from './view';

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

describe('redaction audit', () => {
  /** Fresh, mid/late and finished states for 4 and 6 players. */
  function sampleStates(): GameState[] {
    const out: GameState[] = [];
    for (const players of [4, 6]) {
      const game = playRandomGame(`audit-${players}`, players, 2000);
      out.push(game.initial, game.state);
    }
    out.push(lateGameState(5, 'ext56'));
    return out;
  }

  /** Every field of PlayerView. A new one is a new leak surface and must be added deliberately. */
  const PLAYER_VIEW_KEYS = [
    'viewer',
    'version',
    'config',
    'board',
    'robber',
    'buildings',
    'roads',
    'players',
    'bank',
    'devDeckCount',
    'setupOrder',
    'turn',
    'phase',
    'trades',
    'longestRoad',
    'largestArmy',
    'winner',
    'pendingActors',
    'legal',
  ];

  it('every GameState and PlayerState key is classified in view.ts', () => {
    for (const s of sampleStates()) {
      expect(Object.keys(s).sort()).toEqual(Object.keys(STATE_VISIBILITY).sort());
      for (const p of s.players) {
        expect(Object.keys(p).sort()).toEqual(Object.keys(PLAYER_VISIBILITY).sort());
      }
    }
  });

  it('public fields are copied, private fields never appear, owner fields only for the owner', () => {
    for (const s of sampleStates()) {
      const over = s.phase.kind === 'gameOver';
      for (const viewer of [null, ...s.players.map((p) => p.seat)]) {
        const v = toPlayerView(s, viewer);
        expect(Object.keys(v).sort()).toEqual([...PLAYER_VIEW_KEYS].sort());
        const viewRec = v as unknown as Record<string, unknown>;
        for (const [key, cls] of Object.entries(STATE_VISIBILITY)) {
          if (cls === 'public') expect(viewRec[key], key).toEqual(s[key as keyof GameState]);
          if (cls === 'private') expect(Object.keys(v), key).not.toContain(key);
        }
        expect(v.devDeckCount).toBe(s.devDeck.length);
        const json = JSON.stringify(v);
        for (const k of ['rng', 'devDeck', 'nextTradeId', 'engineVersion']) {
          expect(json).not.toContain(`"${k}"`);
        }
        for (const p of v.players) {
          const real = s.players[p.seat]! as unknown as Record<string, unknown>;
          const pub = p as unknown as Record<string, unknown>;
          for (const [k, cls] of Object.entries(PLAYER_VISIBILITY)) {
            if (cls === 'public' || over || p.seat === viewer) {
              expect(pub[k], `seat ${p.seat} ${k}`).toEqual(real[k]);
            } else {
              expect(Object.keys(p), `seat ${p.seat} ${k} for ${viewer}`).not.toContain(k);
            }
          }
          if (!over && p.seat !== viewer) expect(Object.keys(p)).not.toContain('totalVP');
        }
      }
    }
  });

  it('every emitted event type is classified; redacted ones differ for third parties', () => {
    const seen = new Set<string>();
    for (const players of [3, 4, 5, 6]) {
      for (const seed of ['a', 'b']) {
        const game = playRandomGame(`events-${seed}`, players, 3000);
        for (const e of game.events) {
          seen.add(e.type);
          expect(Object.keys(EVENT_VISIBILITY), e.type).toContain(e.type);
          const parties: Seat[] =
            e.type === 'stole' ? [e.thief, e.victim] : e.type === 'boughtDev' ? [e.seat] : [];
          for (const viewer of [null, ...Array.from({ length: players }, (_, i) => i)]) {
            const r = redactEvent(e, viewer);
            if (EVENT_VISIBILITY[e.type] === 'public' || parties.includes(viewer as Seat)) {
              expect(r).toEqual(e);
            } else {
              expect(r, `${e.type} for ${viewer}`).not.toEqual(e);
            }
          }
        }
      }
    }
    // Random play reaches the redacted kinds, so the checks above actually ran on them.
    expect(seen).toContain('stole');
    expect(seen).toContain('boughtDev');
  });

  it('an event type without a redaction rule is hidden entirely (fail closed)', () => {
    const unknown = { type: 'secretThing', seat: 0 } as unknown as GameEvent;
    expect(redactEvent(unknown, 0)).toBeNull();
  });
});
