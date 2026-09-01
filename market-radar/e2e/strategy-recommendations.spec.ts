import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createCloudFixture } from './cloud-fixture';

test('imports a profile and persists personalized strategy recommendations without profile egress', async ({ page }) => {
  const fixture = await createCloudFixture({ strategyQuotes: true });
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
  await expect(page.locator('.strategy-warning')).toContainText('尚未套用市場承接量');
  await expect(page.locator('[data-strategy-row]')).not.toHaveCount(0);
  await expect(page.locator('[data-strategy-row*="redwood"]').first()).toBeVisible();
  await expect(page.locator('[data-strategy-row*="pirate_refinement_shard"]').first()).toBeVisible();

  const firstPin = page.locator('[data-strategy-pin]').first();
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
