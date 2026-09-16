import { test, expect } from '@playwright/test'

// Soft-delete is triggered per Offboarded row; the confirm dialog carries the
// recoverability copy. (The old page-level Archive panel toggle was removed
// when Master List merged into Cost Tracking.)
test.describe('Master List archive', () => {
  test('admin can open the archive confirmation dialog for an Offboarded property', async ({ page }) => {
    await page.goto('/master-list')
    await page.waitForLoadState('networkidle')

    // Row-archive controls only render for Offboarded properties.
    const offboardedTally = page.getByTestId('tally-Offboarded')
    if (!(await offboardedTally.isVisible().catch(() => false))) {
      test.skip(true, 'No Offboarded properties on this env')
    }
    await offboardedTally.click()
    await page.waitForLoadState('networkidle')

    const archiveBtn = page.locator('[data-testid^="row-archive-"]').first()
    if (!(await archiveBtn.isVisible().catch(() => false))) {
      test.skip(true, 'No row-archive control (need admin + Offboarded row)')
    }
    await archiveBtn.click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    await expect(dialog.getByRole('heading', { name: /archive property/i })).toBeVisible()
    await expect(dialog.getByText(/recoverable for 30 days/i)).toBeVisible()

    // Cancel — do not mutate production data in this smoke test.
    await page.getByTestId('button-archive-cancel').click()
    await expect(dialog).not.toBeVisible()
  })
})
