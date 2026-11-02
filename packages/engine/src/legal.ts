import { emptyResources } from './resources';
import type { GameState, LegalSummary, Seat } from './types';

/**
 * Legal-move summary for `seat`. Powers UI highlights and the bot.
 * M0 stub — implemented by the engine-rules workstream.
 */
export function getLegal(_state: GameState, _seat: Seat): LegalSummary {
  const ratios = emptyResources();
  for (const k of Object.keys(ratios) as Array<keyof typeof ratios>) ratios[k] = 4;
  return {
    actions: [],
    settlementVertices: [],
    roadEdges: [],
    cityVertices: [],
    robberHexes: [],
    stealVictims: [],
    discardCount: 0,
    maritimeRatios: ratios,
    playableDev: [],
    canAfford: { road: false, settlement: false, city: false, devCard: false },
  };
}
