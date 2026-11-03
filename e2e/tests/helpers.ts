import { expect, type Browser, type Locator, type Page } from '@playwright/test';

export const RESOURCES = ['brick', 'lumber', 'wool', 'grain', 'ore'] as const;

/** A fresh browser context logged in as a guest. Collects page errors for assertions. */
export async function newPlayer(
  browser: Browser,
  name: string,
  path = '/',
  viewport = { width: 1280, height: 760 },
) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(path);
  await page.getByTestId('guest-name').fill(name);
  await page.getByTestId('guest-login').click();
  return { context, page, errors };
}

export async function createRoom(page: Page): Promise<string> {
  await page.getByTestId('create-room').click();
  const code = (await page.getByTestId('room-code').textContent())?.trim() ?? '';
  expect(code).toMatch(/^[A-Z0-9]{6}$/);
  return code;
}

/** The game moves on without us (bots, timers), so a target can vanish between check and click. */
async function tryClick(target: Locator): Promise<'acted'> {
  await target.click({ timeout: 3000 }).catch(() => undefined);
  return 'acted';
}

/** Click something on the board or in a dialog if the game is waiting for us. Returns false if idle. */
export async function step(page: Page): Promise<'over' | 'acted' | 'idle'> {
  if (await page.getByTestId('game-over').isVisible()) return 'over';

  const discard = page.getByTestId('discard-dialog');
  if (await discard.isVisible()) {
    const confirm = page.getByTestId('discard-confirm');
    for (let i = 0; i < 40 && (await discard.isVisible()); i++) {
      if (await confirm.isEnabled({ timeout: 1000 }).catch(() => false)) break;
      const plus = discard.locator('[data-testid$="-plus"]:enabled').first();
      if (await plus.isVisible()) await plus.click({ timeout: 2000 }).catch(() => undefined);
    }
    if (await discard.isVisible()) await confirm.click({ timeout: 2000 }).catch(() => undefined);
    return 'acted';
  }

  const victim = page.locator('[data-testid^="steal-victim-"]').first();
  if (await victim.isVisible()) return tryClick(victim);

  for (const prefix of ['vertex-', 'edge-', 'hex-']) {
    const target = page.locator(`[data-testid^="${prefix}"]`).first();
    if (await target.isVisible()) return tryClick(target);
  }

  for (const id of ['roll-dice', 'pass-special-build', 'end-turn']) {
    const btn = page.getByTestId(id);
    if ((await btn.isVisible()) && (await btn.isEnabled())) return tryClick(btn);
  }
  return 'idle';
}

/** Let several human pages play passively (setup, roll, robber, discard, end turn) until game over. */
export async function autoplay(pages: Page[], timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let acted = false;
    for (const p of pages) {
      const r = await step(p);
      if (r === 'over') return;
      if (r === 'acted') {
        acted = true;
        await p.waitForTimeout(60);
      }
    }
    if (!acted) await pages[0]!.waitForTimeout(100);
  }
  throw new Error('game did not finish in time');
}

/** Host a room with `seats` seats, fill the rest with bots, optionally lower the VP target, start. */
export async function startBotGame(page: Page, opts: { seats?: string; vpToWin?: number } = {}) {
  await createRoom(page);
  await page.getByTestId('settings-max-seats').selectOption(opts.seats ?? '3');
  if (opts.vpToWin !== undefined) {
    const vp = page.getByTestId('settings-vp');
    await vp.fill(String(opts.vpToWin));
    await vp.press('Enter');
    await expect(vp).toHaveValue(String(opts.vpToWin));
  }
  await page.getByTestId('fill-bots').click();
  await expect(page.getByTestId('start-game')).toBeEnabled();
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('board')).toBeVisible();
}
