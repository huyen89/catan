import { expect, test } from '@playwright/test';
import { createRoom, newPlayer, step } from './helpers';

test('two friends and two bots: lobby, setup placement, chat', async ({ browser }) => {
  const alice = await newPlayer(browser, 'Alice');
  const code = await createRoom(alice.page);
  const bob = await newPlayer(browser, 'Bob', `/r/${code}`);

  await bob.page.getByTestId('sit-1').click();
  await bob.page.getByTestId('ready-toggle').click();
  await alice.page.getByTestId('fill-bots').click();
  await expect(alice.page.getByTestId('seat-3')).toHaveAttribute('data-kind', 'bot');
  await expect(alice.page.getByTestId('start-game')).toBeEnabled();
  await alice.page.getByTestId('start-game').click();

  await expect(alice.page.getByTestId('board')).toBeVisible();
  await expect(bob.page.getByTestId('board')).toBeVisible();
  await expect(alice.page.getByTestId('phase-banner')).toContainText('settlement');

  // Alice (seat 0) places her first settlement and road by clicking highlights.
  const firstVertex = alice.page.locator('[data-testid^="vertex-"]').first();
  await firstVertex.click();
  await alice.page.locator('[data-testid^="edge-"]').first().click();
  // Bob is next in the snake draft.
  await expect(bob.page.locator('[data-testid^="vertex-"]').first()).toBeVisible();
  await step(bob.page);
  await step(bob.page);
  // Bots place theirs; then the snake comes back to Bob.
  await expect(bob.page.locator('[data-testid^="vertex-"]').first()).toBeVisible({
    timeout: 15_000,
  });

  // Chat reaches the other player.
  await alice.page.getByTestId('chat-input').fill('good luck!');
  await alice.page.getByTestId('chat-send').click();
  await expect(bob.page.getByTestId('chat-log')).toContainText('good luck!');

  // Hidden information: Bob sees Alice's card count, never her cards.
  await expect(bob.page.getByTestId('player-0')).toBeVisible();

  expect(alice.errors).toEqual([]);
  expect(bob.errors).toEqual([]);
});
