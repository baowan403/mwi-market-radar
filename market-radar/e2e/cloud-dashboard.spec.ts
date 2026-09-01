import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { createCloudFixture, type CloudFixture, type CloudFixtureOptions } from './cloud-fixture';

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

async function loadCloud(page: Page, options: CloudFixtureOptions = {}): Promise<CloudFixture> {
  installErrorGuard(page);
  const fixture = await createCloudFixture(options);
  await fixture.install(page);
  await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
  await page.goto('/');
  await expect(page.locator('[data-source="cloud"]')).toBeVisible();
  await expect(page.locator('[data-market-row]')).toHaveCount(100);
  return fixture;
}

test.afterEach(async ({ page }, testInfo: TestInfo) => {
  if (testInfo.status === 'passed') await expectNoBrowserErrors(page);
});

test.describe('cloud-only market radar', () => {
  test('loads cloud source with 1D data and a bounded item chart without bridge markers', async ({ page }) => {
    await loadCloud(page);

    await expect(page.locator('[data-source]')).toHaveAttribute('data-source', 'cloud');
    await expect(page.locator('[data-source-label]')).toHaveText('雲端共同行情');
    await expect(page.locator('html')).not.toHaveAttribute('data-mwi-radar-bridge');
    await expect(page.locator('[data-market-row]')).toHaveCount(100);

    await page.locator('input[data-filter="search"]').fill('Chrono Gloves');
    const row = page.locator('[data-market-row="/items/chrono_gloves::7"]');
    await expect(row.locator('[data-change-period="1d"]')).not.toContainText('—');
    await row.locator('.name-column').click();

    const dialog = page.locator('#item-detail');
    await expect(dialog).toHaveAttribute('open', '');
    await expect(dialog.locator('[data-detail-chart-summary]')).toContainText('圖表摘要');
    const chartGeometry = await dialog.locator('.detail-chart-container').evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    expect(chartGeometry.width).toBeGreaterThan(0);
    expect(chartGeometry.height).toBeLessThanOrEqual(360);
    expect(chartGeometry.scrollWidth).toBeLessThanOrEqual(chartGeometry.clientWidth + 1);
    await dialog.locator('[data-detail-close]').click();
  });

  test('persists cloud watchlist and settings through IndexedDB across reload', async ({ page }) => {
    await loadCloud(page);
    await page.locator('input[data-filter="search"]').fill('Chrono Gloves');
    await page.locator('[data-market-row="/items/chrono_gloves::7"] [data-pin]').click();
    await page.locator('[data-period="3d"]').click();
    await page.locator('input[data-filter="minimum-volume"]').fill('42');
    await expect(page.locator('[data-market-row="/items/chrono_gloves::7"] [data-pin]')).toHaveAttribute('aria-pressed', 'true');

    await page.reload();
    await expect(page.locator('[data-period="3d"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('input[data-filter="minimum-volume"]')).toHaveValue('42');
    await page.locator('[data-primary-view="watchlist"]').click();
    await expect(page.locator('[data-market-row="/items/chrono_gloves::7"]')).toBeVisible();
    await expect(page.locator('[data-market-row]')).toHaveCount(1);
  });

  test('refreshes a new timestamp and does not redownload snapshots when the manifest is unchanged', async ({ page }) => {
    const fixture = await loadCloud(page);
    const initialSnapshotFetches = fixture.snapshotFetches;
    await fixture.advance();
    await page.locator('[data-cloud-refresh]').click();
    await expect.poll(() => fixture.snapshotFetches).toBe(
      initialSnapshotFetches + fixture.manifest.snapshots.length,
    );
    await expect(page.locator('[data-cloud-refresh]')).toBeEnabled();

    const afterNewTimestamp = fixture.snapshotFetches;
    await page.locator('[data-cloud-refresh]').click();
    await expect.poll(() => fixture.manifestFetches).toBeGreaterThan(2);
    await expect.poll(() => fixture.snapshotFetches).toBe(afterNewTimestamp);
    await expect(page.locator('[data-source]')).toHaveAttribute('data-source', 'cloud');
  });

  test('shows stale cloud metadata while retaining real rows', async ({ page }) => {
    await loadCloud(page, { stale: true });

    await expect(page.locator('[data-source]')).toHaveAttribute('data-source', 'cloud');
    await expect(page.locator('[data-source-detail]')).toContainText('雲端資料已超過 2.5 小時');
    await expect(page.locator('[data-market-row]')).toHaveCount(100);
  });

  test('fails closed on a corrupt cloud snapshot without inventing rows', async ({ page }) => {
    const fixture = await createCloudFixture({ corruptTimestamp: undefined });
    const corruptTimestamp = fixture.manifest.latestTimestamp;
    fixture.setCorrupt(corruptTimestamp);
    installErrorGuard(page);
    await fixture.install(page);
    await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
    await page.goto('/');

    await expect(page.locator('[data-source]')).toHaveAttribute('data-source', 'unavailable', { timeout: 5_000 });
    await expect(page.locator('[data-market-row]')).toHaveCount(0);
    await expect(page.locator('#content')).toContainText('尚無可顯示的行情');
  });

  test('paginates 100 rows, ranks and filters cloud data on desktop and responsive layouts', async ({ page }) => {
    await loadCloud(page);
    await expect(page.locator('[data-market-row]')).toHaveCount(100);
    await expect(page.locator('[data-pagination-page]').first()).toContainText('第 1 / 4 頁・共 306 筆');

    for (let pageNumber = 2; pageNumber <= 4; pageNumber += 1) {
      await page.locator('[data-pagination-next]').first().click();
      await expect(page.locator('[data-pagination-page]').first()).toContainText(`第 ${pageNumber} / 4 頁・共 306 筆`);
    }
    await expect(page.locator('[data-pagination-next]').first()).toBeDisabled();
    await expect(page.locator('[data-market-row]')).toHaveCount(6);

    await page.locator('input[data-filter="search"]').fill('');
    await page.locator('[data-ranking-mode="gainers"]').click();
    await expect(page.locator('[data-ranking-mode="gainers"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-ranking-mode="missing-side"]').click();
    await expect(page.locator('[data-market-row="/items/apple::0"]')).toBeVisible();

    await page.locator('[data-ranking-mode="market"]').click();
    await page.locator('details.official-categories > summary').click();
    await page.locator('[data-official-category="/item_categories/equipment"]').check();
    await expect(page.locator('[data-market-row]')).toHaveCount(2);
    await page.locator('[data-official-category="/item_categories/equipment"]').uncheck();
    await page.locator('input[data-filter="search"]').fill('Cowbell');
    await page.locator('input[data-filter="minimum-volume"]').fill('5');
    await expect(page.locator('[data-market-row]')).toHaveCount(0);
  });
});
