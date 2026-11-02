import type { FastifyInstance } from 'fastify';
import type {
  GameListResponse,
  GameSummary,
  ReplayResponse,
  StatsResponse,
} from '@hexhaven/shared';
import { z } from 'zod';
import { parseBody, requireUser } from '../auth/routes';
import type { Repos } from '../db';
import type { GamePlayerRow, GameRow } from '../db/games';
import { AppError } from '../errors';

export const GAME_LIST_LIMIT = 50;

const gameParams = z.strictObject({ id: z.uuid() });

type GameWithPlayers = GameRow & { players: GamePlayerRow[] };

function summarize(repos: Repos, g: GameWithPlayers, userId: string): GameSummary {
  const mine = g.players.find((p) => p.userId === userId);
  return {
    gameId: g.id,
    roomCode: g.roomCode,
    variant: g.config.variant,
    status: g.status,
    winner: g.winner,
    mySeat: mine?.seat ?? null,
    players: g.players.map((p) => ({
      seat: p.seat,
      name: p.name,
      kind: p.kind,
      userId: p.userId,
      vp: g.status === 'finished' ? p.vp : null,
    })),
    turns: g.turns ?? repos.games.latestTurn(g.id) ?? 0,
    createdAt: g.createdAt,
    finishedAt: g.finishedAt,
  };
}

/** Aggregate stats over the user's finished games (pure, exported for tests). */
export function computeStats(
  games: readonly GameWithPlayers[],
  userId: string,
  nameOf: (userId: string) => string | null,
): StatsResponse {
  let played = 0;
  let won = 0;
  let vpSum = 0;
  const byVariant: StatsResponse['byVariant'] = {};
  const opponents = new Map<string, StatsResponse['opponents'][number]>();
  for (const g of games) {
    if (g.status !== 'finished') continue;
    const me = g.players.find((p) => p.userId === userId);
    if (!me) continue;
    played++;
    const iWon = g.winner === me.seat;
    if (iWon) won++;
    vpSum += me.vp ?? 0;
    const v = (byVariant[g.config.variant] ??= { played: 0, won: 0 });
    v.played++;
    if (iWon) v.won++;
    for (const p of g.players) {
      if (p.kind !== 'human' || !p.userId || p.userId === userId) continue;
      let o = opponents.get(p.userId);
      if (!o) {
        o = {
          userId: p.userId,
          name: nameOf(p.userId) ?? p.name,
          games: 0,
          yourWins: 0,
          theirWins: 0,
        };
        opponents.set(p.userId, o);
      }
      o.games++;
      if (iWon) o.yourWins++;
      if (g.winner === p.seat) o.theirWins++;
    }
  }
  return {
    played,
    won,
    avgVp: played > 0 ? Math.round((vpSum / played) * 100) / 100 : 0,
    byVariant,
    opponents: [...opponents.values()].sort(
      (a, b) => b.games - a.games || a.name.localeCompare(b.name),
    ),
  };
}

/** Game history, replays and stats for the signed-in user (M4). */
export async function registerHistoryRoutes(
  app: FastifyInstance,
  opts: { repos: Repos; testMode: boolean },
): Promise<void> {
  const { repos } = opts;
  const routeOpts = {
    preHandler: requireUser,
    config: { rateLimit: { max: opts.testMode ? 1000 : 60, timeWindow: '1 minute' } },
  };

  app.get('/api/games', routeOpts, async (req): Promise<GameListResponse> => {
    const userId = req.user!.id;
    const games = repos.games.listForUser(userId, { limit: GAME_LIST_LIMIT });
    return { games: games.map((g) => summarize(repos, g, userId)) };
  });

  app.get('/api/games/:id/replay', routeOpts, async (req): Promise<ReplayResponse> => {
    const { id } = parseBody(gameParams, req.params);
    const userId = req.user!.id;
    const game = repos.games.get(id);
    const players = game ? repos.games.players(id) : [];
    // Non-participants get the same answer as an unknown id: game ids are not disclosed.
    if (!game || !players.some((p) => p.userId === userId)) {
      throw new AppError('GAME_NOT_FOUND', 'No such game', 404);
    }
    if (game.status !== 'finished') {
      throw new AppError('GAME_NOT_FINISHED', 'Replays are available once the game is over', 403);
    }
    return {
      summary: summarize(repos, { ...game, players }, userId),
      config: game.config,
      seed: game.seed,
      engineVersion: game.engineVersion,
      actions: repos.games
        .allActions(id)
        .map((a) => ({ seat: a.seat, action: a.action, ts: a.ts })),
    };
  });

  app.get('/api/stats', routeOpts, async (req): Promise<StatsResponse> => {
    const userId = req.user!.id;
    const games = repos.games.listForUser(userId, { status: 'finished', limit: -1 });
    return computeStats(games, userId, (id) => repos.users.get(id)?.name ?? null);
  });
}
