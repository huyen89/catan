import { expect, test } from '@playwright/test';
import { createRoom, newPlayer } from './helpers';

test('two players connect a voice call and see each other mute/unmute', async ({ browser }) => {
  const alice = await newPlayer(browser, 'Alice');
  const code = await createRoom(alice.page);
  const bob = await newPlayer(browser, 'Bob', `/r/${code}`);
  await expect(bob.page.getByTestId('room-code')).toHaveText(code);

  await alice.page.getByTestId('voice-join').click();
  await bob.page.getByTestId('voice-join').click();

  const bobOnAlice = alice.page.locator('[data-testid^="voice-peer-"]').first();
  await expect(bobOnAlice).toHaveAttribute('data-connection', 'connected', { timeout: 20_000 });
  const aliceOnBob = bob.page.locator('[data-testid^="voice-peer-"]').first();
  await expect(aliceOnBob).toHaveAttribute('data-connection', 'connected', { timeout: 20_000 });

  // Joining starts muted; Bob unmutes and Alice sees it.
  await expect(bobOnAlice).toHaveAttribute('data-muted', 'true');
  await bob.page.getByTestId('voice-mute-toggle').click();
  await expect(bobOnAlice).toHaveAttribute('data-muted', 'false', { timeout: 10_000 });

  await bob.page.getByTestId('voice-leave').click();
  await expect(bobOnAlice).toHaveCount(0, { timeout: 10_000 });
});
