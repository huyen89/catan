import { RESOURCES, type Action, type PlayerView, type Seat } from '@hexhaven/engine';

/**
 * Simple always-available moves for `seat`, used when the bot throws or proposes an illegal
 * action, or when a turn timer expires and the bot fails. Derived from the redacted view only.
 * Candidates are tried in order; the first one the engine accepts wins.
 */
export function fallbackActions(view: PlayerView, seat: Seat): Action[] {
  const legal = view.legal;
  const phase = view.phase;
  const out: Action[] = [];
  switch (phase.kind) {
    case 'setup':
      if (phase.step === 'settlement' && legal?.settlementVertices[0])
        out.push({ type: 'PLACE_SETTLEMENT', vertex: legal.settlementVertices[0] });
      if (phase.step === 'road' && legal?.roadEdges[0])
        out.push({ type: 'PLACE_ROAD', edge: legal.roadEdges[0] });
      break;
    case 'preRoll':
      out.push({ type: 'ROLL' });
      break;
    case 'discard': {
      const discard = autoDiscard(view, seat, phase.pending[String(seat)] ?? 0);
      if (discard) out.push(discard);
      break;
    }
    case 'moveRobber':
      if (legal?.robberHexes[0]) out.push({ type: 'MOVE_ROBBER', hex: legal.robberHexes[0] });
      break;
    case 'steal':
      if (legal?.stealVictims[0] !== undefined)
        out.push({ type: 'STEAL', victim: legal.stealVictims[0] });
      break;
    case 'roadBuilding':
      if (legal?.roadEdges[0]) out.push({ type: 'BUILD_ROAD', edge: legal.roadEdges[0] });
      break;
    case 'main':
      for (const t of view.trades)
        if (t.responses[String(seat)] === 'pending')
          out.push({ type: 'RESPOND_TRADE', offerId: t.id, response: 'reject' });
      if (view.turn.current === seat) out.push({ type: 'END_TURN' });
      break;
    case 'specialBuild':
      out.push({ type: 'PASS_SPECIAL_BUILD' });
      break;
    case 'gameOver':
      break;
  }
  // Generic last resorts (the engine rejects whatever does not apply).
  for (const a of ['END_TURN', 'PASS_SPECIAL_BUILD', 'ROLL'] as const)
    if (!out.some((o) => o.type === a)) out.push({ type: a });
  return out;
}

/** Discard `count` cards, always taking from the currently largest pile. */
function autoDiscard(view: PlayerView, seat: Seat, count: number): Action | null {
  const hand = view.players[seat]?.resources;
  if (!hand || count <= 0) return null;
  const left = { ...hand };
  const resources = { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };
  for (let i = 0; i < count; i++) {
    const r = RESOURCES.reduce((best, k) => (left[k] > left[best] ? k : best), RESOURCES[0]);
    if (left[r] <= 0) return null;
    left[r]--;
    resources[r]++;
  }
  return { type: 'DISCARD', resources };
}
