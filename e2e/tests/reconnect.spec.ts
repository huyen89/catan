import { expect, test } from '@playwright/test';
import { createRoom, newPlayer } from './helpers';

test('a disconnected player is covered by the AI and gets the seat back on return', async ({
  browser,
}) => {
  const alice = await newPlayer(browser, 'Alice');
  const code = await createRoom(alice.page);
  const bob = await newPlayer(browser, 'Bob', `/r/${code}`);
  await bob.page.getByTestId('sit-1').click();
  await bob.page.getByTestId('ready-toggle').click();
  await alice.page.getByTestId('fill-bots').click();
  await alice.page.getByTestId('start-game').click();
  await expect(bob.page.getByTestId('board')).toBeVisible();

  // Bob's network drops: close his tab (keep the cookie in the context).
  const bobContext = bob.context;
  await bob.page.close();
  await expect(alice.page.getByTestId('player-1')).toHaveAttribute('data-connected', 'false');
  // After the grace period (1.5s in TEST_MODE) the AI takes over his seat.
  await expect(alice.page.getByTestId('player-1')).toHaveAttribute('data-controller', 'bot', {
    timeout: 15_000,
  });

  // Bob comes back with the same session and gets his seat back.
  const back = await bobContext.newPage();
  await back.goto(`/r/${code}`);
  await expect(back.getByTestId('board')).toBeVisible();
  await expect(alice.page.getByTestId('player-1')).toHaveAttribute('data-controller', 'human', {
    timeout: 15_000,
  });
  await expect(alice.page.getByTestId('player-1')).toHaveAttribute('data-connected', 'true');
});
