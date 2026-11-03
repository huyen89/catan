import { describe, expect, it } from 'vitest';
import { rematchRole } from './lobby';

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
