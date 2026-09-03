import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createCloudFixture } from './cloud-fixture';

test('imports a profile and persists personalized strategy recommendations without profile egress', async ({ page }) => {
  const fixture = await createCloudFixture({ strategyQuotes: true, historyHours: 72, dailyHistoryDays: 31 });
  await fixture.install(page);
  await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
  const requestBodies: string[] = [];
  page.on('request', (request) => {
    const body = request.postData();
    if (body) requestBodies.push(body);
  });
  const profile = await readFile(path.resolve('tests', 'fixtures', 'profile-export-v1.json'), 'utf8');

  await page.goto('/');
  await expect(page.locator('[data-source="cloud"]')).toBeVisible();
  await page.getByRole('button', { name: '角色快照' }).click();
  await page.getByLabel('貼上 Milkonomy 角色快照').fill(profile);
  await page.getByRole('button', { name: '導入並使用' }).click();
  await expect(page.locator('#profile-summary')).toContainText('測試牛一號');

  await page.locator('[data-product-surface="strategy"]').click();
  await expect(page.locator('#category-nav')).toBeHidden();
  await expect(page.locator('#toolbar')).toBeHidden();
  await expect(page.locator('.strategy-warning')).toContainText('成交量');
  await expect(page.locator('[data-strategy-scope]')).toHaveCount(0);
  await expect(page.locator('[data-strategy-row]')).not.toHaveCount(0);
  await expect(page.locator('[data-strategy-row][data-liquidity-classification="reject"]')).toHaveCount(0);
  await expect(page.locator('[data-strategy-row][data-liquidity-classification="insufficient"]')).toHaveCount(0);
  expect(await page.locator('[data-strategy-row][data-liquidity-classification="long-run"]').count()).toBeGreaterThan(0);
  const expectedHeaders = [
    '自選', '步驟', '路徑', '日利', '1D', '3D', '7D', '72H走勢',
    '日產佔比', '資金/D', '風險', '優先級',
  ];
  await expect(page.locator('.strategy-table thead th')).toHaveText(expectedHeaders);
  const firstRow = page.locator('[data-strategy-row]').first();
  await expect(firstRow.locator('.strategy-profit-main')).toBeVisible();
  await expect(firstRow.locator('.strategy-trend-cell')).toHaveCount(3);
  await expect(firstRow.locator('.strategy-sparkline-cell .strategy-sparkline')).toBeVisible();
  await expect(firstRow.locator('.strategy-market-share')).toHaveText(/^\d+(?:\.\d+)?%$/);
  await expect(firstRow.locator('[data-strategy-priority]')).toBeVisible();
  const closedGeometry = await firstRow.evaluate((row) => {
    const cells = [...row.querySelectorAll('td')];
    const table = row.closest('table') as HTMLTableElement;
    const scroll = table.parentElement as HTMLElement;
    const path = row.querySelector('.strategy-path-cell') as HTMLElement;
    const classification = cells[10] as HTMLElement;
    const profit = row.querySelector('.strategy-profit') as HTMLElement;
    const sparkline = row.querySelector('.strategy-sparkline-cell') as HTMLElement;
    return {
      displays: cells.map((cell) => getComputedStyle(cell).display),
      cellCount: cells.length,
      rowHeight: row.getBoundingClientRect().height,
      pathWidth: path.getBoundingClientRect().width,
      classificationWidth: classification.getBoundingClientRect().width,
      profitWhiteSpace: getComputedStyle(profit).whiteSpace,
      sparklineText: sparkline.textContent,
      tableWidth: table.getBoundingClientRect().width,
      scrollWidth: scroll.getBoundingClientRect().width,
      bodyScrollWidth: document.body.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
    };
  });
  expect(closedGeometry.displays.every((display) => display === 'table-cell')).toBe(true);
  expect(closedGeometry.cellCount).toBe(12);
  expect(closedGeometry.pathWidth).toBeGreaterThan(closedGeometry.classificationWidth);
  expect(closedGeometry.rowHeight).toBeLessThanOrEqual(90);
  expect(closedGeometry.profitWhiteSpace).toBe('nowrap');
  expect(closedGeometry.sparklineText).toBe('');
  expect(closedGeometry.bodyScrollWidth).toBeLessThanOrEqual(closedGeometry.bodyClientWidth + 1);
  if ((page.viewportSize()?.width ?? 1280) < 800) {
    expect(closedGeometry.tableWidth).toBeGreaterThan(closedGeometry.scrollWidth);
  }

  const classificationStyle = await page.locator('.strategy-classification').first().evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    radius: Number.parseFloat(getComputedStyle(element).borderTopLeftRadius),
  }));
  expect(classificationStyle.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(classificationStyle.radius).toBeGreaterThan(0);
  const priorityStyle = await page.locator('.strategy-priority-badge').first().evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    radius: Number.parseFloat(getComputedStyle(element).borderTopLeftRadius),
  }));
  expect(priorityStyle.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(priorityStyle.radius).toBeGreaterThan(0);
  await expect(page.locator('[data-strategy-row*="pirate"]').first()).toBeVisible();
  const strategyText = await page.locator('#content').innerText();
  expect(strategyText).toMatch(/\d(?:\.\d+)?M/);
  expect(strategyText).not.toMatch(/\d(?:\.\d+)?B\b/);
  expect(strategyText).not.toMatch(/\b\d{1,3}(?:,\d{3}){2,}\b/);

  // 列展開步驟面板
  await firstRow.click();
  const detailRow = page.locator('[data-strategy-detail-for]').first();
  await expect(detailRow).toBeVisible();
  await expect(detailRow.locator('td')).toHaveAttribute('colspan', '12');
  await expect(detailRow).toContainText('安全執行');
  await expect(detailRow).toContainText('建議本批');
  await expect(detailRow).toContainText('瓶頸');
  await expect(detailRow).toContainText('掛機排程與原料採購規劃');

  const firstPin = page.locator('[data-strategy-row*="pirate"] [data-strategy-pin]').first();
  const strategyId = await firstPin.getAttribute('data-strategy-pin');
  await firstPin.click();
  await expect(firstPin).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await page.locator('[data-product-surface="strategy"]').click();
  await expect(page.locator(`[data-strategy-pin="${strategyId}"]`)).toHaveAttribute('aria-pressed', 'true');

  const outbound = requestBodies.join('\n');
  expect(outbound).not.toContain('測試牛一號');
  expect(outbound).not.toContain('character:700001');
  expect(outbound).not.toContain('/items/holy_alembic');
});
