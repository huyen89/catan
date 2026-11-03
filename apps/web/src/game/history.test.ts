import { describe, expect, it } from 'vitest';
import type { GameSummary, StatsResponse } from '@hexhaven/shared';
import {
  RESULT_LABEL,
  formatAverage,
  formatDateTime,
  formatPercent,
  historyRow,
  opponentStats,
  variantLabel,
  variantStats,
} from './history';

const game = (patch: Partial<GameSummary> = {}): GameSummary => ({
  gameId: 'g1',
  roomCode: 'ABCDEF',
  variant: 'base',
  status: 'finished',
  winner: 1,
  mySeat: 0,
  players: [
    { seat: 1, name: 'Bruno', kind: 'bot', userId: null, vp: 10 },
    { seat: 0, name: 'Alice', kind: 'human', userId: 'u0', vp: 7 },
    { seat: 2, name: 'Chen', kind: 'human', userId: 'u2', vp: 4 },
  ],
  turns: 42,
  createdAt: 1_000,
  finishedAt: 5_000,
  ...patch,
});

describe('historyRow', () => {
  it('summarises a finished game from my seat', () => {
    const row = historyRow(game());
    expect(row).toMatchObject({
      gameId: 'g1',
      when: 5_000,
      variant: 'Classic (3–4)',
      winnerName: 'Bruno',
      myVp: 7,
      result: 'lost',
      turns: 42,
      canReplay: true,
    });
    expect(row.players.map((p) => p.name)).toEqual(['Alice', 'Bruno', 'Chen']);
    expect(row.players[0]).toMatchObject({ me: true, winner: false, bot: false });
    expect(row.players[1]).toMatchObject({ me: false, winner: true, bot: true });
  });

  it('labels wins, active, abandoned and spectated games', () => {
    expect(historyRow(game({ winner: 0 })).result).toBe('won');
    const active = historyRow(game({ status: 'active', winner: null, finishedAt: null }));
    expect(active).toMatchObject({ result: 'active', when: 1_000, canReplay: false });
    expect(active.winnerName).toBeNull();
    expect(historyRow(game({ status: 'abandoned', winner: null })).result).toBe('abandoned');
    const watched = historyRow(game({ mySeat: null }));
    expect(watched).toMatchObject({ result: 'finished', myVp: null });
    // Finished without a winner: neutral, not "Lost".
    const noWinner = historyRow(game({ winner: null }));
    expect(noWinner).toMatchObject({ result: 'finished', winnerName: null, myVp: 7 });
    expect(RESULT_LABEL[noWinner.result]).toBe('Finished');
  });
});

describe('formatting', () => {
  it('formats percentages and averages with an em dash for no data', () => {
    expect(formatPercent(0, 0)).toBe('—');
    expect(formatPercent(1, 3)).toBe('33%');
    expect(formatPercent(2, 3)).toBe('67%');
    expect(formatPercent(5, 5)).toBe('100%');
    expect(formatAverage(7.25, 4)).toBe('7.3');
    expect(formatAverage(8, 2)).toBe('8');
    expect(formatAverage(0, 0)).toBe('—');
    expect(formatAverage(Number.NaN, 3)).toBe('—');
  });

  it('formats dates in a fixed zone and labels variants', () => {
    expect(formatDateTime(Date.UTC(2026, 2, 12, 19, 5), 'en-GB', 'UTC')).toBe('12 Mar 2026, 19:05');
    expect(variantLabel('ext56')).toBe('Extended (5–6)');
    expect(variantLabel('custom')).toBe('custom');
  });
});

describe('stats tables', () => {
  const stats: StatsResponse = {
    played: 6,
    won: 2,
    avgVp: 7.5,
    byVariant: {
      base: { played: 2, won: 1 },
      ext56: { played: 4, won: 1 },
      odd: { played: 0, won: 0 },
    },
    opponents: [
      { userId: 'b', name: 'Bea', games: 2, yourWins: 0, theirWins: 2 },
      { userId: 'a', name: 'Al', games: 5, yourWins: 3, theirWins: 1 },
      { userId: 'c', name: 'Cy', games: 2, yourWins: 1, theirWins: 1 },
    ],
  };

  it('lists variants by games played, hiding empty ones', () => {
    expect(variantStats(stats)).toEqual([
      { variant: 'ext56', label: 'Extended (5–6)', played: 4, won: 1, winRate: '25%' },
      { variant: 'base', label: 'Classic (3–4)', played: 2, won: 1, winRate: '50%' },
    ]);
  });

  it('orders head-to-head by games then name, with a record and leader', () => {
    expect(opponentStats(stats).map((o) => [o.name, o.record, o.edge])).toEqual([
      ['Al', '3–1', 'you'],
      ['Bea', '0–2', 'them'],
      ['Cy', '1–1', 'even'],
    ]);
  });
});
