import { describe, expect, it } from 'vitest'
import { DEFAULT_NOTIF_PREFS, filterRecipients, type NotifPrefs } from './_lib.js'

const user = (id: number, role: string, views: string[]) => ({
  id, role, google_email: `u${id}@example.com`, label: `U${id}`, custom_views: null, allowedViews: views,
})

describe('vendor_invoice_submitted recipients', () => {
  const users = [
    user(1, 'admin', ['invoicing']),
    user(2, 'admin', ['invoicing']),
    user(3, 'operations', ['invoicing']),
    user(4, 'supervisor', ['vendor-invoicing']),
    user(5, 'admin', ['invoicing']),
  ]
  const prefs = new Map<number, NotifPrefs>([
    [2, { user_id: 2, ...DEFAULT_NOTIF_PREFS, notify_vendor_invoice_submitted: false }],
    [5, { user_id: 5, ...DEFAULT_NOTIF_PREFS, digest_frequency: 'daily' }],
  ])

  it('goes to admins with the toggle on (default), never operations or vendor logins', () => {
    const got = filterRecipients(users, prefs, 'vendor_invoice_submitted').map(u => u.id)
    expect(got).toEqual([1])
  })

  it('is on by default for an admin with no preferences row', () => {
    expect(DEFAULT_NOTIF_PREFS.notify_vendor_invoice_submitted).toBe(true)
  })

  it('leaves other events role-unrestricted', () => {
    const got = filterRecipients([user(3, 'operations', ['contacts'])], new Map(), 'web_lead_received').map(u => u.id)
    expect(got).toEqual([3])
  })
})
