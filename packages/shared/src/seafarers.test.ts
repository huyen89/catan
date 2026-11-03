import { describe, expect, it } from 'vitest';
import { SCENARIO_IDS } from '@hexhaven/engine';
import { actionSchema } from './actions';
import { DEFAULT_ROOM_SETTINGS, mergeRoomSettings, roomSettingsSchema } from './room';

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

  it('mergeRoomSettings applies scenario VP targets unless the patch sets vpToWin', () => {
    const d = DEFAULT_ROOM_SETTINGS;
    expect(mergeRoomSettings(d, { variant: 'seafarers' }).vpToWin).toBe(14);
    expect(mergeRoomSettings(d, { variant: 'seafarers', scenario: 'archipelago' }).vpToWin).toBe(
      13,
    );
    expect(mergeRoomSettings(d, { variant: 'seafarers', vpToWin: 9 }).vpToWin).toBe(9);
    const sea = {
      ...d,
      variant: 'seafarers' as const,
      scenario: 'archipelago' as const,
      vpToWin: 11,
    };
    expect(mergeRoomSettings(sea, { turnTimerSec: 30 }).vpToWin).toBe(11);
    expect(mergeRoomSettings(sea, { scenario: 'archipelago' }).vpToWin).toBe(11);
    expect(mergeRoomSettings(sea, { scenario: 'newShores' }).vpToWin).toBe(14);
    // Without an explicit scenario the seat count picks it: 6 seats -> grandVoyage.
    const auto = { ...d, variant: 'seafarers' as const, maxSeats: 4, vpToWin: 11 };
    expect(mergeRoomSettings(auto, { maxSeats: 6 }).vpToWin).toBe(14);
    expect(mergeRoomSettings(sea, { variant: 'base' }).vpToWin).toBe(10);
    expect(mergeRoomSettings(d, { maxSeats: 5 }).vpToWin).toBe(10);
    expect(mergeRoomSettings(d, { vpToWin: undefined })).toEqual(d);
  });
});
