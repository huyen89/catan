import { describe, expect, it } from 'vitest';
import { frameCaption, humanizeAction, positionLabel, stepDelay } from './caption';
import type { FrameMeta } from './timeline';

const ctx = { name: (s: number) => ['Ann', 'Bob'][s] ?? `P${s}`, hexLabel: (h: string) => h };
const meta = (patch: Partial<FrameMeta>): FrameMeta => ({
  seat: 0,
  action: { type: 'ROLL' },
  events: [],
  ts: 0,
  turn: 1,
  active: 0,
  ...patch,
});

describe('replay captions', () => {
  it('uses the event log text for the frame', () => {
    expect(
      frameCaption(meta({ events: [{ type: 'rolled', seat: 1, dice: [2, 3], total: 5 }] }), ctx),
    ).toEqual([{ text: 'Bob rolled 2 + 3 = 5', seat: 1 }]);
  });

  it('falls back to the action when there are no events, and names the start', () => {
    expect(frameCaption(meta({ action: { type: 'END_TURN' } }), ctx)).toEqual([
      { text: 'Ann: end turn', seat: 0 },
    ]);
    expect(frameCaption(meta({ seat: null, action: null }), ctx)).toEqual([
      { text: 'Game start', seat: null },
    ]);
    expect(humanizeAction('PLAY_YEAR_OF_PLENTY')).toBe('play year of plenty');
  });

  it('labels the position and converts speeds to delays', () => {
    expect(positionLabel(0, 11)).toBe('Start (10 actions)');
    expect(positionLabel(4, 11)).toBe('Action 4 of 10');
    expect(stepDelay(1)).toBe(800);
    expect(stepDelay(4)).toBe(200);
    expect(stepDelay(0)).toBe(800);
  });
});
