import { test, expect } from '@playwright/test'

// QA audit #2 (PR #119): Property Modal Overview shows chip row,
// Financials snapshot (canViewFinancials), and Access Setup (canViewAccess).
// Session is admin so we verify all three render.
test.describe('Property Modal Overview expansion', () => {
  test('admin sees chips + Financials snapshot + Access Setup', async ({ page }) => {
    await page.goto('/master-list')
    await page.waitForLoadState('networkidle')

    // Desktop table uses open-panel-*; mobile-open-* exists in DOM but is
    // md:hidden — .first() without a visibility filter matches the hidden one.
    const openProperty = page.locator('[data-testid^="open-panel-"]').first()
    await expect(openProperty).toBeVisible({ timeout: 15_000 })
    await openProperty.click()

    const modal = page.locator('[data-testid="property-detail-modal"]').or(page.getByRole('dialog')).first()
    await expect(modal).toBeVisible({ timeout: 10_000 })

    await expect(modal.getByText(/financials/i).first()).toBeVisible()
    await expect(modal.getByText(/access setup/i).first()).toBeVisible()
    await expect(modal.getByText(/client charged/i).first()).toBeVisible()
    await expect(modal.getByText(/cleaner pay/i).first()).toBeVisible()
    await expect(modal.getByText(/profit %/i).first()).toBeVisible()
  })
})
