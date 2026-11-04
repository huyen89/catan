import { graphFor, type BoardGraph } from './hex/topology';
import { COSTS, hasResources, totalResources } from './resources';
import { bankCanPay, playableDevCards, roadBuildingCount } from './rules/devcards';
import { canTradeMaritime } from './rules/maritime';
import {
  buildableRoadEdges,
  buildableSettlementVertices,
  buildableShipEdges,
  maritimeRatios,
  ownSettlements,
  setupRoadEdges,
  setupSettlementVertices,
  setupShipEdges,
  shipMoveTargets,
} from './rules/placement';
import { robberTargets } from './rules/robber';
import { pirateTargets } from './rules/sea';
import { confirmablePartners, MAX_OPEN_OFFERS, openOffersBy } from './rules/trade';
import {
  RESOURCES,
  type ActionType,
  type DevCardType,
  type EdgeId,
  type GameState,
  type LegalSummary,
  type Seat,
} from './types';
import { variantFor } from './variants';

function emptySummary(): LegalSummary {
  return {
    actions: [],
    settlementVertices: [],
    roadEdges: [],
    cityVertices: [],
    robberHexes: [],
    stealVictims: [],
    discardCount: 0,
    maritimeRatios: { brick: 4, lumber: 4, wool: 4, grain: 4, ore: 4 },
    playableDev: [],
    shipEdges: [],
    shipMoves: {},
    pirateHexes: [],
    goldCount: 0,
    canAfford: { road: false, settlement: false, city: false, devCard: false, ship: false },
  };
}

/** Building options for the seat allowed to build (main / specialBuild). */
function addBuildOptions(out: LegalSummary, state: GameState, graph: BoardGraph, seat: Seat): void {
  const p = state.players[seat]!;
  out.roadEdges = p.roadsLeft > 0 ? buildableRoadEdges(state, graph, seat) : [];
  out.settlementVertices =
    p.settlementsLeft > 0 ? buildableSettlementVertices(state, graph, seat) : [];
  out.cityVertices = p.citiesLeft > 0 ? ownSettlements(state, seat) : [];
  out.shipEdges = p.shipsLeft > 0 ? buildableShipEdges(state, graph, seat) : [];
  if (out.canAfford.road && out.roadEdges.length > 0) out.actions.push('BUILD_ROAD');
  if (out.canAfford.ship && out.shipEdges.length > 0) out.actions.push('BUILD_SHIP');
  if (out.canAfford.settlement && out.settlementVertices.length > 0) {
    out.actions.push('BUILD_SETTLEMENT');
  }
  if (out.canAfford.city && out.cityVertices.length > 0) out.actions.push('BUILD_CITY');
  if (out.canAfford.devCard && state.devDeck.length > 0) out.actions.push('BUY_DEV');
}

/**
 * Dev cards that would succeed for some payload. `roadEdges`/`shipEdges` are the seat's
 * buildable edges when the caller already has them (so the board is not scanned twice); the
 * road-building check is the handler's own roadBuildingCount, so the two cannot drift apart.
 */
function addDevOptions(
  out: LegalSummary,
  state: GameState,
  graph: BoardGraph,
  seat: Seat,
  roadEdges?: () => readonly EdgeId[],
  shipEdges?: () => readonly EdgeId[],
): void {
  const playable = playableDevCards(state, seat);
  if (playable.length === 0) return;
  const bankHasTwo = RESOURCES.some((a) => RESOURCES.some((b) => bankCanPay(state.bank, [a, b])));
  const cards: DevCardType[] = playable.filter(
    (c) =>
      (c !== 'yearOfPlenty' || bankHasTwo) &&
      (c !== 'roadBuilding' || roadBuildingCount(state, graph, seat, roadEdges, shipEdges) > 0),
  );
  out.playableDev = cards;
  const ACTION: Record<string, ActionType> = {
    knight: 'PLAY_KNIGHT',
    roadBuilding: 'PLAY_ROAD_BUILDING',
    yearOfPlenty: 'PLAY_YEAR_OF_PLENTY',
    monopoly: 'PLAY_MONOPOLY',
  };
  for (const c of cards) out.actions.push(ACTION[c]!);
}

/** Domestic-trade actions for `seat` during main. */
function addTradeOptions(out: LegalSummary, state: GameState, seat: Seat): void {
  const current = state.turn.current;
  const hasCards = totalResources(state.players[seat]!.resources) > 0;
  const own = state.trades.filter((t) => t.from === seat);
  const addressed = state.trades.filter((t) => Object.hasOwn(t.responses, String(seat)));
  if (seat === current) {
    if (hasCards && openOffersBy(state, seat).length < MAX_OPEN_OFFERS) {
      out.actions.push('OFFER_TRADE');
    }
    if (own.some((t) => confirmablePartners(state, t).length > 0))
      out.actions.push('CONFIRM_TRADE');
  } else if (hasCards && addressed.some((t) => t.from === current && t.counterTo === null)) {
    out.actions.push('OFFER_TRADE');
  }
  if (addressed.length > 0) out.actions.push('RESPOND_TRADE');
  if (own.length > 0) out.actions.push('CANCEL_TRADE');
}

/**
 * Legal-move summary for `seat`. Powers UI highlights and the bot.
 * `actions` lists exactly the action types that would succeed for at least one payload.
 */
export function getLegal(state: GameState, seat: Seat): LegalSummary {
  const out = emptySummary();
  const p = state.players[seat];
  if (!p) return out;
  const graph = graphFor(state.board);
  out.maritimeRatios = maritimeRatios(state, seat);
  out.canAfford = {
    road: hasResources(p.resources, COSTS.road),
    settlement: hasResources(p.resources, COSTS.settlement),
    city: hasResources(p.resources, COSTS.city),
    devCard: hasResources(p.resources, COSTS.devCard),
    // Gated by the variant: without ships, a ship is never affordable.
    ship: variantFor(state.config).ships > 0 && hasResources(p.resources, COSTS.ship),
  };
  const ph = state.phase;
  const isCurrent = seat === state.turn.current;

  switch (ph.kind) {
    case 'setup': {
      if (seat !== state.setupOrder[ph.index]) break;
      if (ph.step === 'settlement') {
        out.settlementVertices = p.settlementsLeft > 0 ? setupSettlementVertices(state, graph) : [];
        if (out.settlementVertices.length > 0) out.actions.push('PLACE_SETTLEMENT');
      } else {
        out.roadEdges = p.roadsLeft > 0 ? setupRoadEdges(state, graph, ph.lastSettlement) : [];
        if (out.roadEdges.length > 0) out.actions.push('PLACE_ROAD');
        out.shipEdges = p.shipsLeft > 0 ? setupShipEdges(state, graph, ph.lastSettlement) : [];
        if (out.shipEdges.length > 0) out.actions.push('PLACE_SHIP');
      }
      break;
    }
    case 'preRoll':
      if (!isCurrent) break;
      out.actions.push('ROLL');
      addDevOptions(out, state, graph, seat);
      break;
    case 'discard':
      out.discardCount = ph.pending[String(seat)] ?? 0;
      if (out.discardCount > 0) out.actions.push('DISCARD');
      break;
    case 'goldChoice':
      out.goldCount = ph.pending[String(seat)] ?? 0;
      if (out.goldCount > 0) out.actions.push('CHOOSE_GOLD');
      break;
    case 'moveRobber':
      if (!isCurrent) break;
      out.robberHexes = robberTargets(state);
      if (out.robberHexes.length > 0) out.actions.push('MOVE_ROBBER');
      out.pirateHexes = ph.allowPirate ? pirateTargets(state) : [];
      if (out.pirateHexes.length > 0) out.actions.push('MOVE_PIRATE');
      break;
    case 'steal':
      if (!isCurrent) break;
      out.stealVictims = [...ph.candidates];
      out.actions.push('STEAL');
      break;
    case 'roadBuilding':
      if (!isCurrent) break;
      out.roadEdges = p.roadsLeft > 0 ? buildableRoadEdges(state, graph, seat) : [];
      if (out.roadEdges.length > 0) out.actions.push('BUILD_ROAD');
      out.shipEdges = p.shipsLeft > 0 ? buildableShipEdges(state, graph, seat) : [];
      if (out.shipEdges.length > 0) out.actions.push('BUILD_SHIP');
      break;
    case 'main':
      if (isCurrent) {
        addBuildOptions(out, state, graph, seat);
        addDevOptions(
          out,
          state,
          graph,
          seat,
          () => out.roadEdges,
          () => out.shipEdges,
        );
        if (!state.turn.shipMoved) {
          out.shipMoves = shipMoveTargets(state, graph, seat, state.turn.newShips);
          if (Object.keys(out.shipMoves).length > 0) out.actions.push('MOVE_SHIP');
        }
        if (canTradeMaritime(state, seat, out.maritimeRatios)) out.actions.push('MARITIME_TRADE');
      }
      addTradeOptions(out, state, seat);
      if (isCurrent) out.actions.push('END_TURN');
      break;
    case 'specialBuild':
      if (seat !== ph.seat) break;
      addBuildOptions(out, state, graph, seat);
      out.actions.push('PASS_SPECIAL_BUILD');
      break;
    case 'gameOver':
      break;
  }
  return out;
}
