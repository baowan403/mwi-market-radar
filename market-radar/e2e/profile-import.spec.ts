import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createCloudFixture } from './cloud-fixture';

test('imports and persists a Milkonomy profile without profile network egress', async ({ page }) => {
  const fixture = await createCloudFixture();
  await fixture.install(page);
  await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
  const requestBodies: string[] = [];
  page.on('request', (request) => {
    const body = request.postData();
    if (body) requestBodies.push(body);
  });
  const profile = await readFile(
    path.resolve('tests', 'fixtures', 'profile-export-v1.json'),
    'utf8',
  );

  await page.goto('/');
  await expect(page.locator('[data-source="cloud"]')).toBeVisible();
  await expect(page.locator('#profile-summary')).toHaveText('尚未導入角色');

  await page.getByRole('button', { name: '角色快照' }).click();
  await page.getByLabel('貼上 Milkonomy 角色快照').fill(profile);
  await page.getByRole('button', { name: '導入並使用' }).click();
  await expect(page.locator('#profile-summary')).toContainText('測試牛一號');
  await expect(page.locator('#profile-summary')).toContainText('煉金 103');

  await page.reload();
  await expect(page.locator('[data-source="cloud"]')).toBeVisible();
  await expect(page.locator('#profile-summary')).toContainText('測試牛一號');
  await expect(page.locator('#profile-summary')).toContainText('煉金 103');

  const outbound = requestBodies.join('\n');
  expect(outbound).not.toContain('測試牛一號');
  expect(outbound).not.toContain('character:700001');
  expect(outbound).not.toContain('/items/holy_alembic');
});
