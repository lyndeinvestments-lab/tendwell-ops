import { test, expect } from '@playwright/test'

// QA audit #1 (PR #118): pipeline card click opens the Property Detail Modal
// directly, with no intermediate side panel.
test.describe('Pipeline → modal', () => {
  test('clicking a card name opens the property modal in one click', async ({ page }) => {
    await page.goto('/pipeline')
    await page.waitForLoadState('networkidle')

    const firstCardName = page.locator('[data-testid^="column-"] button').filter({ hasText: /\S/ }).first()
    await expect(firstCardName).toBeVisible({ timeout: 15_000 })

    await firstCardName.click()

    await expect(
      page.locator('[data-testid="property-detail-modal"]').or(page.getByRole('dialog'))
    ).toBeVisible({ timeout: 10_000 })

    // Sanity: no intermediate "Open Full Details" button exists anymore.
    await expect(page.getByRole('button', { name: /open full details/i })).not.toBeVisible()
  })
})
