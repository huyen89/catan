import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM_SETTINGS, type RoomSettings } from '@hexhaven/shared';
import { Room } from './Room';

function filledRoom(settings: Partial<RoomSettings>): Room {
  const room = new Room('r1', 'ABCDEF', 'host', { ...DEFAULT_ROOM_SETTINGS, ...settings }, 0);
  room.sit({ userId: 'host', name: 'Host', avatarUrl: null }, 0);
  for (let seat = 1; seat < room.settings.maxSeats; seat++) room.addBot('host', seat, 'easy');
  return room;
}

describe('Room.startConfig for Open Seas', () => {
  it('refuses a scenario that does not fit the seat count', () => {
    expect(() =>
      filledRoom({ maxSeats: 3, variant: 'seafarers', scenario: 'grandVoyage' }).startConfig(
        'host',
      ),
    ).toThrow(
      expect.objectContaining({ code: 'INVALID_VARIANT', message: expect.stringMatching(/5-6/) }),
    );
    expect(() =>
      filledRoom({ maxSeats: 5, variant: 'seafarers', scenario: 'newShores' }).startConfig('host'),
    ).toThrow(expect.objectContaining({ code: 'INVALID_VARIANT' }));
    // Without a scenario the seat count picks one that fits.
    expect(filledRoom({ maxSeats: 5, variant: 'seafarers' }).startConfig('host')).toMatchObject({
      variant: 'seafarers',
      players: 5,
    });
  });

  it('passes the scenario only for the seafarers variant', () => {
    const sea = filledRoom({ maxSeats: 4, variant: 'seafarers', scenario: 'archipelago' });
    expect(sea.startConfig('host')).toMatchObject({
      players: 4,
      variant: 'seafarers',
      scenario: 'archipelago',
      numberMode: 'random',
    });
    const plain = filledRoom({ maxSeats: 3, variant: 'base', scenario: 'archipelago' });
    expect(Object.keys(plain.startConfig('host'))).not.toContain('scenario');
  });
});
