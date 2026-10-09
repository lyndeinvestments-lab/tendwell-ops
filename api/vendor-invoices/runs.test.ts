import { beforeEach, describe, expect, it, vi } from 'vitest'

// No network: the notify module is replaced, so any email attempt is visible
// as a notifyStaff call and nothing can leave the process.
vi.mock('../notify/_lib.js', () => ({
  notifyStaff: vi.fn(async () => ({ sent: 1, failed: 0, recipients: 1 })),
  getSupabaseConfig: vi.fn(() => ({})),
}))

const { notifyStaff } = await import('../notify/_lib.js')
const { notifySubmitted } = await import('./runs.js')

const actor = (vendorName: string) => ({
  email: 'v@example.com', label: 'V', role: 'supervisor', isAdmin: false, vendorId: 'vendor-1', vendorName,
})
const run = { id: 'run-1', period_start: '2026-10-04', period_end: '2026-10-07', vendor_reference: null } as any
const detail = { run: { total: 35329.21 }, lines: [], in_review_count: 0 } as any

describe('notifySubmitted', () => {
  beforeEach(() => vi.mocked(notifyStaff).mockClear())

  it('never emails for the verify scripts\' test vendors', async () => {
    for (const name of ['ZZ E2E Vendor 1759', 'ZZ Portal Test Vendor 1759', 'zz e2e vendor']) {
      await notifySubmitted(actor(name), run, detail, false)
    }
    expect(notifyStaff).not.toHaveBeenCalled()
  })

  it('still emails for a real vendor', async () => {
    await notifySubmitted(actor('Busy Bee Cleaning'), run, detail, true)
    expect(notifyStaff).toHaveBeenCalledTimes(1)
    expect(vi.mocked(notifyStaff).mock.calls[0][1].eventType).toBe('vendor_invoice_submitted')
  })
})
