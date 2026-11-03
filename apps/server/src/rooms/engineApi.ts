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
import { BotPlayer, type BotOptions } from '@hexhaven/bot';

/** The subset of @hexhaven/engine the server depends on. Injected so tests can use a fake. */
export interface EngineApi {
  normalizeConfig(partial: Partial<GameConfig> & { players: number }): GameConfig;
  createGame(config: GameConfig, seed: string): GameState;
  /** Fill fields added by newer engine versions into a persisted state (idempotent). */
  upgradeState(state: GameState): GameState;
  applyAction(state: GameState, seat: Seat, action: Action): ApplyResult;
  toPlayerView(state: GameState, viewer: Seat | null): PlayerView;
  redactEvent(event: GameEvent, viewer: Seat | null): GameEvent | null;
  getPendingActors(state: GameState): Seat[];
}

/** One bot driving one seat; may keep memory between calls (e.g. offers made this turn). */
export interface SeatBot {
  /** Next action for `view.viewer`, from the redacted view only. */
  decide(view: PlayerView): Action;
}

/** Creates a fresh bot for a seat (a new one whenever control of the seat changes hands). */
export type BotFactory = (opts: BotOptions) => SeatBot;

export const realEngine: EngineApi = {
  normalizeConfig: engine.normalizeConfig,
  createGame: engine.createGame,
  upgradeState: engine.upgradeState,
  applyAction: engine.applyAction,
  toPlayerView: engine.toPlayerView,
  redactEvent: engine.redactEvent,
  getPendingActors: engine.getPendingActors,
};

export const realBots: BotFactory = (opts) => new BotPlayer(opts);
