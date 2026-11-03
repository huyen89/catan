import type { GameState, Seat } from '../types';

/** VP visible to everyone: buildings + awards + island bonuses. */
export function publicVP(state: GameState, seat: Seat): number {
  let vp = 0;
  for (const b of Object.values(state.buildings)) {
    if (b.owner === seat) vp += b.kind === 'city' ? 2 : 1;
  }
  if (state.longestRoad === seat) vp += 2;
  if (state.largestArmy === seat) vp += 2;
  return vp + state.players[seat]!.bonusVP;
}

/** Hidden VP cards (counted whether bought this turn or earlier). */
export function hiddenVP(state: GameState, seat: Seat): number {
  const p = state.players[seat]!;
  return [...p.devCards, ...p.newDevCards].filter((c) => c === 'victoryPoint').length;
}

export function totalVP(state: GameState, seat: Seat): number {
  return publicVP(state, seat) + hiddenVP(state, seat);
}
