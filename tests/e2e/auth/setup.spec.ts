import { test as setup, expect } from '@playwright/test'
import fs from 'node:fs'

const ADMIN_STATE = 'tests/.auth/admin.json'

// One-shot: opens the app, pauses while you sign in with Google, saves the
// session cookie so all subsequent tests reuse it.
//
// From repo root:  npx playwright test --project=setup --headed
// Re-run when the session expires. admin.json is git-ignored.
setup('authenticate as admin', async ({ page }) => {
  setup.setTimeout(6 * 60 * 1000)
  if (process.env.SKIP_AUTH_SETUP || fs.existsSync(ADMIN_STATE)) {
    setup.skip(true, `Storage state exists at ${ADMIN_STATE}. Delete the file to re-auth.`)
  }

  await page.goto('/login')
  console.log('\nSign in with Google in the opened browser window.')
  console.log('Complete any 2FA prompts. After you reach the dashboard, the session saves automatically.\n')

  // Wait for the authenticated shell — not merely "left /login", which also
  // matches Google OAuth / 2FA pages mid-flow.
  const shell = page.locator('[data-testid="app-sidebar"]').or(page.getByRole('navigation')).first()
  await expect(shell).toBeVisible({ timeout: 5 * 60 * 1000 })

  fs.mkdirSync('tests/.auth', { recursive: true })
  await page.context().storageState({ path: ADMIN_STATE })
  console.log(`Saved session to ${ADMIN_STATE}`)
})
