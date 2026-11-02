/** Shared turn-flow helpers: phase/actor guards, turn start, victory, payments. */
import { err, type Ctx, type Handler, type HandlerMap } from '../context';
import { addResources, COSTS, emptyResources, hasResources, subtractResources } from '../resources';
import { RESOURCES } from '../types';
import type {
  ActionType,
  Resource,
  EngineError,
  GameState,
  Hex,
  HexId,
  PhaseKind,
  ResourceCounts,
  Seat,
} from '../types';
import { totalVP } from './victory';

/** Error unless the phase is one of `kinds`. */
export function expectPhase(ctx: Ctx, ...kinds: PhaseKind[]): EngineError | undefined {
  if (!kinds.includes(ctx.state.phase.kind)) {
    return err('WRONG_PHASE', `Not allowed during ${ctx.state.phase.kind}`);
  }
  return undefined;
}

/** Error unless the acting seat is `seat`. */
export function expectSeat(ctx: Ctx, seat: Seat | null): EngineError | undefined {
  return ctx.seat === seat ? undefined : err('NOT_YOUR_TURN', 'Not your turn');
}

/** Seat allowed to build/buy right now (main: current player; specialBuild: phase.seat). */
export function builderSeat(state: GameState): Seat | null {
  if (state.phase.kind === 'main') return state.turn.current;
  if (state.phase.kind === 'specialBuild') return state.phase.seat;
  return null;
}

export function hexById(state: GameState, id: HexId): Hex | undefined {
  return state.board.hexes.find((h) => h.id === id);
}

export const isResource = (r: unknown): r is Resource => RESOURCES.includes(r as Resource);

/** Copy only the five resource keys of a (validated) counts object. */
export function counts(r: ResourceCounts): ResourceCounts {
  const out = emptyResources();
  for (const k of RESOURCES) out[k] = r[k];
  return out;
}

/** Pay a build cost to the bank, or return an error. */
export function pay(ctx: Ctx, seat: Seat, item: keyof typeof COSTS): EngineError | undefined {
  const p = ctx.state.players[seat]!;
  if (!hasResources(p.resources, COSTS[item])) {
    return err('INSUFFICIENT_RESOURCES', `Cannot afford ${item}`);
  }
  subtractResources(p.resources, COSTS[item]);
  addResources(ctx.state.bank, COSTS[item]);
  return undefined;
}

/** Declare the current player the winner if they have reached vpToWin. */
export function checkVictory(ctx: Ctx): void {
  const s = ctx.state;
  if (s.phase.kind === 'setup' || s.phase.kind === 'gameOver') return;
  const seat = s.turn.current;
  if (totalVP(s, seat) < s.config.vpToWin) return;
  s.phase = { kind: 'gameOver', winner: seat };
  s.winner = seat;
  ctx.events.push({ type: 'gameOver', winner: seat, vp: s.players.map((p) => totalVP(s, p.seat)) });
}

/**
 * Start `seat`'s regular turn. Dev cards it bought before this turn (e.g. during a Special
 * Building Phase) become playable. A player who reached vpToWin off-turn wins here.
 */
export function startTurn(ctx: Ctx, seat: Seat): void {
  const s = ctx.state;
  s.turn = { current: seat, number: s.turn.number + 1, dice: null, devPlayed: false };
  const p = s.players[seat]!;
  p.devCards.push(...p.newDevCards);
  p.newDevCards = [];
  s.phase = { kind: 'preRoll' };
  ctx.events.push({ type: 'turnStarted', seat, turn: s.turn.number });
  checkVictory(ctx);
}

/** Wrap every handler so the current player's victory is checked after each successful action. */
export function withVictoryCheck(map: HandlerMap): HandlerMap {
  const out: Record<string, Handler<ActionType>> = {};
  for (const [type, handler] of Object.entries(map) as Array<[string, Handler<ActionType>]>) {
    out[type] = (ctx, action) => {
      const e = handler(ctx, action);
      if (e) return e;
      checkVictory(ctx);
    };
  }
  return out as HandlerMap;
}
