import { describe, expect, it } from 'vitest'
import { allocateClearNumber, maxDocNumber } from './_qbo-numbers'

describe('maxDocNumber', () => {
  it("finds Haven's highest QuickBooks number and ignores non-numeric ones", () => {
    // Haven's real numbers on 2026-10-13: 1090 and 1092 skip numbers, 1098 is newest.
    expect(maxDocNumber(['1096', '1097', '1098', '1094', '1090'])).toBe(1098)
    expect(maxDocNumber(['1098', 'INV-2000', '', null, ' 1099 '])).toBe(1099)
    expect(maxDocNumber([])).toBeNull()
  })
})

describe('allocateClearNumber', () => {
  const counter = (start: number) => { let n = start; return async () => n++ }

  it('skips numbers QuickBooks already has', async () => {
    const inQbo = new Set([1098, 1099])
    const r = await allocateClearNumber(counter(1098), async n => inQbo.has(n))
    expect(r).toEqual({ number: 1100, skipped: [1098, 1099] })
  })

  it('uses the counter alone when QuickBooks is not connected', async () => {
    expect(await allocateClearNumber(counter(1098), null)).toEqual({ number: 1098, skipped: [] })
  })

  it('uses the number unchecked when the QuickBooks check fails', async () => {
    const r = await allocateClearNumber(counter(1099), async () => { throw new Error('401') })
    expect(r).toEqual({ number: 1099, skipped: [] })
  })

  it('stops instead of burning numbers forever', async () => {
    await expect(allocateClearNumber(counter(1), async () => true, 3)).rejects.toThrow('QuickBooks already has invoices 1 to 3')
  })
})
