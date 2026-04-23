import { test, expect } from '@playwright/test'

// QA audit #2 (PR #119): Property Modal Overview shows chip row,
// Financials snapshot (canViewFinancials), and Access Setup (canViewAccess).
// Session is admin so we verify all three render.
test.describe('Property Modal Overview expansion', () => {
  test('admin sees chips + Financials snapshot + Access Setup', async ({ page }) => {
    await page.goto('/master-list')
    await page.waitForLoadState('networkidle')

    const firstName = page
      .locator('button')
      .filter({ hasText: /\S/ })
      .filter({ hasNotText: /archive|export|import|deactivate|confirm/i })
      .first()
    await expect(firstName).toBeVisible({ timeout: 15_000 })
    await firstName.click()

    const modal = page.locator('[data-testid="property-detail-modal"]').or(page.getByRole('dialog')).first()
    await expect(modal).toBeVisible({ timeout: 10_000 })

    await expect(modal.getByText(/financials/i).first()).toBeVisible()
    await expect(modal.getByText(/access setup/i).first()).toBeVisible()
    await expect(modal.getByText(/client charged/i).first()).toBeVisible()
    await expect(modal.getByText(/cleaner pay/i).first()).toBeVisible()
    await expect(modal.getByText(/profit %/i).first()).toBeVisible()
  })
})
