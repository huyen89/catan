import type { BoardGraph } from './hex/topology';
import type {
  Action,
  ActionType,
  EngineError,
  EngineErrorCode,
  GameEvent,
  GameState,
  Seat,
} from './types';
import type { VariantDef } from './variants';

/** Mutable context passed to rule handlers. `state` is a private deep copy; mutate freely. */
export interface Ctx {
  state: GameState;
  seat: Seat;
  events: GameEvent[];
  graph: BoardGraph;
  variant: VariantDef;
}

/** A handler mutates ctx.state and pushes events, or returns an error (state is then discarded). */
export type Handler<T extends ActionType> = (
  ctx: Ctx,
  action: Extract<Action, { type: T }>,
) => EngineError | void;

export type HandlerMap = { [K in ActionType]?: Handler<K> };

export const err = (code: EngineErrorCode, message: string): EngineError => ({ code, message });
