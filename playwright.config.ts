import { defineConfig, devices } from '@playwright/test'

// E2E config. Runs against a local dev server by default; override with
// BASE_URL to point at a Vercel preview. Storage state (session cookie)
// lives in tests/.auth/*.json and is created by the auth setup project.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:5000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    // Manual one-shot: npx playwright test --project=setup --headed to refresh session.
    {
      name: 'setup',
      testMatch: /auth\/setup\.spec\.ts/,
    },
    {
      name: 'chromium',
      dependencies: ['setup'],
      testIgnore: /auth\/setup\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'tests/.auth/admin.json',
      },
    },
  ],
  webServer: process.env.BASE_URL
    ? undefined
    : {
      command: 'npm run dev',
      url: 'http://localhost:5000',
      reuseExistingServer: true,
      timeout: 120_000,
    },
})
