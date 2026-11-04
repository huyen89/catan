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

export interface StepOptions {
  /**
   * Open Seas: take the ship whenever a placement offers road or ship, and enter ship-building
   * mode whenever a ship is affordable and has a spot on our turn.
   */
  ships?: boolean;
}

/** Robber-or-pirate moves seen so far: alternate so both get exercised. */
let robberMoves = 0;

/** Press the dialog's enabled steppers until `confirm` enables, then confirm. */
async function fillPicker(dialog: Locator, confirm: Locator): Promise<'acted'> {
  for (let i = 0; i < 40 && (await dialog.isVisible()); i++) {
    if (await confirm.isEnabled({ timeout: 1000 }).catch(() => false)) break;
    const plus = dialog.locator('[data-testid$="-plus"]:enabled').first();
    if (await plus.isVisible()) await plus.click({ timeout: 2000 }).catch(() => undefined);
  }
  if (await dialog.isVisible()) await confirm.click({ timeout: 2000 }).catch(() => undefined);
  return 'acted';
}

/** Test id of a highlighted settlement spot on a coastline (an end of a drawn shore line). */
async function coastalVertex(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const ends: Array<[number, number]> = [];
    for (const l of document.querySelectorAll('.shore-line')) {
      const n = (a: string) => Number(l.getAttribute(a));
      ends.push([n('x1'), n('y1')], [n('x2'), n('y2')]);
    }
    for (const g of document.querySelectorAll('[data-testid^="vertex-"]')) {
      const c = g.querySelector('circle');
      const x = Number(c?.getAttribute('cx'));
      const y = Number(c?.getAttribute('cy'));
      if (ends.some(([ex, ey]) => Math.hypot(ex - x, ey - y) < 2)) {
        return g.getAttribute('data-testid');
      }
    }
    return null;
  });
}

/** Click something on the board or in a dialog if the game is waiting for us. Returns false if idle. */
export async function step(page: Page, opts: StepOptions = {}): Promise<'over' | 'acted' | 'idle'> {
  if (await page.getByTestId('game-over').isVisible()) return 'over';

  const discard = page.getByTestId('discard-dialog');
  if (await discard.isVisible()) return fillPicker(discard, page.getByTestId('discard-confirm'));
  const gold = page.getByTestId('gold-dialog');
  if (await gold.isVisible()) return fillPicker(gold, page.getByTestId('gold-confirm'));

  const victim = page.locator('[data-testid^="steal-victim-"]').first();
  if (await victim.isVisible()) return tryClick(victim);

  // Road or ship (setup's second piece, road building): pick the ship when asked to.
  const shipToggle = page.getByTestId('piece-ship');
  if (
    opts.ships &&
    (await shipToggle.isVisible()) &&
    (await shipToggle.getAttribute('aria-pressed')) !== 'true'
  ) {
    return tryClick(shipToggle);
  }

  // Robber or pirate: alternate when both are offered.
  const pirateHex = page.locator('[data-testid^="pirate-hex-"]').first();
  const robberHex = page.locator('[data-testid^="hex-"]').first();
  const canPirate = await pirateHex.isVisible();
  const canRobber = await robberHex.isVisible();
  if (canPirate || canRobber) {
    const pirate = canPirate && (!canRobber || robberMoves++ % 2 === 1);
    return tryClick(pirate ? pirateHex : robberHex);
  }

  if (opts.ships) {
    const coastal = await coastalVertex(page);
    if (coastal) return tryClick(page.getByTestId(coastal));
  }
  for (const prefix of ['vertex-', 'edge-']) {
    const target = page.locator(`[data-testid^="${prefix}"]`).first();
    if (await target.isVisible()) return tryClick(target);
  }

  // Open Seas: enter ship-building mode; the next step clicks a highlighted edge.
  const buildShip = page.getByTestId('build-ship');
  if (opts.ships && (await buildShip.isVisible()) && (await buildShip.isEnabled())) {
    return tryClick(buildShip);
  }

  for (const id of ['roll-dice', 'pass-special-build', 'end-turn']) {
    const btn = page.getByTestId(id);
    if ((await btn.isVisible()) && (await btn.isEnabled())) return tryClick(btn);
  }
  return 'idle';
}

/**
 * Let several human pages play passively (setup, roll, robber or pirate, discard, gold, end turn)
 * until game over, or until `until` holds.
 */
export async function autoplay(
  pages: Page[],
  timeoutMs: number,
  opts: StepOptions & { until?: () => Promise<boolean> } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (opts.until && (await opts.until())) return;
    let acted = false;
    for (const p of pages) {
      const r = await step(p, opts);
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

/**
 * Host a room with `seats` seats on `variant` (and Open Seas `scenario`), fill the rest with bots,
 * optionally lower the VP target, start. Returns the room code.
 */
export async function startBotGame(
  page: Page,
  opts: { seats?: string; vpToWin?: number; variant?: string; scenario?: string } = {},
): Promise<string> {
  const code = await createRoom(page);
  await page.getByTestId('settings-max-seats').selectOption(opts.seats ?? '3');
  // Variant and scenario first: entering Open Seas resets the VP target to the scenario's.
  if (opts.variant) await page.getByTestId('settings-variant').selectOption(opts.variant);
  if (opts.scenario) await page.getByTestId('settings-scenario').selectOption(opts.scenario);
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
  return code;
}
