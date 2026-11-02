import {
  COSTS,
  RESOURCES,
  buildableSettlementVertices,
  hasResources,
  type Action,
  type EdgeId,
  type HexId,
  type PlayerView,
  type Resource,
  type ResourceCounts,
  type Seat,
  type TradeOffer,
  type VertexId,
} from '@hexhaven/engine';
import {
  argmax,
  boardInfo,
  isOpenSpot,
  missing,
  myHand,
  pips,
  scoreVertex,
  seatProduction,
  sumCounts,
  type BuildTarget,
} from './eval';
import {
  counts,
  nearVictory,
  newMemo,
  offerKey,
  syncMemo,
  tradeGain,
  validTrade,
  type BotMemo,
} from './trading';

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotOptions {
  difficulty: BotDifficulty;
  /** Random source in [0,1). Server passes Math.random; the simulator passes a seeded RNG. */
  random: () => number;
}

export { pips, scoreVertex } from './eval';
export { newMemo, type BotMemo } from './trading';

/** Most offers a bot opens per turn (the engine allows more). */
export const MAX_BOT_OFFERS_PER_TURN = 2;

/**
 * Decide the next action for `view.viewer` given ONLY its redacted view (no hidden info).
 * Always returns an action drawn from `view.legal`; throws if the viewer has nothing to do.
 *
 * Stateless unless `memo` is given: a long-lived caller (see `BotPlayer`) passes the same memo
 * for a seat on every call, which lets the bot remember the offers it made this turn.
 */
export function decide(view: PlayerView, opts: BotOptions, memo?: BotMemo): Action {
  const me = view.viewer;
  const legal = view.legal;
  if (me === null || !legal || legal.actions.length === 0) {
    throw new Error(`bot: seat ${String(me)} has no legal action`);
  }
  const can = (t: Action['type']) => legal.actions.includes(t);
  const bot = new Bot(view, me, opts, memo ? syncMemo(memo, view) : null);

  // Answer trade offers addressed to us first (works for both active and other players).
  if (can('RESPOND_TRADE')) {
    const offer = view.trades.find((t) => t.responses[String(me)] === 'pending');
    if (offer) return bot.respondTo(offer);
  }

  switch (view.phase.kind) {
    case 'setup':
      if (can('PLACE_SETTLEMENT'))
        return { type: 'PLACE_SETTLEMENT', vertex: bot.bestSetupVertex() };
      return { type: 'PLACE_ROAD', edge: bot.bestRoad(legal.roadEdges) };
    case 'discard':
      return { type: 'DISCARD', resources: bot.chooseDiscard(legal.discardCount) };
    case 'moveRobber':
      return { type: 'MOVE_ROBBER', hex: bot.bestRobberHex() };
    case 'steal':
      return { type: 'STEAL', victim: bot.bestVictim(legal.stealVictims) };
    case 'roadBuilding':
      return { type: 'BUILD_ROAD', edge: bot.bestRoad(legal.roadEdges) };
    case 'preRoll':
      if (can('PLAY_KNIGHT') && bot.wantsKnight(true)) return { type: 'PLAY_KNIGHT' };
      return { type: 'ROLL' };
    case 'specialBuild':
      return bot.buildStep() ?? { type: 'PASS_SPECIAL_BUILD' };
    case 'main': {
      if (view.turn.current === me) return bot.mainTurn();
      // Not our turn: withdraw any counter-offer we still have open.
      const mine = view.trades.find((t) => t.from === me);
      if (mine && can('CANCEL_TRADE')) return { type: 'CANCEL_TRADE', offerId: mine.id };
      break;
    }
    default:
      break;
  }
  // Fallbacks for anything unexpected.
  for (const t of ['END_TURN', 'PASS_SPECIAL_BUILD', 'ROLL'] as const)
    if (can(t)) return { type: t };
  throw new Error(`bot: no strategy for phase ${view.phase.kind}`);
}

/**
 * A bot driving one seat for a whole game. Keeps a per-turn trade memo between calls so its
 * own offers are capped and never repeated; otherwise identical to `decide`.
 */
export class BotPlayer {
  private readonly memo = newMemo();

  constructor(private readonly opts: BotOptions) {}

  decide(view: PlayerView): Action {
    return decide(view, this.opts, this.memo);
  }
}

class Bot {
  private readonly hand: ResourceCounts;
  private readonly production: ResourceCounts;
  private readonly can: (t: Action['type']) => boolean;

  constructor(
    private readonly view: PlayerView,
    private readonly me: Seat,
    private readonly opts: BotOptions,
    private readonly memo: BotMemo | null,
  ) {
    this.hand = myHand(view);
    this.production = seatProduction(view, me);
    const actions = view.legal!.actions;
    this.can = (t) => actions.includes(t);
  }

  private get legal() {
    return this.view.legal!;
  }

  private noise(): number {
    const amp = this.opts.difficulty === 'easy' ? 3 : this.opts.difficulty === 'normal' ? 0.6 : 0.1;
    return (this.opts.random() - 0.5) * amp;
  }

  private pick<T>(items: readonly T[], score: (t: T) => number): T {
    const best = argmax(items, (t) => score(t) + this.noise());
    if (best === undefined) throw new Error('bot: empty choice');
    return best;
  }

  // ------------------------------------------------------------ placement

  bestSetupVertex(): VertexId {
    return this.pick(this.legal.settlementVertices, (v) =>
      scoreVertex(this.view, this.me, v, this.production),
    );
  }

  /** Score a road by the best open settlement spot it leads toward (BFS ≤ 3 steps). */
  bestRoad(edges: readonly EdgeId[]): EdgeId {
    const { graph } = boardInfo(this.view);
    const mine = new Set<VertexId>();
    for (const [e, s] of Object.entries(this.view.roads))
      if (s === this.me) for (const v of graph.edgeVertices[e] ?? []) mine.add(v);
    for (const [v, b] of Object.entries(this.view.buildings)) if (b.owner === this.me) mine.add(v);

    const reach = (start: VertexId): number => {
      let best = 0;
      const seen = new Set([start]);
      let frontier = [start];
      for (let d = 0; d <= 3 && frontier.length; d++) {
        const next: VertexId[] = [];
        for (const v of frontier) {
          if (isOpenSpot(this.view, v))
            best = Math.max(best, scoreVertex(this.view, this.me, v, this.production) / (1 + d));
          const b = this.view.buildings[v];
          if (b && b.owner !== this.me) continue; // blocked
          for (const n of graph.vertexNeighbors[v] ?? []) {
            if (!seen.has(n)) {
              seen.add(n);
              next.push(n);
            }
          }
        }
        frontier = next;
      }
      return best;
    };

    return this.pick(edges, (e) => {
      const [a, b] = graph.edgeVertices[e]!;
      const far = mine.has(a) && !mine.has(b) ? b : mine.has(b) && !mine.has(a) ? a : b;
      return reach(far);
    });
  }

  // ------------------------------------------------------------ robber

  bestRobberHex(): HexId {
    const { graph, hexById: hexes } = boardInfo(this.view);
    return this.pick(this.legal.robberHexes, (h) => {
      let score = 0;
      for (const v of graph.hexVertices[h] ?? []) {
        const b = this.view.buildings[v];
        if (!b) continue;
        const weight = (b.kind === 'city' ? 2 : 1) * pips(hexes.get(h)?.token ?? null);
        if (b.owner === this.me) score -= weight * 3;
        else {
          const opp = this.view.players[b.owner]!;
          score += weight * (1 + opp.publicVP / 4) + (opp.resourceCount > 0 ? 1 : 0);
        }
      }
      return score;
    });
  }

  bestVictim(victims: readonly Seat[]): Seat {
    return this.pick(victims, (s) => {
      const p = this.view.players[s]!;
      return p.publicVP * 2 + p.resourceCount * 0.5;
    });
  }

  // ------------------------------------------------------------ discards

  chooseDiscard(count: number): ResourceCounts {
    const hand = { ...this.hand };
    const out: ResourceCounts = { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };
    const need = COSTS[this.target()];
    for (let i = 0; i < count; i++) {
      // Drop from the resource we hold the most of beyond what the target needs.
      const r = argmax(
        RESOURCES.filter((k) => hand[k] > 0),
        (k) => hand[k] - need[k] * 1.5,
      )!;
      hand[r]--;
      out[r]++;
    }
    return out;
  }

  // ------------------------------------------------------------ turn

  /** What we're saving for right now. */
  target(): BuildTarget {
    // The view and hand don't change during one decision, so compute this once.
    return (this.cachedTarget ??= this.computeTarget());
  }

  private cachedTarget: BuildTarget | undefined;

  private computeTarget(): BuildTarget {
    const me = this.view.players[this.me]!;
    const hasSettlement = Object.values(this.view.buildings).some(
      (b) => b.owner === this.me && b.kind === 'settlement',
    );
    if (hasSettlement && me.citiesLeft > 0 && (this.hand.ore >= 2 || this.hand.grain >= 2))
      return 'city';
    if (me.settlementsLeft > 0 && this.settlementSpots().length > 0) return 'settlement';
    if (hasSettlement && me.citiesLeft > 0) return 'city';
    if (this.view.devDeckCount > 0) return 'devCard';
    return 'road';
  }

  /** Spots where we could build a settlement once affordable (independent of phase). */
  settlementSpots(): VertexId[] {
    return buildableSettlementVertices(this.view, boardInfo(this.view).graph, this.me);
  }

  wantsKnight(beforeRoll: boolean): boolean {
    const { graph, hexById } = boardInfo(this.view);
    const robberHex = hexById.get(this.view.robber);
    const robberHurtsMe =
      pips(robberHex?.token ?? null) > 0 &&
      (graph.hexVertices[this.view.robber] ?? []).some(
        (v) => this.view.buildings[v]?.owner === this.me,
      );
    if (robberHurtsMe) return true;
    if (beforeRoll) return false;
    const mine = this.view.players[this.me]!.playedKnights + 1;
    const others = Math.max(
      0,
      ...this.view.players.filter((p) => p.seat !== this.me).map((p) => p.playedKnights),
    );
    return mine >= 3 && mine > others && this.view.largestArmy !== this.me;
  }

  /** One building step (city > settlement > road toward a spot > dev card), or null. */
  buildStep(): Action | null {
    const easySkip = this.opts.difficulty === 'easy' && this.opts.random() < 0.25;
    const L = this.legal;
    if (this.can('BUILD_CITY') && L.cityVertices.length > 0 && L.canAfford.city) {
      return {
        type: 'BUILD_CITY',
        vertex: this.pick(L.cityVertices, (v) =>
          scoreVertex(this.view, this.me, v, this.production),
        ),
      };
    }
    if (this.can('BUILD_SETTLEMENT') && L.settlementVertices.length > 0 && L.canAfford.settlement) {
      return { type: 'BUILD_SETTLEMENT', vertex: this.bestSetupVertex() };
    }
    if (easySkip) return null;
    const me = this.view.players[this.me]!;
    const wantRoad =
      me.settlementsLeft > 0 &&
      L.settlementVertices.length === 0 &&
      // Don't burn resources on roads when a city is within reach.
      !(this.target() === 'city' && sumCounts(missing(this.hand, COSTS.city)) <= 1);
    if (this.can('BUILD_ROAD') && L.canAfford.road && L.roadEdges.length > 0 && wantRoad) {
      return { type: 'BUILD_ROAD', edge: this.bestRoad(L.roadEdges) };
    }
    const afterDev = {
      ...this.hand,
      wool: this.hand.wool - 1,
      grain: this.hand.grain - 1,
      ore: this.hand.ore - 1,
    };
    const savingForCity =
      this.target() === 'city' &&
      L.cityVertices.length > 0 &&
      sumCounts(missing(afterDev, COSTS.city)) > sumCounts(missing(this.hand, COSTS.city));
    if (this.can('BUY_DEV') && L.canAfford.devCard && !savingForCity) return { type: 'BUY_DEV' };
    return null;
  }

  mainTurn(): Action {
    const confirm = this.confirmStep();
    if (confirm) return confirm;
    const dev = this.devStep();
    if (dev) return dev;
    const build = this.buildStep();
    if (build) return build;
    const offer = this.offerStep();
    if (offer) return offer;
    const trade = this.maritimeStep();
    if (trade) return trade;
    return this.closeTurn();
  }

  /**
   * Withdraw our open offers, then END_TURN. Only with a memo: a stateless bot can't tell a
   * withdrawn offer from one it never made and would re-offer it forever, so it ends the turn
   * directly (END_TURN closes every open offer anyway).
   */
  private closeTurn(): Action {
    const own = this.view.trades.find((t) => t.from === this.me);
    if (this.memo && own && this.can('CANCEL_TRADE')) {
      this.memo.closing = true;
      return { type: 'CANCEL_TRADE', offerId: own.id };
    }
    return { type: 'END_TURN' };
  }

  private devStep(): Action | null {
    const L = this.legal;
    if (this.can('PLAY_KNIGHT') && this.wantsKnight(false)) return { type: 'PLAY_KNIGHT' };
    const me = this.view.players[this.me]!;
    if (
      this.can('PLAY_ROAD_BUILDING') &&
      me.roadsLeft >= 2 &&
      me.settlementsLeft > 0 &&
      L.settlementVertices.length === 0
    ) {
      return { type: 'PLAY_ROAD_BUILDING' };
    }
    if (this.can('PLAY_YEAR_OF_PLENTY')) {
      const need = missing(this.hand, COSTS[this.target()]);
      const wants: Resource[] = [];
      for (const r of RESOURCES) for (let i = 0; i < need[r]; i++) wants.push(r);
      if (wants.length > 0 && wants.length <= 2) {
        const pickTwo = [wants[0]!, wants[1] ?? wants[0]!] as [Resource, Resource];
        const bankOk =
          pickTwo[0] === pickTwo[1]
            ? this.view.bank[pickTwo[0]] >= 2
            : this.view.bank[pickTwo[0]] >= 1 && this.view.bank[pickTwo[1]] >= 1;
        if (bankOk) return { type: 'PLAY_YEAR_OF_PLENTY', resources: pickTwo };
      }
    }
    if (this.can('PLAY_MONOPOLY') && this.view.turn.number >= 8) {
      const need = missing(this.hand, COSTS[this.target()]);
      const r = argmax([...RESOURCES], (k) => need[k] * 2 + (this.view.bank[k] < 8 ? 1 : 0));
      if (r && need[r] > 0) return { type: 'PLAY_MONOPOLY', resource: r };
    }
    return null;
  }

  /** Trade surplus with the bank only when it brings the current target within reach. */
  private maritimeStep(): Action | null {
    if (!this.can('MARITIME_TRADE') || this.opts.difficulty === 'easy') return null;
    const target = this.target();
    const cost = COSTS[target];
    const need = missing(this.hand, cost);
    const short = sumCounts(need);
    if (short === 0 || short > 2) return null;
    const get = RESOURCES.find((r) => need[r] > 0 && this.view.bank[r] > 0);
    if (!get) return null;
    const ratios = this.legal.maritimeRatios;
    const give = argmax(
      RESOURCES.filter((r) => r !== get && this.hand[r] - cost[r] >= ratios[r]),
      (r) => this.hand[r] - cost[r] - ratios[r],
    );
    if (!give) return null;
    return { type: 'MARITIME_TRADE', give, get };
  }

  // ------------------------------------------------------------ player trading

  /** Value we gain toward the current target by giving `give` and receiving `get`. */
  private gain(give: ResourceCounts, get: ResourceCounts): number {
    return tradeGain(this.hand, COSTS[this.target()], give, get);
  }

  /** Gain required before trading with `seat`: more if they lead or we pay more cards. */
  private acceptBar(seat: Seat, give: ResourceCounts, get: ResourceCounts): number {
    const other = this.view.players[seat]!;
    const leader = other.publicVP >= this.view.players[this.me]!.publicVP + 2 ? 0.8 : 0;
    const unfair = sumCounts(give) > sumCounts(get) ? 1 : 0;
    return 0.5 + leader + unfair;
  }

  /** Accept, reject or (hard) counter an offer addressed to us. */
  respondTo(offer: TradeOffer): Action {
    const reply = (response: 'accept' | 'reject'): Action => ({
      type: 'RESPOND_TRADE',
      offerId: offer.id,
      response,
    });
    // Our counter-offer replaces our answer to the original.
    if (this.view.trades.some((t) => t.from === this.me && t.counterTo === offer.id))
      return reply('reject');
    if (this.likesTrade(offer)) return reply('accept');
    return this.counterFor(offer) ?? reply('reject');
  }

  likesTrade(offer: TradeOffer): boolean {
    // We give what the offerer wants and receive what they give.
    const give = offer.want;
    const get = offer.give;
    if (!hasResources(this.hand, give)) return false;
    // Never feed a player who is about to win.
    if (nearVictory(this.view, offer.from)) return false;
    if (this.opts.difficulty === 'easy') return this.opts.random() < 0.3;
    return this.gain(give, get) > this.acceptBar(offer.from, give, get);
  }

  /**
   * Hard bots answer an unattractive offer from the active player with the simplest tweak that
   * would make it worth it to us: pay with a spare card instead of one we need ourselves, or
   * pay one card less. (Asking for extra cards rarely gets accepted, so we don't.)
   */
  private counterFor(offer: TradeOffer): Action | null {
    if (
      this.opts.difficulty !== 'hard' ||
      offer.counterTo !== null ||
      offer.from !== this.view.turn.current ||
      !this.can('OFFER_TRADE') ||
      nearVictory(this.view, offer.from)
    )
      return null;
    const cost = COSTS[this.target()];
    const need = missing(this.hand, cost);
    const asked = sumCounts(offer.want);
    const options: [give: ResourceCounts, want: ResourceCounts][] = [];
    // Only offer a substitute the offerer plausibly wants: one they ask for elsewhere, or one
    // they don't produce at all.
    const theirProduction = seatProduction(this.view, offer.from);
    const theyWant = (s: Resource) =>
      theirProduction[s] === 0 ||
      this.view.trades.some((t) => t.from === offer.from && t.want[s] > 0);
    for (const s of RESOURCES)
      if (need[s] === 0 && this.hand[s] - cost[s] >= asked && theyWant(s))
        options.push([counts({ [s]: asked }), offer.give]);
    if (asked > 1)
      for (const r of RESOURCES)
        if (offer.want[r] > 0)
          options.push([{ ...offer.want, [r]: offer.want[r] - 1 }, offer.give]);

    const best = argmax(
      options.filter(
        ([g, w]) =>
          validTrade(this.hand, g, w) &&
          offerKey(g, w) !== offerKey(offer.want, offer.give) &&
          this.gain(g, w) > this.acceptBar(offer.from, g, w),
      ),
      ([g, w]) => this.gain(g, w),
    );
    if (!best) return null;
    return {
      type: 'OFFER_TRADE',
      give: best[0],
      want: best[1],
      to: [offer.from],
      counterTo: offer.id,
    };
  }

  /** Close one of our offers with an accepting seat, preferring the one with the fewest VP. */
  private confirmStep(): Action | null {
    if (!this.can('CONFIRM_TRADE')) return null;
    for (const t of this.view.trades) {
      if (t.from !== this.me || t.counterTo !== null) continue;
      if (!hasResources(this.hand, t.give) || this.gain(t.give, t.want) <= 0) continue;
      const partners = Object.entries(t.responses)
        .filter(([, r]) => r === 'accept')
        .map(([s]) => Number(s))
        .filter(
          (s) =>
            this.view.players[s]!.resourceCount >= sumCounts(t.want) &&
            (this.opts.difficulty === 'easy' || !nearVictory(this.view, s)),
        );
      const partner = argmax(partners, (s) => -this.view.players[s]!.publicVP);
      if (partner !== undefined) return { type: 'CONFIRM_TRADE', offerId: t.id, with: partner };
    }
    return null;
  }

  /**
   * Ask the table for a card the current target is missing (one short; two for hard), paying with
   * spare cards: 1-for-1 first, then 2-for-1 (normal/hard). At most MAX_BOT_OFFERS_PER_TURN
   * offers per turn (one for easy, and only sometimes), never repeating one made this turn.
   */
  private offerStep(): Action | null {
    if (!this.can('OFFER_TRADE') || this.memo?.closing) return null;
    const d = this.opts.difficulty;
    const own = this.view.trades.filter((t) => t.from === this.me && t.counterTo === null);
    // Without a memo, our still-open offers are the record of what we tried this turn.
    const made = this.memo ? this.memo.offered.length : own.length;
    if (made >= (d === 'easy' ? 1 : MAX_BOT_OFFERS_PER_TURN)) return null;
    if (own.some((t) => Object.values(t.responses).includes('pending'))) return null;

    const others = this.view.players.filter((p) => p.seat !== this.me);
    const recipients = others
      .filter((p) => p.resourceCount > 0 && !(d === 'hard' && nearVictory(this.view, p.seat)))
      .map((p) => p.seat);
    if (recipients.length === 0) return null;

    const cost = COSTS[this.target()];
    const need = missing(this.hand, cost);
    const short = sumCounts(need);
    // Hard bots also trade toward a target two cards away; others only for the last card.
    if (short === 0 || short > (d === 'hard' ? 2 : 1)) return null;
    if (d === 'easy' && this.opts.random() >= 0.2) return null;

    const spare = RESOURCES.filter((r) => need[r] === 0 && this.hand[r] > cost[r]);
    const extra = (r: Resource) => this.hand[r] - cost[r];
    const tried = new Set([
      ...(this.memo?.offered ?? []),
      ...own.map((t) => offerKey(t.give, t.want)),
    ]);
    const options: { give: ResourceCounts; want: ResourceCounts; score: number }[] = [];
    for (const r of RESOURCES) {
      if (need[r] === 0) continue;
      const want = counts({ [r]: 1 });
      for (const [i, s] of spare.entries()) {
        // Cheapest to give: what we hold most of and produce most of.
        options.push({
          give: counts({ [s]: 1 }),
          want,
          score: 10 + extra(s) + this.production[s] * 0.1,
        });
        if (d === 'easy') continue;
        // 2-for-1 of one kind only when the bank wouldn't do it as cheaply.
        if (extra(s) >= 2 && this.legal.maritimeRatios[s] > 2)
          options.push({ give: counts({ [s]: 2 }), want, score: extra(s) });
        for (const s2 of spare.slice(i + 1))
          options.push({ give: counts({ [s]: 1, [s2]: 1 }), want, score: extra(s) + extra(s2) });
      }
    }
    const best = argmax(
      options.filter(
        (o) =>
          !tried.has(offerKey(o.give, o.want)) &&
          validTrade(this.hand, o.give, o.want) &&
          this.gain(o.give, o.want) > 0,
      ),
      (o) => o.score,
    );
    if (!best) return null;
    this.memo?.offered.push(offerKey(best.give, best.want));
    return {
      type: 'OFFER_TRADE',
      give: best.give,
      want: best.want,
      to: recipients.length === others.length ? null : recipients,
      counterTo: null,
    };
  }
}
