import { test, expect } from '@playwright/test'

// QA audit / PR #116: editing a Quote Sheet cell live-recomputes Profit %.
test.describe('Quote Sheet live recompute', () => {
  test('Profit % updates when ce_charged is edited inline', async ({ page }) => {
    await page.goto('/quote-sheet')
    await page.waitForLoadState('networkidle')

    const rows = page.locator('[data-testid^="row-quote-"]')
    const rowCount = await rows.count()
    test.skip(rowCount === 0, 'No Quote-stage properties present to test against')

    const firstRow = rows.first()
    const ceCell = firstRow.locator('[data-testid^="qs-cell-ce_charged-"]')
    const profitCell = firstRow.locator('td').nth(11) // Profit % column

    const profitBefore = (await profitCell.textContent())?.trim() || ''

    await ceCell.click()
    const input = firstRow.locator('input[data-testid^="qs-cell-ce_charged-"]')
    await input.fill('9999')

    // Profit % should update while typing (not after blur).
    await expect(profitCell).not.toHaveText(profitBefore, { timeout: 3_000 })

    // Escape cancels without persisting; profit snaps back.
    await input.press('Escape')
    await expect(profitCell).toHaveText(profitBefore, { timeout: 3_000 })
  })
})
