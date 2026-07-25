// @ts-check
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e-production',

  // Production tests must run one at a time.
  fullyParallel: false,
  workers: 1,

  timeout: 60_000,

  expect: {
    timeout: 15_000,
  },

  forbidOnly: Boolean(process.env.CI),
  retries: 0,

  reporter: [
    ['list'],
    [
      'html',
      {
        outputFolder: 'playwright-report-production',
        open: 'never',
      },
    ],
  ],

  use: {
    baseURL: 'https://www.hostelset.com',

    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',

    actionTimeout: 15_000,
    navigationTimeout: 45_000,

    ignoreHTTPSErrors: true,
  },

  projects: [
    {
      name: 'production-chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],

  outputDir: 'test-results-production',
});
