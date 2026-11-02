import { expect, test } from '@playwright/test';
import { autoplay, createRoom, newPlayer } from './helpers';

test('a human and two bots play a 3-player game to the end', async ({ browser }) => {
  test.setTimeout(300_000);
  const alice = await newPlayer(browser, 'Alice');
  await createRoom(alice.page);
  await alice.page.getByTestId('settings-max-seats').selectOption('3');
  await alice.page.getByTestId('fill-bots').click();
  await expect(alice.page.getByTestId('start-game')).toBeEnabled();
  await alice.page.getByTestId('start-game').click();
  await expect(alice.page.getByTestId('board')).toBeVisible();

  await autoplay([alice.page], 270_000);
  await expect(alice.page.getByTestId('game-over')).toBeVisible();
  expect(alice.errors).toEqual([]);
});
