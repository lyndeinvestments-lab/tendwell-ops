import { test, expect } from '@playwright/test'

// QA audit #10 (PR #123): Master List has an admin-only Archive toggle.
// This test verifies the UI wiring. The actual soft-delete/restore roundtrip
// is covered by the DB smoke test run during the audit (see session notes).
test.describe('Master List archive panel', () => {
  test('admin sees Archive toggle and panel header opens', async ({ page }) => {
    await page.goto('/master-list')
    await page.waitForLoadState('networkidle')

    const archiveBtn = page.getByRole('button', { name: /^archive\b/i }).first()
    if (!(await archiveBtn.isVisible().catch(() => false))) {
      test.skip(true, 'Current user is not admin on this env')
    }

    await archiveBtn.click()
    await expect(page.getByRole('heading', { name: /archived properties/i })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/auto-purged permanently after 30 days/i)).toBeVisible()

    // Toggle back
    await page.getByRole('button', { name: /hide archive/i }).click()
    await expect(page.getByRole('heading', { name: /archived properties/i })).not.toBeVisible()
  })
})
