import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROOM_SETTINGS,
  effectiveScenario as sharedEffectiveScenario,
  mergeRoomSettings,
  type RoomSettings,
} from '@hexhaven/shared';
import {
  effectiveScenario,
  effectiveVariant,
  rematchRole,
  scenarioName,
  scenarioOptions,
  settingsPatch,
  startErrorText,
} from './lobby';

describe('rematchRole', () => {
  const room = { hostUserId: 'u1' };
  it('gives the host the Play again button and others the waiting note', () => {
    expect(rematchRole(room, 'u1')).toBe('host');
    expect(rematchRole(room, 'u2')).toBe('guest');
  });
  it('is none without a room or a signed-in user', () => {
    expect(rematchRole(null, 'u1')).toBe('none');
    expect(rematchRole(room, null)).toBe('none');
    expect(rematchRole(room, undefined)).toBe('none');
  });
});

describe('Open Seas lobby settings', () => {
  const sea: RoomSettings = { ...DEFAULT_ROOM_SETTINGS, variant: 'seafarers' };

  it('lists every scenario with its engine name and player range', () => {
    const opts = scenarioOptions(4);
    expect(opts.map((o) => o.id)).toEqual(['newShores', 'archipelago', 'grandVoyage']);
    expect(opts.map((o) => o.name)).toEqual(['New Shores', 'Archipelago', 'Grand Voyage']);
    expect(opts.map((o) => o.range)).toEqual(['3–4 players', '3–4 players', '5–6 players']);
    expect(opts.map((o) => o.fits)).toEqual([true, true, false]);
    expect(scenarioOptions(6).map((o) => o.fits)).toEqual([false, false, true]);
    expect(scenarioName('grandVoyage')).toBe('Grand Voyage');
    expect(scenarioName('toString')).toBeNull();
    expect(scenarioName(undefined)).toBeNull();
  });

  it('never sends vpToWin itself, so the server picks the scenario target', () => {
    const patch = settingsPatch(DEFAULT_ROOM_SETTINGS, { variant: 'seafarers' });
    expect(patch).toEqual({ variant: 'seafarers' });
    expect(mergeRoomSettings(DEFAULT_ROOM_SETTINGS, patch).vpToWin).toBe(14);
    const arch = settingsPatch(sea, { scenario: 'archipelago' });
    expect(mergeRoomSettings(sea, arch).vpToWin).toBe(13);
  });

  it('swaps a scenario that does not fit the new seat count', () => {
    const arch: RoomSettings = { ...sea, scenario: 'archipelago' };
    expect(settingsPatch(arch, { maxSeats: 6 })).toEqual({ maxSeats: 6, scenario: 'grandVoyage' });
    expect(settingsPatch(arch, { maxSeats: 3 })).toEqual({ maxSeats: 3 });
    // Without an explicit scenario the server already follows the seat count.
    expect(settingsPatch(sea, { maxSeats: 6 })).toEqual({ maxSeats: 6 });
    // Leaving Open Seas keeps the (ignored) scenario as it is.
    expect(settingsPatch(arch, { variant: 'base', maxSeats: 4 })).toEqual({
      variant: 'base',
      maxSeats: 4,
    });
  });

  it('turns spiral numbering off away from the standard board', () => {
    const spiral: RoomSettings = {
      ...DEFAULT_ROOM_SETTINGS,
      variant: 'base',
      numberMode: 'spiral',
    };
    expect(settingsPatch(spiral, { variant: 'seafarers' })).toEqual({
      variant: 'seafarers',
      numberMode: 'random',
    });
    expect(effectiveVariant({ variant: 'seafarers', maxSeats: 4 })).toBe('seafarers');
  });

  it('picks the same scenario as the server', () => {
    for (const maxSeats of [3, 4, 5, 6])
      for (const scenario of [undefined, 'newShores', 'archipelago', 'grandVoyage'] as const) {
        const s = { maxSeats, ...(scenario && { scenario }) };
        expect(effectiveScenario(s)).toBe(sharedEffectiveScenario(s));
      }
  });

  it('explains a refused Open Seas start', () => {
    expect(startErrorText('VARIANT_NOT_READY')).toMatch(/Open Seas/);
    expect(startErrorText('NOT_READY')).toBeNull();
  });
});
