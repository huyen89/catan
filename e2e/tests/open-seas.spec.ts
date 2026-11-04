import { expect, test, type Page } from '@playwright/test';
import { autoplay, newPlayer, startBotGame } from './helpers';

interface TestState {
  phase: { kind: string };
  ships: Record<string, number>;
  turn: { number: number };
  config: { scenario?: string; vpToWin: number };
}

/** Sane bound for the New Shores game when the bots are slow to win. */
const MAX_TURNS = 120;

const stateOf = async (page: Page, code: string) =>
  (await (await page.request.get(`/api/test/rooms/${code}/state`)).json()) as TestState;

test('Open Seas: a human and two bots play New Shores to game over (or a turn bound)', async ({
  browser,
}) => {
  test.setTimeout(400_000);
  const alice = await newPlayer(browser, 'Alice');
  const { page } = alice;
  // A low target keeps the game short; ships and island bonuses still matter at 8.
  const code = await startBotGame(page, {
    variant: 'seafarers',
    scenario: 'newShores',
    vpToWin: 8,
  });
  await expect(page.locator('.terrain .sea')).toBeVisible();
  await expect(page.getByTestId('pirate')).toBeVisible();

  // Alice settles on the coast and takes ships whenever offered; give her lumber and wool so she
  // can keep building them (TEST_MODE route, bypasses the rules).
  const give = () =>
    page.request.post(`/api/test/rooms/${code}/give`, {
      data: { seat: 0, resources: { lumber: 3, wool: 3 } },
    });
  expect((await give()).ok()).toBe(true);

  const ship = page.locator('[data-testid^="ship-"]');
  await autoplay([page], 120_000, { ships: true, until: async () => (await ship.count()) > 0 });
  await expect(ship.first()).toBeVisible();

  // Play to game over, bounded by turns: how fast bots close out an Open Seas game is bot
  // strength, not what this test is about.
  let lastTurn = -1;
  await autoplay([page], 240_000, {
    ships: true,
    until: async () => {
      const s = await stateOf(page, code);
      if (s.turn.number >= MAX_TURNS) return true;
      // Top Alice up every third turn so ship building keeps going.
      if (s.turn.number !== lastTurn && s.turn.number % 3 === 0 && s.phase.kind !== 'gameOver') {
        lastTurn = s.turn.number;
        await give();
      }
      return false;
    },
  });
  const final = await stateOf(page, code);
  expect(final.config.vpToWin).toBe(8);
  if (final.phase.kind === 'gameOver') await expect(page.getByTestId('game-over')).toBeVisible();
  else expect(final.turn.number).toBeGreaterThanOrEqual(MAX_TURNS);
  expect(Object.values(final.ships)).toContain(0);
  expect(alice.errors).toEqual([]);
});

test('Open Seas: Grand Voyage starts for five and gets through setup', async ({ browser }) => {
  test.setTimeout(150_000);
  const alice = await newPlayer(browser, 'Alice');
  const { page } = alice;
  // Five seats pick Grand Voyage by default.
  const code = await startBotGame(page, { seats: '5', variant: 'seafarers' });
  await expect(page.locator('.terrain .sea')).toBeVisible();
  expect((await stateOf(page, code)).config.scenario).toBe('grandVoyage');

  await autoplay([page], 120_000, {
    ships: true,
    until: async () => (await stateOf(page, code)).turn.number >= 3,
  });
  const s = await stateOf(page, code);
  expect(s.turn.number).toBeGreaterThanOrEqual(3);
  expect(alice.errors).toEqual([]);
});
