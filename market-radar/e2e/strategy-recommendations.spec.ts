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
  await expect(page.locator('[data-strategy-scope="actionable"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-strategy-row]')).not.toHaveCount(0);
  await expect(page.locator('[data-strategy-row][data-liquidity-classification="reject"]')).toHaveCount(0);
  await expect(page.locator('[data-strategy-row][data-liquidity-classification="insufficient"]')).toHaveCount(0);
  expect(await page.locator('[data-strategy-row][data-liquidity-classification="long-run"]').count()).toBeGreaterThan(0);
  // 新 7 欄佈局：日利（合併理論+可實現）、趨勢、執行量與承接、24h 資金
  await expect(page.getByRole('columnheader', { name: '日利' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '趨勢' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '執行量與承接' })).toBeVisible();
  // 可實現日利為主數字，理論為注腳
  await expect(page.locator('[data-strategy-row]').first().locator('.strategy-profit-main')).toBeVisible();
  await expect(page.locator('[data-strategy-row]').first().locator('.strategy-profit-ref')).toContainText('理論');
  // 趨勢欄含 3D/7D 利潤變化百分比
  await expect(page.locator('[data-strategy-row]').first().locator('.strategy-trend-delta')).toBeVisible();
  // 合併的執行量與承接欄
  await expect(page.locator('[data-strategy-row]').first()).toContainText('市占');
  await expect(page.locator('[data-strategy-row]').first().locator('[data-strategy-signal]')).toBeVisible();
  await expect(page.locator('[data-strategy-row]').first()).toContainText('回測 3D');
  const firstRow = page.locator('[data-strategy-row]').first();
  const closedGeometry = await firstRow.evaluate((row) => {
    const cells = [...row.querySelectorAll('td')];
    const table = row.closest('table') as HTMLTableElement;
    const scroll = table.parentElement as HTMLElement;
    const path = row.querySelector('.strategy-name-cell') as HTMLElement;
    const classification = cells[2] as HTMLElement;
    const profit = row.querySelector('.strategy-profit') as HTMLElement;
    return {
      displays: cells.map((cell) => getComputedStyle(cell).display),
      cellCount: cells.length,
      rowHeight: row.getBoundingClientRect().height,
      pathWidth: path.getBoundingClientRect().width,
      classificationWidth: classification.getBoundingClientRect().width,
      profitWhiteSpace: getComputedStyle(profit).whiteSpace,
      tableWidth: table.getBoundingClientRect().width,
      scrollWidth: scroll.getBoundingClientRect().width,
      bodyScrollWidth: document.body.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
    };
  });
  expect(closedGeometry.displays.every((display) => display === 'table-cell')).toBe(true);
  expect(closedGeometry.cellCount).toBe(7);
  expect(closedGeometry.pathWidth).toBeGreaterThan(closedGeometry.classificationWidth);
  expect(closedGeometry.rowHeight).toBeLessThanOrEqual(110);
  expect(closedGeometry.profitWhiteSpace).toBe('nowrap');
  expect(closedGeometry.bodyScrollWidth).toBeLessThanOrEqual(closedGeometry.bodyClientWidth + 1);
  if ((page.viewportSize()?.width ?? 1280) < 800) {
    expect(closedGeometry.tableWidth).toBeGreaterThan(closedGeometry.scrollWidth);
  }

  // 趨勢折疊展開：理由與失效條件
  const pathWidthBeforeDisclosure = closedGeometry.pathWidth;
  await firstRow.locator('.strategy-signal-details > summary').click();
  await expect(page.locator('[data-strategy-row]').first()).toContainText('失效：');
  const openGeometry = await firstRow.evaluate((row) => ({
    rowHeight: row.getBoundingClientRect().height,
    pathWidth: (row.querySelector('.strategy-name-cell') as HTMLElement).getBoundingClientRect().width,
  }));
  expect(openGeometry.rowHeight).toBeGreaterThan(closedGeometry.rowHeight);
  expect(Math.abs(openGeometry.pathWidth - pathWidthBeforeDisclosure)).toBeLessThan(1);
  const classificationStyle = await page.locator('.strategy-classification').first().evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    radius: Number.parseFloat(getComputedStyle(element).borderTopLeftRadius),
  }));
  expect(classificationStyle.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(classificationStyle.radius).toBeGreaterThan(0);
  const signalStyle = await page.locator('.strategy-signal').first().evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    radius: Number.parseFloat(getComputedStyle(element).borderTopLeftRadius),
  }));
  expect(signalStyle.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(signalStyle.radius).toBeGreaterThan(0);
  await expect(page.locator('[data-strategy-row*="redwood"]').first()).toBeVisible();
  const strategyText = await page.locator('#content').innerText();
  expect(strategyText).toMatch(/\d(?:\.\d+)?M/);
  expect(strategyText).not.toMatch(/\d(?:\.\d+)?B\b/);
  expect(strategyText).not.toMatch(/\b\d{1,3}(?:,\d{3}){2,}\b/);

  // 列展開步驟面板
  await firstRow.click();
  const detailRow = page.locator('[data-strategy-detail-for]').first();
  await expect(detailRow).toBeVisible();
  await expect(detailRow).toContainText('步驟明細');

  await page.locator('[data-strategy-scope="limited"]').click();
  await expect(page.locator('[data-strategy-row]')).not.toHaveCount(0);
  expect(await page.locator('[data-strategy-row][data-liquidity-classification="reject"]').count()).toBeGreaterThan(0);
  await expect(page.locator('[data-strategy-row*="pirate_refinement_shard"]').first()).toBeVisible();
  await page.locator('[data-strategy-scope="actionable"]').click();

  const firstPin = page.locator('[data-strategy-row*="redwood"] [data-strategy-pin]').first();
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
