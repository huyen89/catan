import type { GameSummary, StatsResponse } from '@hexhaven/shared';

export const VARIANT_LABEL: Record<string, string> = {
  base: 'Classic (3–4)',
  ext56: 'Extended (5–6)',
};

export const variantLabel = (v: string): string => VARIANT_LABEL[v] ?? v;

/** "12 Mar 2026, 19:05" in the user's locale (time zone injectable for tests). */
export function formatDateTime(ts: number, locale?: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(ts);
}

export type GameResult = 'won' | 'lost' | 'active' | 'abandoned' | 'watched';

export interface HistoryRow {
  gameId: string;
  /** finishedAt when finished, else createdAt. */
  when: number;
  variant: string;
  players: Array<{ name: string; vp: number | null; winner: boolean; me: boolean; bot: boolean }>;
  winnerName: string | null;
  myVp: number | null;
  result: GameResult;
  turns: number;
  /** Only finished games have a replay. */
  canReplay: boolean;
}

export function historyRow(g: GameSummary): HistoryRow {
  const me = g.mySeat === null ? undefined : g.players.find((p) => p.seat === g.mySeat);
  const winner = g.winner === null ? undefined : g.players.find((p) => p.seat === g.winner);
  let result: GameResult;
  if (g.status === 'active') result = 'active';
  else if (g.status === 'abandoned') result = 'abandoned';
  else if (g.mySeat === null) result = 'watched';
  else result = g.winner === g.mySeat ? 'won' : 'lost';
  return {
    gameId: g.gameId,
    when: g.finishedAt ?? g.createdAt,
    variant: variantLabel(g.variant),
    players: [...g.players]
      .sort((a, b) => a.seat - b.seat)
      .map((p) => ({
        name: p.name,
        vp: p.vp,
        winner: p.seat === g.winner,
        me: p.seat === g.mySeat,
        bot: p.kind === 'bot',
      })),
    winnerName: winner?.name ?? null,
    myVp: me?.vp ?? null,
    result,
    turns: g.turns,
    canReplay: g.status === 'finished',
  };
}

export const RESULT_LABEL: Record<GameResult, string> = {
  won: 'Won',
  lost: 'Lost',
  active: 'In progress',
  abandoned: 'Abandoned',
  watched: 'Finished',
};

/** "57%"; an em dash when nothing was played. */
export function formatPercent(won: number, played: number): string {
  if (!played) return '—';
  return `${Math.round((won / played) * 100)}%`;
}

/** One decimal, trailing ".0" dropped; an em dash when there is nothing to average. */
export function formatAverage(avg: number, played: number): string {
  if (!played || !Number.isFinite(avg)) return '—';
  return String(Math.round(avg * 10) / 10);
}

export interface VariantStat {
  variant: string;
  label: string;
  played: number;
  won: number;
  winRate: string;
}

export function variantStats(stats: StatsResponse): VariantStat[] {
  return Object.entries(stats.byVariant)
    .filter(([, s]) => s.played > 0)
    .sort((a, b) => b[1].played - a[1].played || a[0].localeCompare(b[0]))
    .map(([variant, s]) => ({
      variant,
      label: variantLabel(variant),
      played: s.played,
      won: s.won,
      winRate: formatPercent(s.won, s.played),
    }));
}

export interface OpponentStat {
  userId: string;
  name: string;
  games: number;
  yourWins: number;
  theirWins: number;
  /** "3–1" from my side. */
  record: string;
  /** Who leads the head-to-head. */
  edge: 'you' | 'them' | 'even';
}

export function opponentStats(stats: StatsResponse): OpponentStat[] {
  return [...stats.opponents]
    .sort((a, b) => b.games - a.games || a.name.localeCompare(b.name))
    .map((o) => ({
      ...o,
      record: `${o.yourWins}–${o.theirWins}`,
      edge: o.yourWins > o.theirWins ? 'you' : o.yourWins < o.theirWins ? 'them' : 'even',
    }));
}
