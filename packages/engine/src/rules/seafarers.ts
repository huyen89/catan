/**
 * Open Seas ('seafarers') actions. Registered as NOT_IMPLEMENTED stubs by the contract PR so the
 * handler table is complete; ENG replaces them with the rules in docs/SEAFARERS.md.
 */
import { err, type Handler, type HandlerMap } from '../context';
import type { ActionType } from '../types';

const notImplemented =
  <T extends ActionType>(type: T): Handler<T> =>
  () =>
    err('NOT_IMPLEMENTED', `${type} is not implemented yet`);

/** PLACE_SHIP, BUILD_SHIP, MOVE_SHIP, MOVE_PIRATE, CHOOSE_GOLD. */
export const seafarersHandlers: HandlerMap = {
  PLACE_SHIP: notImplemented('PLACE_SHIP'),
  BUILD_SHIP: notImplemented('BUILD_SHIP'),
  MOVE_SHIP: notImplemented('MOVE_SHIP'),
  MOVE_PIRATE: notImplemented('MOVE_PIRATE'),
  CHOOSE_GOLD: notImplemented('CHOOSE_GOLD'),
};
