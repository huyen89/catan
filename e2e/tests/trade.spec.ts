import { expect, test } from '@playwright/test';
import { createRoom, newPlayer, step } from './helpers';

test('player-to-player trade: offer, accept, confirm', async ({ browser }) => {
  test.setTimeout(120_000);
  const alice = await newPlayer(browser, 'Alice');
  const code = await createRoom(alice.page);
  // Settings first: changing them clears everyone's ready flag.
  await alice.page.getByTestId('settings-max-seats').selectOption('3');
  const bob = await newPlayer(browser, 'Bob', `/r/${code}`);
  await bob.page.getByTestId('sit-1').click();
  await bob.page.getByTestId('ready-toggle').click();
  await alice.page.getByTestId('fill-bots').click();
  await expect(alice.page.getByTestId('start-game')).toBeEnabled();
  await alice.page.getByTestId('start-game').click();
  await expect(alice.page.getByTestId('board')).toBeVisible();

  // Play setup + Alice's roll until she can end her turn (main phase).
  for (let i = 0; i < 200; i++) {
    const end = alice.page.getByTestId('end-turn');
    if ((await end.isVisible()) && (await end.isEnabled())) break;
    if ((await step(alice.page)) === 'idle') await step(bob.page);
    await alice.page.waitForTimeout(50);
  }
  await expect(alice.page.getByTestId('end-turn')).toBeEnabled();

  // Make the trade possible regardless of dice: Alice gets brick, Bob gets ore.
  const give = (seat: number, resources: Record<string, number>) =>
    alice.page.request.post(`/api/test/rooms/${code}/give`, { data: { seat, resources } });
  expect((await give(0, { brick: 1 })).ok()).toBe(true);
  expect((await give(1, { ore: 1 })).ok()).toBe(true);
  const aliceOre = Number(await alice.page.getByTestId('hand-ore').textContent());
  const bobBrick = Number(await bob.page.getByTestId('hand-brick').textContent());

  await alice.page.getByTestId('trade-give-brick-plus').click();
  await alice.page.getByTestId('trade-want-ore-plus').click();
  await alice.page.getByTestId('trade-send').click();

  const accept = bob.page.locator('[data-testid^="trade-accept-"]').first();
  await expect(accept).toBeVisible();
  await accept.click();

  const confirm = alice.page.locator('[data-testid^="trade-confirm-"][data-testid$="-1"]').first();
  await expect(confirm).toBeVisible();
  await confirm.click();

  await expect(alice.page.getByTestId('hand-ore')).toHaveText(String(aliceOre + 1));
  await expect(bob.page.getByTestId('hand-brick')).toHaveText(String(bobBrick + 1));
  expect(alice.errors).toEqual([]);
  expect(bob.errors).toEqual([]);
});
