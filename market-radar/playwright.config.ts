import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    channel: 'chrome',
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chrome-desktop',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        viewport: { width: 1280, height: 800 },
      },
      testMatch: /(^|[\\/])dashboard\.spec\.ts$/,
    },
    {
      name: 'chrome-mobile',
      use: {
        channel: 'chrome',
        viewport: { width: 393, height: 851 },
        isMobile: false,
      },
      testMatch: /(^|[\\/])dashboard\.spec\.ts$/,
    },
    {
      name: 'chrome-cloud-desktop',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        viewport: { width: 1280, height: 800 },
      },
      testMatch: /(^|[\\/])cloud-dashboard\.spec\.ts$/,
    },
    {
      name: 'chrome-cloud-mobile',
      use: {
        channel: 'chrome',
        viewport: { width: 393, height: 851 },
        isMobile: false,
      },
      testMatch: /(^|[\\/])cloud-dashboard\.spec\.ts$/,
    },
    {
      name: 'chrome-profile-import',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        viewport: { width: 1280, height: 800 },
      },
      testMatch: /(^|[\\/])profile-import\.spec\.ts$/,
    },
    {
      name: 'chrome-strategy-recommendations',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        viewport: { width: 1280, height: 800 },
      },
      testMatch: /(^|[\\/])strategy-recommendations\.spec\.ts$/,
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1',
    port: 4173,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
