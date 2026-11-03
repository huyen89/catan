import { describe, expect, it } from 'vitest';
import { SCENARIO_IDS } from '@hexhaven/engine';
import { actionSchema } from './actions';
import { DEFAULT_ROOM_SETTINGS, roomSettingsSchema } from './room';

describe('Open Seas wire schemas', () => {
  it('accepts the new actions and rejects malformed ones', () => {
    const ok = [
      { type: 'PLACE_SHIP', edge: '0,-1,NE' },
      { type: 'BUILD_SHIP', edge: '2,1,W' },
      { type: 'MOVE_SHIP', from: '2,1,W', to: '3,1,NW' },
      { type: 'MOVE_PIRATE', hex: '-2,3' },
      { type: 'CHOOSE_GOLD', resources: { brick: 0, lumber: 1, wool: 0, grain: 1, ore: 0 } },
    ];
    for (const a of ok) expect(actionSchema.safeParse(a).success, a.type).toBe(true);
    const bad = [
      { type: 'BUILD_SHIP' },
      { type: 'MOVE_SHIP', from: '2,1,W' },
      { type: 'MOVE_PIRATE', hex: 'x' },
      { type: 'CHOOSE_GOLD', resources: { brick: -1, lumber: 0, wool: 0, grain: 0, ore: 0 } },
      { type: 'PLACE_SHIP', edge: '0,0,NE', extra: 1 },
    ];
    for (const a of bad) expect(actionSchema.safeParse(a).success, JSON.stringify(a)).toBe(false);
  });

  it('room settings take the seafarers variant and a known scenario', () => {
    for (const scenario of SCENARIO_IDS) {
      const s = { ...DEFAULT_ROOM_SETTINGS, variant: 'seafarers', scenario };
      expect(roomSettingsSchema.safeParse(s).success).toBe(true);
    }
    expect(roomSettingsSchema.safeParse(DEFAULT_ROOM_SETTINGS).success).toBe(true);
    expect(
      roomSettingsSchema.safeParse({ ...DEFAULT_ROOM_SETTINGS, scenario: 'atlantis' }).success,
    ).toBe(false);
  });
});
