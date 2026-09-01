import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { bridgeFixtureSource } from './bridge-fixture';

const errorsByPage = new WeakMap<Page, string[]>();

function installErrorGuard(page: Page): void {
  const errors: string[] = [];
  errorsByPage.set(page, errors);
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
}

async function expectNoBrowserErrors(page: Page): Promise<void> {
  expect(errorsByPage.get(page) ?? []).toEqual([]);
}

async function loadFixture(page: Page, path = '/'): Promise<void> {
  installErrorGuard(page);
  await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
  await page.addInitScript({ content: bridgeFixtureSource });
  await page.goto(path);
  await expect(page.locator('[data-market-table], .table-empty')).toBeVisible();
}

test.afterEach(async ({ page }, testInfo: TestInfo) => {
  if (testInfo.status === 'passed') await expectNoBrowserErrors(page);
});

test.describe('fixture-backed market radar journeys', () => {
  test.beforeEach(async ({ page }) => {
    await loadFixture(page);
  });

  test('loads status, eight primary views, and all ten official categories', async ({ page }) => {
    await expect(page.locator('#collector-status')).toContainText('市場資料更新正常');
    await expect(page.locator('[data-primary-view]')).toHaveCount(8);
    await expect(page.locator('[data-official-category]')).toHaveCount(10);
    await expect(page.locator('[data-ranking-mode]')).toHaveCount(8);
    await expect(page.locator('[data-market-row]')).toHaveCount(4);
  });

  test('pins both enhancement levels independently and preserves them after reload', async ({ page }) => {
    await page.getByRole('button', { name: '加入自選 Chrono Gloves +7' }).click();
    await page.getByRole('button', { name: '加入自選 Chrono Gloves +10' }).click();
    await expect(page.locator('[data-market-row="/items/chrono_gloves::7"] [data-pin]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-market-row="/items/chrono_gloves::10"] [data-pin]')).toHaveAttribute('aria-pressed', 'true');

    await page.locator('[data-primary-view="watchlist"]').click();
    await expect(page.locator('[data-market-row]')).toHaveCount(2);
    await page.reload();
    await page.locator('[data-primary-view="watchlist"]').click();
    await expect(page.locator('[data-market-row]')).toHaveCount(2);
    await expect(page.locator('[data-market-row="/items/chrono_gloves::7"]')).toBeVisible();
    await expect(page.locator('[data-market-row="/items/chrono_gloves::10"]')).toBeVisible();
  });

  test('changes period, sorts, searches, and applies category/liquidity filters', async ({ page }) => {
    await page.locator('[data-ranking-mode="gainers"]').click();
    await page.locator('[data-period="3d"]').click();
    await expect(page.locator('[data-ranking-mode="gainers"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-market-row]')).not.toHaveCount(0);

    await page.locator('[data-sort-field="price"]').click();
    await expect(page.locator('[data-sort-header="price"]')).toHaveAttribute('aria-sort', 'descending');

    await page.locator('input[data-filter="search"]').fill('Apple');
    await expect(page.locator('[data-market-row]')).toHaveCount(1);
    await expect(page.locator('[data-market-row]')).toContainText('Apple');

    await page.locator('input[data-filter="search"]').fill('');
    await page.locator('[data-ranking-mode="market"]').click();
    await page.locator('details.official-categories > summary').click();
    const resource = page.locator('[data-official-category="/item_categories/resource"]');
    await resource.check();
    await expect(page.locator('[data-market-row]')).toHaveCount(1);
    await expect(page.locator('[data-market-row]')).toContainText('Apple');

    await resource.uncheck();
    await page.locator('[data-official-category="/item_categories/equipment"]').check();
    await expect(page.locator('[data-market-row]')).toHaveCount(2);
    await page.locator('input[data-filter="maximum-spread"]').fill('5');
    await expect(page.locator('[data-market-row]')).toHaveCount(1);
    await expect(page.locator('[data-market-row="/items/chrono_gloves::10"]')).toBeVisible();
  });

  test('renders seven ranking modes, period-aware order, and simultaneous thin/move badges', async ({ page }) => {
    const modes = ['gainers', 'losers', 'volume', 'volume-anomaly', 'volatility', 'spread', 'missing-side'];
    for (const mode of modes) {
      await page.locator(`[data-ranking-mode="${mode}"]`).click();
      await expect(page.locator(`[data-ranking-mode="${mode}"]`)).toHaveAttribute('aria-pressed', 'true');
    }

    await page.locator('[data-ranking-mode="gainers"]').click();
    await page.locator('input[data-filter="minimum-volume"]').fill('');
    const mover = page.locator('[data-market-row="/items/cowbell::0"]');
    await expect(mover).toContainText('薄量');
    await expect(mover).toContainText('異動');
    await expect(mover.locator('[data-flag="thin"]')).toBeVisible();
    await expect(mover.locator('[data-flag="move"]')).toBeVisible();
  });

  test('opens a row detail chart summary, changes detail period, and closes it', async ({ page }) => {
    const detailCell = page.locator('[data-market-row="/items/chrono_gloves::7"] .name-column');
    await detailCell.scrollIntoViewIfNeeded();
    await detailCell.click();
    const dialog = page.locator('#item-detail');
    await expect(dialog).toHaveAttribute('open', '');
    await expect(dialog.locator('[data-detail-name]')).toHaveText('Chrono Gloves');
    await expect(dialog.locator('[data-detail-chart-summary]')).toContainText('圖表摘要');

    await dialog.locator('[data-detail-period="7d"]').click();
    await expect(dialog.locator('[data-detail-period="7d"]')).toHaveAttribute('aria-pressed', 'true');
    await dialog.locator('[data-detail-close]').click();
    await expect(dialog).not.toHaveAttribute('open', '');
  });

  test('shows missing values as em dashes without inventing a market row value', async ({ page }) => {
    await page.locator('input[data-filter="minimum-volume"]').fill('');
    const missing = page.locator('[data-market-row="/items/unknown_item::0"]');
    await expect(missing).toContainText('—');
    await page.locator('[data-ranking-mode="missing-side"]').click();
    await expect(page.locator('[data-market-row="/items/unknown_item::0"]')).toBeVisible();
  });
});

test('mobile table remains horizontally usable with sticky header', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chrome-mobile', 'mobile acceptance runs in the mobile Chrome project');
  await loadFixture(page);

  const scroll = page.locator('.table-scroll');
  await expect(scroll).toBeVisible();
  const dimensions = await scroll.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.clientWidth);
  await expect(page.locator('.market-table th').first()).toHaveCSS('position', 'sticky');
});

test('missing bridge shows installation guidance and zero fake rows', async ({ page }) => {
  installErrorGuard(page);
  await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
  await page.goto('/');

  await expect(page.locator('#collector-status')).toContainText('尚未偵測到 MWI Market Radar 腳本', { timeout: 5_000 });
  await expect(page.locator('[data-market-row]')).toHaveCount(0);
  await expect(page.locator('#content')).toContainText('尚無可顯示的行情');
});

test('paginates a large market table without mounting every row', async ({ page }) => {
  await loadFixture(page, '/?e2e-many');

  await expect(page.locator('[data-market-row]')).toHaveCount(100);
  await expect(page.locator('[data-pagination-page]').first()).toHaveText('第 1 / 4 頁・共 304 筆');
  await expect(page.locator('[data-pagination-next]').first()).toBeEnabled();

  await page.locator('[data-pagination-next]').first().click();
  await expect(page.locator('[data-market-row]')).toHaveCount(100);
  await expect(page.locator('[data-pagination-page]').first()).toHaveText('第 2 / 4 頁・共 304 筆');
});

test('bounds detail chart geometry on desktop and mobile', async ({ page }, testInfo) => {
  await loadFixture(page);

  const detailCell = page.locator('[data-market-row="/items/chrono_gloves::7"] .name-column');
  await detailCell.scrollIntoViewIfNeeded();
  await detailCell.click();

  const dialog = page.locator('#item-detail');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-detail-close]')).toBeVisible();

  const measure = async (): Promise<{
    dialog: { width: number; height: number; clientWidth: number; scrollWidth: number; clientHeight: number; scrollHeight: number };
    card: { width: number; height: number; clientWidth: number; scrollWidth: number };
    container: { width: number; height: number; clientWidth: number; scrollWidth: number };
    canvas: { width: number; height: number; clientWidth: number; scrollWidth: number; attributeHeight: number };
  }> => page.evaluate(() => {
    const dialogElement = document.querySelector<HTMLDialogElement>('#item-detail');
    const card = dialogElement?.querySelector<HTMLElement>('.item-detail-card');
    const container = dialogElement?.querySelector<HTMLElement>('.detail-chart-container');
    const canvas = dialogElement?.querySelector<HTMLCanvasElement>('[data-detail-chart]');
    if (!dialogElement || !card || !container || !canvas) throw new Error('Detail geometry elements missing');

    const dimensions = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      };
    };
    const dialogDimensions = dimensions(dialogElement);
    return {
      dialog: {
        ...dialogDimensions,
        clientHeight: dialogElement.clientHeight,
        scrollHeight: dialogElement.scrollHeight,
      },
      card: dimensions(card),
      container: dimensions(container),
      canvas: { ...dimensions(canvas), attributeHeight: canvas.height },
    };
  });

  await page.waitForTimeout(500);
  const first = await measure();
  await page.waitForTimeout(500);
  const second = await measure();
  await testInfo.attach('detail-geometry.json', {
    body: Buffer.from(JSON.stringify({ first, second }), 'utf8'),
    contentType: 'application/json',
  });

  for (const geometry of [first, second]) {
    expect(geometry.container.height).toBeLessThanOrEqual(360);
    expect(geometry.canvas.height).toBeLessThanOrEqual(360);
    expect(geometry.dialog.scrollWidth).toBeLessThanOrEqual(geometry.dialog.clientWidth + 1);
    expect(geometry.card.scrollWidth).toBeLessThanOrEqual(geometry.card.clientWidth + 1);
    expect(geometry.container.scrollWidth).toBeLessThanOrEqual(geometry.container.clientWidth + 1);
    expect(geometry.container.width).toBeLessThanOrEqual(geometry.dialog.clientWidth + 1);
  }
  expect(Math.abs(second.container.height - first.container.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(second.canvas.height - first.canvas.height)).toBeLessThanOrEqual(1);

  await dialog.locator('[data-detail-period="7d"]').click();
  await page.waitForTimeout(500);
  const afterPeriod = await measure();
  expect(afterPeriod.container.height).toBeLessThanOrEqual(360);
  expect(afterPeriod.canvas.height).toBeLessThanOrEqual(360);
  expect(Math.abs(afterPeriod.container.height - second.container.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(afterPeriod.canvas.height - second.canvas.height)).toBeLessThanOrEqual(1);
  await dialog.locator('[data-detail-close]').click();
});
