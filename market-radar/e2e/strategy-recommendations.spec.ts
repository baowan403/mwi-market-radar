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
  await expect(page.locator('.strategy-warning')).toContainText('成交量承接估計');
  await expect(page.locator('[data-strategy-scope="actionable"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-strategy-row]')).not.toHaveCount(0);
  await expect(page.locator('[data-strategy-row][data-liquidity-classification="reject"]')).toHaveCount(0);
  await expect(page.locator('[data-strategy-row][data-liquidity-classification="insufficient"]')).toHaveCount(0);
  expect(await page.locator('[data-strategy-row][data-liquidity-classification="long-run"]').count()).toBeGreaterThan(0);
  expect(await page.locator('[data-strategy-row][data-liquidity-classification="limited"]').count()).toBeGreaterThan(0);
  await expect(page.getByRole('columnheader', { name: '理論日利' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '可實現日利' })).toBeVisible();
  await expect(page.locator('[data-strategy-row]').first()).toContainText('安全批量');
  await expect(page.locator('[data-strategy-row]').first()).toContainText('市場占比');
  await expect(page.locator('[data-strategy-row]').first().locator('[data-strategy-signal]')).toBeVisible();
  await expect(page.locator('[data-strategy-row]').first()).toContainText('信心 低');
  await expect(page.locator('[data-strategy-row]').first()).toContainText('回測 3D');
  const firstRow = page.locator('[data-strategy-row]').first();
  const closedGeometry = await firstRow.evaluate((row) => {
    const cells = [...row.querySelectorAll('td')];
    const table = row.closest('table') as HTMLTableElement;
    const scroll = table.parentElement as HTMLElement;
    const path = row.querySelector('.strategy-name-cell') as HTMLElement;
    const classification = cells[2] as HTMLElement;
    const assumptions = cells[9] as HTMLElement;
    const theoretical = row.querySelector('.strategy-profit-theoretical') as HTMLElement;
    const realizable = row.querySelector('.strategy-profit') as HTMLElement;
    return {
      displays: cells.map((cell) => getComputedStyle(cell).display),
      rowHeight: row.getBoundingClientRect().height,
      pathWidth: path.getBoundingClientRect().width,
      classificationWidth: classification.getBoundingClientRect().width,
      assumptionsWidth: assumptions.getBoundingClientRect().width,
      theoreticalWhiteSpace: getComputedStyle(theoretical).whiteSpace,
      realizableWhiteSpace: getComputedStyle(realizable).whiteSpace,
      tableWidth: table.getBoundingClientRect().width,
      scrollWidth: scroll.getBoundingClientRect().width,
      bodyScrollWidth: document.body.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
    };
  });
  expect(closedGeometry.displays.every((display) => display === 'table-cell')).toBe(true);
  expect(closedGeometry.pathWidth).toBeGreaterThan(closedGeometry.classificationWidth);
  expect(closedGeometry.pathWidth).toBeGreaterThan(closedGeometry.assumptionsWidth);
  expect(closedGeometry.rowHeight).toBeLessThanOrEqual(104);
  expect(closedGeometry.theoreticalWhiteSpace).toBe('nowrap');
  expect(closedGeometry.realizableWhiteSpace).toBe('nowrap');
  expect(closedGeometry.bodyScrollWidth).toBeLessThanOrEqual(closedGeometry.bodyClientWidth + 1);
  if ((page.viewportSize()?.width ?? 1280) < 800) {
    expect(closedGeometry.tableWidth).toBeGreaterThan(closedGeometry.scrollWidth);
  }

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
