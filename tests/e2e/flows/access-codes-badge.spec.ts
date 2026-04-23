import { test, expect } from '@playwright/test'

// QA audit #4 (PR #120): Access Codes list shows Missing / Incomplete badges.
test.describe('Access Codes badges', () => {
  test('page loads and renders a Missing or Incomplete badge (or empty state)', async ({ page }) => {
    await page.goto('/access-codes')
    await page.waitForLoadState('networkidle')

    const anyBadge = page.getByText(/^(Missing|Incomplete)$/, { exact: true }).first()
    const emptyState = page.getByText(/no properties found/i).first()
    await expect(anyBadge.or(emptyState)).toBeVisible({ timeout: 15_000 })

    if (await anyBadge.isVisible().catch(() => false)) {
      const title = await anyBadge.getAttribute('title')
      expect(title).toBeTruthy()
      expect(title).toMatch(/access codes|missing/i)
    }
  })
})
