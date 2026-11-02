import {
  COSTS,
  RESOURCES,
  buildableSettlementVertices,
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

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotOptions {
  difficulty: BotDifficulty;
  /** Random source in [0,1). Server passes Math.random; the simulator passes a seeded RNG. */
  random: () => number;
}

export { pips, scoreVertex } from './eval';

/**
 * Decide the next action for `view.viewer` given ONLY its redacted view (no hidden info).
 * Always returns an action drawn from `view.legal`; throws if the viewer has nothing to do.
 */
export function decide(view: PlayerView, opts: BotOptions): Action {
  const me = view.viewer;
  const legal = view.legal;
  if (me === null || !legal || legal.actions.length === 0) {
    throw new Error(`bot: seat ${String(me)} has no legal action`);
  }
  const can = (t: Action['type']) => legal.actions.includes(t);
  const bot = new Bot(view, me, opts);

  // Answer trade offers addressed to us first (works for both active and other players).
  if (can('RESPOND_TRADE')) {
    const offer = view.trades.find((t) => t.responses[String(me)] === 'pending');
    if (offer) {
      return {
        type: 'RESPOND_TRADE',
        offerId: offer.id,
        response: bot.likesTrade(offer) ? 'accept' : 'reject',
      };
    }
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

class Bot {
  private readonly hand: ResourceCounts;
  private readonly production: ResourceCounts;
  private readonly can: (t: Action['type']) => boolean;

  constructor(
    private readonly view: PlayerView,
    private readonly me: Seat,
    private readonly opts: BotOptions,
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
    const dev = this.devStep();
    if (dev) return dev;
    const build = this.buildStep();
    if (build) return build;
    const trade = this.maritimeStep();
    if (trade) return trade;
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

  // ------------------------------------------------------------ trading

  likesTrade(offer: TradeOffer): boolean {
    // We give what the offerer wants and receive what they give.
    const give = offer.want;
    const get = offer.give;
    for (const r of RESOURCES) if (this.hand[r] < give[r]) return false;
    const other = this.view.players[offer.from]!;
    if (other.publicVP >= this.view.config.vpToWin - 2) return false;
    if (this.opts.difficulty === 'easy') return this.opts.random() < 0.3;

    const cost = COSTS[this.target()];
    const value = (r: Resource, delta: number) => {
      const after = this.hand[r] + delta;
      const needed = cost[r];
      // Cards up to what the target needs are worth a lot; surplus is cheap.
      return Math.min(after, needed) * 2 + Math.max(0, after - needed) * 0.6;
    };
    let before = 0;
    let afterTrade = 0;
    for (const r of RESOURCES) {
      before += value(r, 0);
      afterTrade += value(r, get[r] - give[r]);
    }
    const leaderBonus = other.publicVP >= this.view.players[this.me]!.publicVP + 2 ? 0.8 : 0;
    return afterTrade - before > 0.5 + leaderBonus;
  }
}
