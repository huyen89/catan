import { expect, test } from '@playwright/test';
import { autoplay, newPlayer, startBotGame } from './helpers';

test('finish a game, play again, then watch its replay from the history', async ({ browser }) => {
  test.setTimeout(240_000);
  const alice = await newPlayer(browser, 'Alice');
  const { page } = alice;
  // A short game (5 VP) keeps this test quick.
  await startBotGame(page, { vpToWin: 5 });
  await autoplay([page], 180_000);
  await expect(page.getByTestId('game-over')).toBeVisible();

  // Rematch: back to the lobby with the same seats, and the next game starts.
  await page.getByTestId('rematch').click();
  await expect(page.getByTestId('start-game')).toBeEnabled();
  await expect(page.getByTestId('board')).toBeHidden();
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('board')).toBeVisible();

  // History lists the finished game (and the new, running one) and opens its replay.
  await page.goto('/history');
  const list = page.getByTestId('history-list');
  await expect(list).toBeVisible();
  await expect(list.locator('li.history-item')).toHaveCount(2);
  const replayLink = list.locator('a[data-testid^="replay-"]');
  await expect(replayLink).toHaveCount(1);
  await replayLink.click();

  await expect(page.getByTestId('replay')).toBeVisible();
  const caption = page.getByTestId('replay-caption');
  await expect(caption).toContainText('Start (');
  await page.getByTestId('replay-step').click();
  await expect(caption).toContainText('Action 1 of');
  await page.getByRole('button', { name: 'Go to end' }).click();
  await expect(page.getByTestId('replay-step')).toBeDisabled();
  await expect(page.locator('[data-testid^="replay-player-"] .badge')).toHaveText('winner');
  await expect(page.getByTestId('replay-warning')).toHaveCount(0);
  expect(alice.errors).toEqual([]);
});
