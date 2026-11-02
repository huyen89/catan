/** Vitest assertions shared by engine tests. */
import { expect } from 'vitest';
import { applyAction } from '../reducer';
import type { Action, EngineErrorCode, GameEvent, GameState, Seat } from '../types';

/** The action must succeed; returns the new state and events. */
export function expectOk(
  state: GameState,
  seat: Seat,
  action: Action,
): { state: GameState; events: GameEvent[] } {
  const before = structuredClone(state);
  const res = applyAction(state, seat, action);
  if (!res.ok) expect.fail(`${action.type} by ${seat} rejected: ${res.error.message}`);
  expect(state).toEqual(before);
  expect(res.state.version).toBe(state.version + 1);
  return { state: res.state, events: res.events };
}

/** The action must be rejected (optionally with `code`) and leave the input state untouched. */
export function expectRejected(
  state: GameState,
  seat: Seat,
  action: Action,
  code?: EngineErrorCode,
): void {
  const before = structuredClone(state);
  const res = applyAction(state, seat, action);
  expect(res.ok, `${action.type} by ${seat} should be rejected`).toBe(false);
  if (!res.ok && code) expect(res.error.code).toBe(code);
  expect(state).toEqual(before);
}

/** Events of one type. */
export function eventsOf<T extends GameEvent['type']>(
  events: GameEvent[],
  type: T,
): Array<Extract<GameEvent, { type: T }>> {
  return events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}
