import { getLegal } from './legal';
import { getPendingActors } from './pending';
import { totalResources } from './resources';
import { publicVP, totalVP } from './rules/victory';
import type { GameEvent, GameState, PlayerView, PublicPlayer, Seat } from './types';

/**
 * Redacted view for one viewer. NEVER includes: rng, devDeck order, opponents' hands or dev cards
 * (until game over). Every new GameState field must be classified here (see REVIEW_CHECKLIST.md).
 */
export function toPlayerView(state: GameState, viewer: Seat | null): PlayerView {
  const over = state.phase.kind === 'gameOver';
  const players: PublicPlayer[] = state.players.map((p) => {
    const pub: PublicPlayer = {
      seat: p.seat,
      resourceCount: totalResources(p.resources),
      devCardCount: p.devCards.length + p.newDevCards.length,
      playedKnights: p.playedKnights,
      roadsLeft: p.roadsLeft,
      settlementsLeft: p.settlementsLeft,
      citiesLeft: p.citiesLeft,
      longestRoadLength: p.longestRoadLength,
      publicVP: publicVP(state, p.seat),
    };
    if (over || p.seat === viewer) {
      pub.resources = { ...p.resources };
      pub.devCards = [...p.devCards];
      pub.newDevCards = [...p.newDevCards];
      pub.totalVP = totalVP(state, p.seat);
    }
    return pub;
  });

  return {
    viewer,
    version: state.version,
    config: state.config,
    board: state.board,
    robber: state.robber,
    buildings: state.buildings,
    roads: state.roads,
    players,
    bank: { ...state.bank },
    devDeckCount: state.devDeck.length,
    setupOrder: state.setupOrder,
    turn: state.turn,
    phase: state.phase,
    trades: state.trades,
    longestRoad: state.longestRoad,
    largestArmy: state.largestArmy,
    winner: state.winner,
    pendingActors: getPendingActors(state),
    legal: viewer === null || over ? null : getLegal(state, viewer),
  };
}

/** Redact an event for a viewer. Returns null if the viewer must not see it at all. */
export function redactEvent(e: GameEvent, viewer: Seat | null): GameEvent | null {
  switch (e.type) {
    case 'stole':
      return viewer === e.thief || viewer === e.victim ? e : { ...e, resource: null };
    case 'boughtDev':
      return viewer === e.seat ? e : { ...e, card: null };
    default:
      return e;
  }
}
