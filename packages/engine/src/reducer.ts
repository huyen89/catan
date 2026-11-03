import { err, type Ctx, type Handler, type HandlerMap } from './context';
import { graphFor } from './hex/topology';
import { buildHandlers } from './rules/build';
import { devCardHandlers } from './rules/devcards';
import { maritimeHandlers } from './rules/maritime';
import { robberHandlers } from './rules/robber';
import { rollHandlers } from './rules/roll';
import { seafarersHandlers } from './rules/seafarers';
import { setupHandlers } from './rules/setup';
import { tradeHandlers } from './rules/trade';
import { turnHandlers } from './rules/turn';
import type { Action, ActionType, ApplyResult, GameState, Seat } from './types';
import { variantFor } from './variants';

/** Action type → handler. Each rules/* module owns its entries (see CLAUDE.md ownership map). */
export const HANDLERS: HandlerMap = {
  ...setupHandlers,
  ...rollHandlers,
  ...robberHandlers,
  ...buildHandlers,
  ...devCardHandlers,
  ...tradeHandlers,
  ...maritimeHandlers,
  ...turnHandlers,
  ...seafarersHandlers,
};

/**
 * Apply an action by `seat`. Pure: never mutates `state`.
 * On success returns a new state with version+1 and the emitted events.
 */
export function applyAction(state: GameState, seat: Seat, action: Action): ApplyResult {
  if (state.phase.kind === 'gameOver')
    return { ok: false, error: err('GAME_OVER', 'Game is over') };
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.players.length) {
    return { ok: false, error: err('INVALID_ACTION', 'Unknown seat') };
  }
  const type = action?.type;
  const handler =
    typeof type === 'string' && Object.hasOwn(HANDLERS, type)
      ? (HANDLERS[type as ActionType] as Handler<ActionType> | undefined)
      : undefined;
  if (!handler) {
    return { ok: false, error: err('NOT_IMPLEMENTED', `No handler for ${String(action?.type)}`) };
  }
  const ctx: Ctx = {
    state: structuredClone(state),
    seat,
    events: [],
    graph: graphFor(state.board),
    variant: variantFor(state.config),
  };
  const e = handler(ctx, action as never);
  if (e) return { ok: false, error: e };
  ctx.state.version = state.version + 1;
  return { ok: true, state: ctx.state, events: ctx.events };
}
