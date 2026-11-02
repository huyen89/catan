import { expect, type Browser, type Page } from '@playwright/test';

export const RESOURCES = ['brick', 'lumber', 'wool', 'grain', 'ore'] as const;

/** A fresh browser context logged in as a guest. Collects page errors for assertions. */
export async function newPlayer(browser: Browser, name: string, path = '/') {
  const context = await browser.newContext({ viewport: { width: 1280, height: 760 } });
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

/** Click something on the board or in a dialog if the game is waiting for us. Returns false if idle. */
export async function step(page: Page): Promise<'over' | 'acted' | 'idle'> {
  if (await page.getByTestId('game-over').isVisible()) return 'over';

  if (await page.getByTestId('discard-dialog').isVisible()) {
    for (let i = 0; i < 40; i++) {
      if (await page.getByTestId('discard-confirm').isEnabled()) break;
      for (const r of RESOURCES) {
        const plus = page.getByTestId(`discard-${r}-plus`);
        if (await plus.isEnabled()) {
          await plus.click();
          break;
        }
      }
    }
    await page.getByTestId('discard-confirm').click();
    return 'acted';
  }

  const victim = page.locator('[data-testid^="steal-victim-"]').first();
  if (await victim.isVisible()) {
    await victim.click();
    return 'acted';
  }

  for (const prefix of ['vertex-', 'edge-', 'hex-']) {
    const target = page.locator(`[data-testid^="${prefix}"]`).first();
    if (await target.isVisible()) {
      await target.click();
      return 'acted';
    }
  }

  for (const id of ['roll-dice', 'pass-special-build', 'end-turn']) {
    const btn = page.getByTestId(id);
    if ((await btn.isVisible()) && (await btn.isEnabled())) {
      await btn.click();
      return 'acted';
    }
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
