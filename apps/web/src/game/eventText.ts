import { totalResources, type GameEvent, type Seat, type TradeOffer } from '@hexhaven/engine';
import { DEV_LABEL, formatCounts, plural } from './labels';

export interface EventTextContext {
  /** Display name for a seat. */
  name(seat: Seat): string;
  /** Human description of a hex, e.g. "Forest (8)". */
  hexLabel(hex: string): string;
}

const AWARD_LABEL = { longestRoad: 'Longest Road', largestArmy: 'Largest Army' } as const;

function offerText(o: TradeOffer, ctx: EventTextContext): string {
  const who = ctx.name(o.from);
  const verb = o.counterTo !== null ? 'counters with' : 'offers';
  const to = o.to && o.to.length ? ` to ${o.to.map((s) => ctx.name(s)).join(', ')}` : '';
  return `${who} ${verb} ${formatCounts(o.give)} for ${formatCounts(o.want)}${to}`;
}

/** The seat an event is mostly "about" (used to colour the log line). */
export function eventSeat(e: GameEvent): Seat | null {
  switch (e.type) {
    case 'setupPlaced':
    case 'setupResources':
    case 'rolled':
    case 'discarded':
    case 'robberMoved':
    case 'built':
    case 'boughtDev':
    case 'playedDev':
    case 'monopoly':
    case 'yearOfPlenty':
    case 'maritimeTrade':
    case 'tradeResponded':
    case 'turnStarted':
    case 'specialBuildTurn':
      return e.seat;
    case 'stole':
      return e.thief;
    case 'tradeOffered':
      return e.offer.from;
    case 'traded':
      return e.a;
    case 'awardChanged':
      return e.holder;
    case 'gameOver':
      return e.winner;
    default:
      return null;
  }
}

/** One readable log line per engine event. */
export function eventText(e: GameEvent, ctx: EventTextContext): string {
  const n = (s: Seat) => ctx.name(s);
  switch (e.type) {
    case 'setupPlaced':
      return `${n(e.seat)} placed a ${e.kind}`;
    case 'setupResources':
      return totalResources(e.resources) > 0
        ? `${n(e.seat)} received ${formatCounts(e.resources)}`
        : `${n(e.seat)} received no starting resources`;
    case 'rolled':
      return `${n(e.seat)} rolled ${e.dice[0]} + ${e.dice[1]} = ${e.total}`;
    case 'produced': {
      const parts = Object.entries(e.gains)
        .filter(([, c]) => totalResources(c) > 0)
        .map(([s, c]) => `${n(Number(s))} got ${formatCounts(c)}`);
      return parts.length ? parts.join('; ') : 'Nobody produced anything';
    }
    case 'discardRequired': {
      const parts = Object.entries(e.pending)
        .filter(([, k]) => k > 0)
        .map(([s, k]) => `${n(Number(s))} (${k})`);
      return `Must discard: ${parts.join(', ')}`;
    }
    case 'discarded':
      return `${n(e.seat)} discarded ${plural(totalResources(e.resources), 'card')} (${formatCounts(e.resources)})`;
    case 'robberMoved':
      return `${n(e.seat)} moved the robber to ${ctx.hexLabel(e.hex)}`;
    case 'stole':
      return e.resource
        ? `${n(e.thief)} stole 1 ${e.resource} from ${n(e.victim)}`
        : `${n(e.thief)} stole a card from ${n(e.victim)}`;
    case 'built':
      return `${n(e.seat)} built a ${e.kind}`;
    case 'boughtDev':
      return e.card
        ? `${n(e.seat)} bought a development card (${DEV_LABEL[e.card]})`
        : `${n(e.seat)} bought a development card`;
    case 'playedDev':
      return `${n(e.seat)} played ${DEV_LABEL[e.card]}`;
    case 'monopoly': {
      const total = Object.values(e.taken).reduce((a, b) => a + b, 0);
      return `${n(e.seat)} claimed ${total} ${e.resource} with Monopoly`;
    }
    case 'yearOfPlenty': {
      const [a, b] = e.resources;
      return a === b
        ? `${n(e.seat)} took 2 ${a} from the bank`
        : `${n(e.seat)} took 1 ${a} and 1 ${b} from the bank`;
    }
    case 'maritimeTrade':
      return `${n(e.seat)} traded ${e.giveCount} ${e.give} with the bank for 1 ${e.get}`;
    case 'tradeOffered':
      return offerText(e.offer, ctx);
    case 'tradeResponded':
      return `${n(e.seat)} ${e.response === 'accept' ? 'accepted' : 'rejected'} trade offer #${e.offerId}`;
    case 'traded':
      return `${n(e.a)} traded ${formatCounts(e.aGave)} to ${n(e.b)} for ${formatCounts(e.bGave)}`;
    case 'tradeCancelled':
      return `Trade offer #${e.offerId} was withdrawn`;
    case 'awardChanged':
      return e.holder === null
        ? `Nobody holds ${AWARD_LABEL[e.award]} now`
        : `${n(e.holder)} now holds ${AWARD_LABEL[e.award]}`;
    case 'turnStarted':
      return `Turn ${e.turn}: ${n(e.seat)}`;
    case 'specialBuildTurn':
      return `${n(e.seat)} may build (special build phase)`;
    case 'gameOver':
      return `${n(e.winner)} wins with ${plural(e.vp[e.winner] ?? 0, 'point')}!`;
  }
}
