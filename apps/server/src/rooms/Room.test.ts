import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM_SETTINGS, type RoomSettings } from '@hexhaven/shared';
import { OPEN_SEAS_PLAYABLE, Room } from './Room';

function filledRoom(settings: Partial<RoomSettings>): Room {
  const room = new Room('r1', 'ABCDEF', 'host', { ...DEFAULT_ROOM_SETTINGS, ...settings }, 0);
  room.sit({ userId: 'host', name: 'Host', avatarUrl: null }, 0);
  for (let seat = 1; seat < room.settings.maxSeats; seat++) room.addBot('host', seat, 'easy');
  return room;
}

describe('Room.startConfig for Open Seas', () => {
  it('is gated until the rules land', () => {
    expect(OPEN_SEAS_PLAYABLE).toBe(false);
    expect(() => filledRoom({ maxSeats: 3, variant: 'seafarers' }).startConfig('host')).toThrow(
      expect.objectContaining({ code: 'VARIANT_NOT_READY' }),
    );
  });

  it('passes the scenario only for the seafarers variant', () => {
    const sea = filledRoom({ maxSeats: 4, variant: 'seafarers', scenario: 'archipelago' });
    expect(sea.startConfig('host', { openSeas: true })).toMatchObject({
      players: 4,
      variant: 'seafarers',
      scenario: 'archipelago',
      numberMode: 'random',
    });
    const plain = filledRoom({ maxSeats: 3, variant: 'base', scenario: 'archipelago' });
    expect(Object.keys(plain.startConfig('host'))).not.toContain('scenario');
  });
});
