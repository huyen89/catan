import {
  COSTS,
  RESOURCES,
  buildableRoadEdges,
  buildableSettlementVertices,
  emptyResources,
  hasResources,
  resourcesOf,
  totalResources,
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
import { argmax, boardInfo, missing, myHand, pips, seatProduction, type BuildTarget } from './eval';
import {
  SeaPlanner,
  chooseGold,
  buildableShipEdges,
  ownPirateLoss,
  ownShipsOn,
  pirateDamage,
  robberDamage,
  type EdgePlan,
} from './sea';
import {
  awaitingResponses,
  nearVictory,
  newMemo,
  offerKey,
  syncMemo,
  tradeGain,
  turnRoll,
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
export { awaitingResponses, newMemo, type BotMemo } from './trading';

/** Most offers a bot opens per turn (the engine allows more). */
export const MAX_BOT_OFFERS_PER_TURN = 2;

/** A ship plan scoring at least this (a good spot, usually with an island bonus) beats a city. */
export const STRONG_SHIP_PLAN = 4;

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
    case 'setup': {
      if (can('PLACE_SETTLEMENT'))
        return { type: 'PLACE_SETTLEMENT', vertex: bot.bestSetupVertex() };
      const plan = bot.bestPiece(
        can('PLACE_ROAD') ? legal.roadEdges : [],
        can('PLACE_SHIP') ? legal.shipEdges : [],
      );
      if (plan)
        return { type: plan.kind === 'road' ? 'PLACE_ROAD' : 'PLACE_SHIP', edge: plan.edge };
      break;
    }
    case 'discard':
      return { type: 'DISCARD', resources: bot.chooseDiscard(legal.discardCount) };
    case 'goldChoice':
      if (can('CHOOSE_GOLD'))
        return { type: 'CHOOSE_GOLD', resources: bot.chooseGold(legal.goldCount) };
      break;
    case 'moveRobber':
      return bot.moveRobberOrPirate();
    case 'steal':
      return { type: 'STEAL', victim: bot.bestVictim(legal.stealVictims) };
    case 'roadBuilding': {
      const plan = bot.bestPiece(
        can('BUILD_ROAD') ? legal.roadEdges : [],
        can('BUILD_SHIP') ? legal.shipEdges : [],
      );
      if (plan)
        return { type: plan.kind === 'road' ? 'BUILD_ROAD' : 'BUILD_SHIP', edge: plan.edge };
      break;
    }
    case 'preRoll':
      if (can('PLAY_KNIGHT') && bot.wantsKnight(true)) return { type: 'PLAY_KNIGHT' };
      return { type: 'ROLL' };
    case 'specialBuild':
      return bot.buildStep() ?? { type: 'PASS_SPECIAL_BUILD' };
    case 'main': {
      if (view.turn.current === me) return bot.mainTurn();
      // Not our turn and nothing to answer (callers normally don't ask us then).
      const withdraw = bot.withdrawCounter(() => true);
      if (withdraw) return withdraw;
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

/** What the viewer's bot is saving for right now (tests and debugging). */
export function buildTarget(view: PlayerView, opts: BotOptions): BuildTarget {
  if (view.viewer === null || !view.legal) throw new Error('bot: spectator view');
  return new Bot(view, view.viewer, opts, null).target();
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

  /** Road and ship planner for this decision (island bonuses included in spot values). */
  get planner(): SeaPlanner {
    return (this.cachedPlanner ??= new SeaPlanner(this.view, this.me, this.production));
  }

  private cachedPlanner: SeaPlanner | undefined;

  /** Value of a settlement on `v` for us (production, port, island bonus). */
  spotValue(v: VertexId): number {
    return this.planner.spotValue(v);
  }

  bestSetupVertex(): VertexId {
    return this.pick(this.legal.settlementVertices, (v) => this.spotValue(v));
  }

  /** The best road or ship among the candidates (by the spot it leads toward), or null. */
  bestPiece(roads: readonly EdgeId[], ships: readonly EdgeId[]): EdgePlan | null {
    return this.planner.best(roads, ships, () => this.noise());
  }

  /**
   * Where expansion should go next if no settlement spot is open: the best road or ship over
   * every edge we could build on (ignoring affordability). Null when nothing is buildable.
   */
  expansion(): EdgePlan | null {
    if (this.cachedExpansion !== undefined) return this.cachedExpansion;
    const L = this.legal;
    const roads = L.roadEdges.length > 0 ? L.roadEdges : this.buildableRoads();
    const ships = L.shipEdges.length > 0 ? L.shipEdges : this.buildableShips();
    // No noise: target() must stay stable within a turn.
    return (this.cachedExpansion = this.planner.best(roads, ships, () => 0));
  }

  private cachedExpansion: EdgePlan | null | undefined;

  private buildableRoads(): EdgeId[] {
    if (this.view.players[this.me]!.roadsLeft <= 0) return [];
    return buildableRoadEdges(this.view, boardInfo(this.view).graph, this.me);
  }

  private buildableShips(): EdgeId[] {
    if (this.view.players[this.me]!.shipsLeft <= 0) return [];
    return buildableShipEdges(this.view, this.me);
  }

  /**
   * Move one open-ended ship when another spot is clearly better: the ship's current line leads
   * nowhere useful (taken spot, dead end) and a free edge points at a good spot or new island.
   */
  moveShipStep(): Action | null {
    if (!this.can('MOVE_SHIP') || this.view.longestRoad === this.me) return null;
    let best: { from: EdgeId; to: EdgeId; gain: number } | null = null;
    for (const [from, targets] of Object.entries(this.legal.shipMoves)) {
      const end = this.planner.openEnd(from);
      const keep = end === null ? Infinity : this.planner.reach(end, 'ship');
      const lifted = this.planner.without(from);
      for (const to of targets) {
        const gain = lifted.edgeValue(to, 'ship') - keep;
        if (gain > 1 && (!best || gain > best.gain)) best = { from, to, gain };
      }
    }
    return best ? { type: 'MOVE_SHIP', from: best.from, to: best.to } : null;
  }

  // ------------------------------------------------------------ robber

  bestRobberHex(): HexId {
    return this.pick(this.legal.robberHexes, (h) => robberDamage(this.view, this.me, h));
  }

  /**
   * On a 7 or a knight: move the robber or (Open Seas) the pirate, whichever does more damage
   * to the leaders. Moving one leaves the other where it is, so whatever the other currently
   * does to us counts against choosing it.
   */
  moveRobberOrPirate(): Action {
    return this.robberOrPirate(this.legal.robberHexes, this.legal.pirateHexes);
  }

  /**
   * The robber/pirate choice over the given targets. Deterministic for a view (no noise), so
   * `wantsKnight` can ask what a knight would do and get the move the bot will then make.
   */
  private robberOrPirate(robberHexes: readonly HexId[], pirateHexes: readonly HexId[]): Action {
    const robber = argmax(robberHexes, (h) => robberDamage(this.view, this.me, h)) ?? null;
    const pirateDmg = (h: HexId) => pirateDamage(this.view, h, this.planner);
    const pirate =
      this.can('MOVE_PIRATE') || this.view.phase.kind !== 'moveRobber'
        ? (argmax(pirateHexes, pirateDmg) ?? null)
        : null;
    if (pirate === null) return { type: 'MOVE_ROBBER', hex: robber ?? robberHexes[0]! };
    if (robber === null) return { type: 'MOVE_PIRATE', hex: pirate };
    // What staying put costs us: the robber's grip on our hexes, the pirate's on our ships.
    const robberStays = -Math.min(0, robberDamage(this.view, this.me, this.view.robber));
    const pirateStays = ownPirateLoss(this.view, this.view.pirate, this.planner);
    const viaRobber = robberDamage(this.view, this.me, robber) - pirateStays;
    const viaPirate = pirateDmg(pirate) - robberStays;
    return viaPirate > viaRobber
      ? { type: 'MOVE_PIRATE', hex: pirate }
      : { type: 'MOVE_ROBBER', hex: robber };
  }

  /** What a knight played now would do: the same choice moveRobber will make. */
  knightMove(): Action {
    const hexes = this.view.board.hexes;
    const robberHexes = hexes
      .filter((h) => h.terrain !== 'sea' && h.id !== this.view.robber)
      .map((h) => h.id);
    const pirateHexes =
      this.view.pirate === null
        ? []
        : hexes.filter((h) => h.terrain === 'sea' && h.id !== this.view.pirate).map((h) => h.id);
    return this.robberOrPirate(robberHexes, pirateHexes);
  }

  bestVictim(victims: readonly Seat[]): Seat {
    return this.pick(victims, (s) => {
      const p = this.view.players[s]!;
      return p.publicVP * 2 + p.resourceCount * 0.5;
    });
  }

  // ------------------------------------------------------------ discards and gold

  /** Gold (Open Seas): resources toward the current target first. */
  chooseGold(count: number): ResourceCounts {
    return chooseGold(this.hand, this.production, this.view.bank, COSTS[this.target()], count);
  }

  chooseDiscard(count: number): ResourceCounts {
    const hand = { ...this.hand };
    const out = emptyResources();
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
    // Open Seas: with no spot open, a ship line toward a strong spot (in practice a new island
    // and its bonus) beats a city: ~3 VP for a few ships and a settlement.
    const spots = me.settlementsLeft > 0 ? this.settlementSpots().length : 0;
    const ship =
      me.settlementsLeft > 0 && me.shipsLeft > 0 && spots === 0 ? this.expansion() : null;
    const shipPlan = ship?.kind === 'ship' ? ship.score : 0;
    if (shipPlan >= STRONG_SHIP_PLAN) return 'ship';
    if (hasSettlement && me.citiesLeft > 0 && (this.hand.ore >= 2 || this.hand.grain >= 2))
      return 'city';
    if (spots > 0) return 'settlement';
    // Otherwise any ship line that leads to a spot: save for it.
    if (shipPlan > 0.5) return 'ship';
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
    // Open Seas: the pirate sits on our shipping line, and a knight would really move it.
    if (
      ownShipsOn(this.view, this.me, this.view.pirate) > 0 &&
      this.knightMove().type === 'MOVE_PIRATE'
    )
      return true;
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
        vertex: this.pick(L.cityVertices, (v) => this.spotValue(v)),
      };
    }
    if (this.can('BUILD_SETTLEMENT') && L.settlementVertices.length > 0 && L.canAfford.settlement) {
      return { type: 'BUILD_SETTLEMENT', vertex: this.bestSetupVertex() };
    }
    if (easySkip) return null;
    const piece = this.expandStep();
    if (piece) return piece;
    const afterDev = {
      ...this.hand,
      wool: this.hand.wool - 1,
      grain: this.hand.grain - 1,
      ore: this.hand.ore - 1,
    };
    const savingForCity =
      this.target() === 'city' &&
      L.cityVertices.length > 0 &&
      totalResources(missing(afterDev, COSTS.city)) >
        totalResources(missing(this.hand, COSTS.city));
    if (this.can('BUY_DEV') && L.canAfford.devCard && !savingForCity) return { type: 'BUY_DEV' };
    return null;
  }

  /**
   * A road or (Open Seas) a ship toward the next settlement spot, when no spot is open. Roads are
   * built as before even without a spot in reach; a ship only when it leads to one. If the better
   * piece is unaffordable we wait for it unless the other is nearly as good.
   */
  private expandStep(): Action | null {
    const L = this.legal;
    const me = this.view.players[this.me]!;
    const target = this.target();
    const want =
      me.settlementsLeft > 0 &&
      L.settlementVertices.length === 0 &&
      // Don't burn resources on roads or ships when a city is within reach.
      !(target === 'city' && totalResources(missing(this.hand, COSTS.city)) <= 1);
    if (!want) return null;
    const canShip = this.can('BUILD_SHIP') && L.canAfford.ship && L.shipEdges.length > 0;
    // Saving for a ship we can't pay yet: no road that spends the lumber it still needs.
    const roadSpendsShip =
      target === 'ship' && !canShip && this.hand.lumber - COSTS.road.lumber < COSTS.ship.lumber;
    const canRoad =
      this.can('BUILD_ROAD') && L.canAfford.road && L.roadEdges.length > 0 && !roadSpendsShip;
    if (!canRoad && !canShip) return null;
    // Compare noiseless values; noise only breaks ties between equally good edges.
    const value = (e: EdgeId, kind: 'road' | 'ship') =>
      this.planner.edgeValue(e, kind) + this.noise() * 1e-6;
    const bestOf = (edges: readonly EdgeId[], kind: 'road' | 'ship') => {
      const edge = argmax(edges, (e) => value(e, kind));
      return edge === undefined ? null : { edge, score: this.planner.edgeValue(edge, kind) };
    };
    const road = bestOf(L.roadEdges, 'road');
    const ship = bestOf(L.shipEdges, 'ship');
    const shipUseful = ship !== null && ship.score > 0.5;
    const shipBetter = shipUseful && (road === null || ship.score > road.score);
    if (canShip && shipUseful && (shipBetter || ship.score >= road!.score * 0.7))
      return { type: 'BUILD_SHIP', edge: ship.edge };
    if (canRoad && road && (!shipBetter || road.score >= ship!.score * 0.7))
      return { type: 'BUILD_ROAD', edge: road.edge };
    return null;
  }

  mainTurn(): Action {
    const confirm = this.confirmStep();
    if (confirm) return confirm;
    const dev = this.devStep();
    if (dev) return dev;
    const move = this.moveShipStep();
    if (move) return move;
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
      (me.roadsLeft >= 2 || (me.shipsLeft >= 2 && this.expansion()?.kind === 'ship')) &&
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

  /**
   * Trade surplus with the bank only when it brings the current target within reach. Easy bots
   * only do it for the last card of a settlement or city (without it they can stall forever).
   */
  private maritimeStep(): Action | null {
    if (!this.can('MARITIME_TRADE')) return null;
    const target = this.target();
    const cost = COSTS[target];
    const need = missing(this.hand, cost);
    const short = totalResources(need);
    if (short === 0 || short > 2) return null;
    if (
      this.opts.difficulty === 'easy' &&
      !(short === 1 && (target === 'settlement' || target === 'city'))
    )
      return null;
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
    const unfair = totalResources(give) > totalResources(get) ? 1 : 0;
    return 0.5 + leader + unfair;
  }

  /** Cancel one of our counter-offers matching `which`, if any. */
  withdrawCounter(which: (t: TradeOffer) => boolean): Action | null {
    if (!this.can('CANCEL_TRADE')) return null;
    const t = this.view.trades.find((o) => o.from === this.me && o.counterTo !== null && which(o));
    return t ? { type: 'CANCEL_TRADE', offerId: t.id } : null;
  }

  /** Accept, reject or (hard) counter an offer addressed to us. */
  respondTo(offer: TradeOffer): Action {
    // First clear out our counters that were rejected or whose original offer is gone.
    const stale = this.withdrawCounter(
      (t) =>
        !this.view.trades.some((o) => o.id === t.counterTo) ||
        Object.values(t.responses).every((r) => r === 'reject'),
    );
    if (stale) return stale;
    const reply = (response: 'accept' | 'reject'): Action => ({
      type: 'RESPOND_TRADE',
      offerId: offer.id,
      response,
    });
    // Our counter-offer replaces our answer to the original.
    if (this.view.trades.some((t) => t.from === this.me && t.counterTo === offer.id))
      return reply('reject');
    if (this.likesTrade(offer)) {
      // Accepting a counter to our own offer executes it at once.
      if (offer.counterTo !== null) this.memo?.partners.push(offer.from);
      return reply('accept');
    }
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
    const asked = totalResources(offer.want);
    const options: [give: ResourceCounts, want: ResourceCounts][] = [];
    // Only substitute a card the offerer has shown it needs: one it asks for in another of its
    // offers this turn. (Guessing from what they don't produce was almost never accepted.)
    const theyWant = (s: Resource) =>
      this.view.trades.some((t) => t.from === offer.from && t.counterTo === null && t.want[s] > 0);
    for (const s of RESOURCES)
      if (need[s] === 0 && this.hand[s] - cost[s] >= asked && theyWant(s))
        options.push([resourcesOf({ [s]: asked }), offer.give]);
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

  /**
   * Close one of our offers with an accepting seat: never one we already traded with this turn
   * (their hand changed since they answered) or one about to win; prefer seats holding a card or
   * more beyond what we ask for, then the fewest VP.
   */
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
            this.view.players[s]!.resourceCount >= totalResources(t.want) &&
            !this.memo?.partners.includes(s) &&
            (this.opts.difficulty === 'easy' || !nearVictory(this.view, s)),
        );
      const partner = argmax(partners, (s) => {
        const p = this.view.players[s]!;
        const comfortable = p.resourceCount > totalResources(t.want) ? 100 : 0;
        return comfortable - p.publicVP;
      });
      if (partner !== undefined) {
        this.memo?.partners.push(partner);
        return { type: 'CONFIRM_TRADE', offerId: t.id, with: partner };
      }
    }
    return null;
  }

  /**
   * Ask the table for a card the current target is missing (one short; two for hard), paying with
   * spare cards: 1-for-1 first, then 2-for-1 (normal/hard). At most MAX_BOT_OFFERS_PER_TURN
   * offers per turn (one for easy, and only sometimes), never repeating one made this turn, and
   * never addressed to a player about to win (except by easy bots).
   */
  private offerStep(): Action | null {
    if (!this.can('OFFER_TRADE') || this.memo?.closing) return null;
    const d = this.opts.difficulty;
    const own = this.view.trades.filter((t) => t.from === this.me && t.counterTo === null);
    // Without a memo, our still-open offers are the record of what we tried this turn.
    const made = this.memo ? this.memo.offered.length : own.length;
    if (made >= (d === 'easy' ? 1 : MAX_BOT_OFFERS_PER_TURN)) return null;
    if (awaitingResponses(this.view, this.me)) return null;

    const others = this.view.players.filter((p) => p.seat !== this.me);
    const recipients = others
      .filter((p) => p.resourceCount > 0 && (d === 'easy' || !nearVictory(this.view, p.seat)))
      .map((p) => p.seat);
    if (recipients.length === 0) return null;

    const cost = COSTS[this.target()];
    const need = missing(this.hand, cost);
    const short = totalResources(need);
    // Hard bots also trade toward a target two cards away; others only for the last card.
    if (short === 0 || short > (d === 'hard' ? 2 : 1)) return null;
    if (d === 'easy') {
      // One roll per turn, so asking again doesn't raise the odds.
      const roll = this.memo
        ? (this.memo.easyRoll ??= this.opts.random())
        : turnRoll(this.view, this.me);
      if (roll >= 0.2) return null;
    }

    const spare = RESOURCES.filter((r) => need[r] === 0 && this.hand[r] > cost[r]);
    const extra = (r: Resource) => this.hand[r] - cost[r];
    const tried = new Set([
      ...(this.memo?.offered ?? []),
      ...own.map((t) => offerKey(t.give, t.want)),
    ]);
    const options: { give: ResourceCounts; want: ResourceCounts; score: number }[] = [];
    for (const r of RESOURCES) {
      if (need[r] === 0) continue;
      const want = resourcesOf({ [r]: 1 });
      for (const [i, s] of spare.entries()) {
        // Cheapest to give: what we hold most of and produce most of.
        options.push({
          give: resourcesOf({ [s]: 1 }),
          want,
          score: 10 + extra(s) + this.production[s] * 0.1,
        });
        if (d === 'easy') continue;
        // 2-for-1 of one kind only when the bank wouldn't do it as cheaply.
        if (extra(s) >= 2 && this.legal.maritimeRatios[s] > 2)
          options.push({ give: resourcesOf({ [s]: 2 }), want, score: extra(s) });
        for (const s2 of spare.slice(i + 1))
          options.push({
            give: resourcesOf({ [s]: 1, [s2]: 1 }),
            want,
            score: extra(s) + extra(s2),
          });
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
