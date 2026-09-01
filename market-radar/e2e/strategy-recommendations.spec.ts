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
  await page.locator('[data-strategy-row]').first().locator('.strategy-signal-details > summary').click();
  await expect(page.locator('[data-strategy-row]').first()).toContainText('失效：');
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
