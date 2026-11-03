import { expect, test } from '@playwright/test';
import { newPlayer, startBotGame } from './helpers';

test('phone landscape: the game fits, and the tab rail switches panes', async ({ browser }) => {
  const alice = await newPlayer(browser, 'Alice', '/', { width: 844, height: 390 });
  const { page } = alice;
  await startBotGame(page);

  const noHorizontalScroll = () =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  await expect(page.getByTestId('board')).toBeInViewport();
  expect(await noHorizontalScroll()).toBe(true);

  const players = page.getByTestId('side-tab-players');
  const chat = page.getByTestId('side-tab-chat');
  const log = page.getByTestId('side-tab-log');
  await expect(players).toBeVisible();
  await expect(players).toHaveAttribute('aria-selected', 'true');

  await chat.click();
  await expect(chat).toHaveAttribute('aria-selected', 'true');
  await expect(players).toHaveAttribute('aria-selected', 'false');
  await expect(page.getByTestId('chat-send')).toBeVisible();

  await log.click();
  await expect(log).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('chat-send')).toBeHidden();

  // Tapping the open tab collapses the side pane so the board gets the full width.
  await log.click();
  await expect(log).toHaveAttribute('aria-selected', 'false');
  expect(await noHorizontalScroll()).toBe(true);
  expect(alice.errors).toEqual([]);
});
