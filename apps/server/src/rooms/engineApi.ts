import * as engine from '@hexhaven/engine';
import type {
  Action,
  ApplyResult,
  GameConfig,
  GameEvent,
  GameState,
  PlayerView,
  Seat,
} from '@hexhaven/engine';
import { decide as botDecide, type BotOptions } from '@hexhaven/bot';

/** The subset of @hexhaven/engine the server depends on. Injected so tests can use a fake. */
export interface EngineApi {
  normalizeConfig(partial: Partial<GameConfig> & { players: number }): GameConfig;
  createGame(config: GameConfig, seed: string): GameState;
  applyAction(state: GameState, seat: Seat, action: Action): ApplyResult;
  toPlayerView(state: GameState, viewer: Seat | null): PlayerView;
  redactEvent(event: GameEvent, viewer: Seat | null): GameEvent | null;
  getPendingActors(state: GameState): Seat[];
}

/** Bot policy: next action for `view.viewer`, from the redacted view only. */
export type BotDecide = (view: PlayerView, opts: BotOptions) => Action;

export const realEngine: EngineApi = {
  normalizeConfig: engine.normalizeConfig,
  createGame: engine.createGame,
  applyAction: engine.applyAction,
  toPlayerView: engine.toPlayerView,
  redactEvent: engine.redactEvent,
  getPendingActors: engine.getPendingActors,
};

export const realDecide: BotDecide = botDecide;
