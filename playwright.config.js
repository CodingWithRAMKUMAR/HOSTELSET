// @ts-check
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',

  // Prevent tests from changing the same HostelSet data simultaneously.
  fullyParallel: false,
  workers: 1,

  // Maximum time for one test.
  timeout: 60_000,

  expect: {
    timeout: 10_000,
  },

  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,

  // Terminal result plus a detailed HTML report.
  reporter: [
    ['list'],
    [
      'html',
      {
        outputFolder: 'playwright-report',
        open: 'never',
      },
    ],
  ],

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000',

    // Save useful evidence when a test fails.
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',

    actionTimeout: 15_000,
    navigationTimeout: 30_000,

    ignoreHTTPSErrors: true,
  },

  // Start with Chromium. We will add Firefox, Safari and mobile after
  // the core HostelSet workflows are stable.
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],

  // Playwright automatically starts HostelSet before testing.
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },

  outputDir: 'test-results',
});