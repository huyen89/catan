import { describe, expect, it } from 'vitest';
import {
  createGame,
  normalizeConfig,
  resourcesOf,
  toPlayerView,
  type LegalSummary,
  type Phase,
  type PlayerView,
} from '@hexhaven/engine';
import { computeHighlights, sanitizeMode } from './highlights';
import { canStart, effectiveVariant, parseBoundedInt } from './lobby';
import { phasePrompt } from './prompt';

const names = ['Alice', 'Bruno', 'Chen'];
const name = (s: number) => names[s]!;
const base = toPlayerView(createGame(normalizeConfig({ players: 3 }), 'prompt'), 0);

function view(phase: Phase, viewer: number | null, current = 0, extra: Partial<PlayerView> = {}) {
  return { ...base, phase, viewer, turn: { ...base.turn, current }, ...extra } as PlayerView;
}

describe('phasePrompt', () => {
  it('setup', () => {
    const p: Phase = { kind: 'setup', index: 0, step: 'settlement', lastSettlement: null };
    expect(phasePrompt(view(p, 0), name)).toEqual({ text: 'Place a settlement', tone: 'act' });
    expect(phasePrompt(view(p, 1), name).text).toBe('Waiting for Alice to place a settlement…');
    // snake order: index 4 of [0,1,2,2,1,0] is seat 1
    const p2: Phase = { kind: 'setup', index: 4, step: 'road', lastSettlement: '0,0,N' };
    expect(phasePrompt(view(p2, 1), name).text).toMatch(/Place a road/);
  });

  it('discard lists everyone still discarding', () => {
    const p: Phase = { kind: 'discard', pending: { '0': 4, '1': 0, '2': 5 } };
    expect(phasePrompt(view(p, 0), name).text).toBe('Discard 4 cards');
    expect(phasePrompt(view(p, 1), name).text).toBe('Waiting for Alice and Chen to discard…');
  });

  it('robber, steal, roll and road building', () => {
    expect(phasePrompt(view({ kind: 'moveRobber', returnTo: 'main' }, 0), name).text).toBe(
      'Move the robber',
    );
    expect(phasePrompt(view({ kind: 'preRoll' }, 2, 1), name).text).toBe(
      'Waiting for Bruno to roll…',
    );
    expect(
      phasePrompt(view({ kind: 'steal', candidates: [1], returnTo: 'main' }, 0), name).tone,
    ).toBe('act');
    expect(phasePrompt(view({ kind: 'roadBuilding', remaining: 1 }, 0), name).text).toBe(
      'Place 1 free road',
    );
  });

  it('main phase, trade offers, special build and game over', () => {
    expect(phasePrompt(view({ kind: 'main' }, 1, 0), name).text).toBe("Alice's turn");
    const trades = [
      {
        id: 1,
        from: 0,
        give: resourcesOf({ ore: 1 }),
        want: resourcesOf({ wool: 1 }),
        to: null,
        responses: { '1': 'pending' as const },
        counterTo: null,
      },
    ];
    expect(phasePrompt(view({ kind: 'main' }, 1, 0, { trades }), name).text).toBe(
      'Alice offers you a trade',
    );
    expect(phasePrompt(view({ kind: 'specialBuild', seat: 2, queue: [] }, 2), name).tone).toBe(
      'act',
    );
    expect(phasePrompt(view({ kind: 'gameOver', winner: 1 }, 1), name).text).toBe('You win!');
    expect(phasePrompt(view({ kind: 'gameOver', winner: 1 }, null), name).text).toBe('Bruno wins!');
  });
});

describe('computeHighlights', () => {
  const legal: LegalSummary = {
    ...base.legal!,
    settlementVertices: ['0,0,N'],
    roadEdges: ['0,0,NE'],
    cityVertices: ['0,0,S'],
    robberHexes: ['1,0'],
    canAfford: { road: true, settlement: true, city: false, devCard: false },
  };
  const withLegal = (phase: Phase, actions: LegalSummary['actions']) =>
    view(phase, 0, 0, { legal: { ...legal, actions }, pendingActors: [0] });

  it('highlights setup placements without a build mode', () => {
    const v = withLegal({ kind: 'setup', index: 0, step: 'settlement', lastSettlement: null }, [
      'PLACE_SETTLEMENT',
    ]);
    const h = computeHighlights(v, null);
    expect(h.vertexAction).toBe('PLACE_SETTLEMENT');
    expect(h.vertices).toEqual(['0,0,N']);
    expect(h.edges).toEqual([]);
  });

  it('needs a build mode in the main phase', () => {
    const v = withLegal({ kind: 'main' }, ['BUILD_ROAD', 'BUILD_SETTLEMENT', 'BUILD_CITY']);
    expect(computeHighlights(v, null).vertices).toEqual([]);
    expect(computeHighlights(v, 'buildRoad')).toMatchObject({
      edgeAction: 'BUILD_ROAD',
      edges: ['0,0,NE'],
    });
    expect(computeHighlights(v, 'buildCity')).toMatchObject({
      vertexAction: 'BUILD_CITY',
      vertices: ['0,0,S'],
    });
  });

  it('highlights free roads and robber targets automatically', () => {
    expect(
      computeHighlights(withLegal({ kind: 'roadBuilding', remaining: 2 }, ['BUILD_ROAD']), null)
        .edges,
    ).toEqual(['0,0,NE']);
    expect(
      computeHighlights(withLegal({ kind: 'moveRobber', returnTo: 'main' }, ['MOVE_ROBBER']), null)
        .hexes,
    ).toEqual(['1,0']);
  });

  it('shows nothing to spectators or without legal actions', () => {
    expect(computeHighlights(view({ kind: 'main' }, null), 'buildRoad').edges).toEqual([]);
    expect(computeHighlights(withLegal({ kind: 'main' }, []), 'buildRoad').edges).toEqual([]);
  });

  it('drops build modes that are no longer affordable', () => {
    const v = withLegal({ kind: 'main' }, ['BUILD_ROAD', 'BUILD_CITY']);
    expect(sanitizeMode(v, 'buildRoad')).toBe('buildRoad');
    expect(sanitizeMode(v, 'buildCity')).toBeNull();
    expect(sanitizeMode(null, 'buildRoad')).toBeNull();
  });
});

describe('lobby rules', () => {
  const seat = (i: number, kind: 'open' | 'human' | 'bot', ready = false) => ({
    index: i,
    kind,
    userId: kind === 'human' ? `u${i}` : null,
    name: `P${i}`,
    avatarUrl: null,
    color: '#fff',
    ready,
    connected: true,
    controller: kind === 'bot' ? ('bot' as const) : ('human' as const),
    botDifficulty: 'normal' as const,
    inVoice: false,
    muted: false,
  });
  const room = (seats: ReturnType<typeof seat>[], maxSeats = 3) => ({
    id: 'r',
    code: 'ABCDEF',
    hostUserId: 'u0',
    status: 'lobby' as const,
    settings: {
      maxSeats,
      variant: 'auto' as const,
      vpToWin: 10,
      discardLimit: 7,
      numberMode: 'random' as const,
      portMode: 'fixed' as const,
      turnTimerSec: 90,
    },
    seats,
    gameId: null,
    paused: false,
    spectators: [],
  });

  it('can start only with every seat filled and every human ready', () => {
    expect(canStart(room([seat(0, 'human', true), seat(1, 'bot'), seat(2, 'bot')]))).toBe(true);
    expect(canStart(room([seat(0, 'human', false), seat(1, 'bot'), seat(2, 'bot')]))).toBe(false);
    expect(canStart(room([seat(0, 'human', true), seat(1, 'open'), seat(2, 'bot')]))).toBe(false);
    expect(canStart(room([seat(0, 'human', true), seat(1, 'bot')]))).toBe(false);
  });

  it('parses bounded whole numbers typed into settings', () => {
    expect(parseBoundedInt(' 12 ', 5, 20)).toBe(12);
    expect(parseBoundedInt('4', 5, 20)).toBeNull();
    expect(parseBoundedInt('21', 5, 20)).toBeNull();
    expect(parseBoundedInt('1e1', 5, 20)).toBeNull();
    expect(parseBoundedInt('', 5, 20)).toBeNull();
    expect(parseBoundedInt('7.5', 5, 20)).toBeNull();
  });

  it('resolves the effective board variant', () => {
    expect(effectiveVariant({ variant: 'auto', maxSeats: 4 })).toBe('base');
    expect(effectiveVariant({ variant: 'auto', maxSeats: 5 })).toBe('ext56');
    expect(effectiveVariant({ variant: 'ext56', maxSeats: 3 })).toBe('ext56');
  });
});
