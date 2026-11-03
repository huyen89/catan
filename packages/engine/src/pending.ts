import type { GameState, Seat } from './types';

/**
 * Seats that must or may act right now (drives timers and bot scheduling on the server).
 * - setup/preRoll/moveRobber/steal/main/roadBuilding: the current player
 * - discard / goldChoice: every seat with pending > 0
 * - main with open trade offers: also seats whose response is 'pending'
 * - specialBuild: phase.seat
 * - gameOver: none
 */
export function getPendingActors(state: GameState): Seat[] {
  const p = state.phase;
  switch (p.kind) {
    case 'setup':
      return [state.setupOrder[p.index]!];
    case 'discard':
    case 'goldChoice':
      return Object.entries(p.pending)
        .filter(([, n]) => n > 0)
        .map(([s]) => Number(s));
    case 'specialBuild':
      return [p.seat];
    case 'gameOver':
      return [];
    case 'main': {
      const out = new Set<Seat>([state.turn.current]);
      for (const t of state.trades)
        for (const [s, r] of Object.entries(t.responses)) if (r === 'pending') out.add(Number(s));
      return [...out];
    }
    default:
      return [state.turn.current];
  }
}
