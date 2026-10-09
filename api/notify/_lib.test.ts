import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_NOTIF_PREFS, filterRecipients, notificationsDisabled, notifyStaff, sendEmail, type NotifPrefs } from './_lib.js'

describe('NOTIFY_DISABLED kill switch', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('reads "1" and "true" (any case) as disabled, anything else as enabled', () => {
    expect(notificationsDisabled({ NOTIFY_DISABLED: '1' })).toBe(true)
    expect(notificationsDisabled({ NOTIFY_DISABLED: 'true' })).toBe(true)
    expect(notificationsDisabled({ NOTIFY_DISABLED: ' TRUE ' })).toBe(true)
    expect(notificationsDisabled({ NOTIFY_DISABLED: '0' })).toBe(false)
    expect(notificationsDisabled({ NOTIFY_DISABLED: '' })).toBe(false)
    expect(notificationsDisabled({})).toBe(false)
  })

  const fakeDb = () => ({ from: vi.fn(() => { throw new Error('db must not be touched') }) })
  const opts = { eventType: 'vendor_invoice_submitted', subject: 's', lines: ['l'] }

  it('notifyStaff sends nothing and touches nothing when disabled', async () => {
    vi.stubEnv('NOTIFY_DISABLED', '1')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const sb = fakeDb()
    const r = await notifyStaff(sb as any, opts)
    expect(r).toEqual({ sent: 0, failed: 0, recipients: 0 })
    expect(sb.from).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('sendEmail itself refuses when disabled, even with a provider key set', async () => {
    vi.stubEnv('NOTIFY_DISABLED', 'true')
    vi.stubEnv('RESEND_API_KEY', 'test-key-not-real')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const r = await sendEmail({ to: 'nobody@example.com', subject: 's', html: '<p>x</p>' })
    expect(r.ok).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('without the switch, notifyStaff does reach the (stubbed) recipient lookup', async () => {
    vi.stubEnv('NOTIFY_DISABLED', '')
    const fetchSpy = vi.fn(async () => { throw new Error('offline') })
    vi.stubGlobal('fetch', fetchSpy)
    const r = await notifyStaff(fakeDb() as any, opts)
    expect(fetchSpy).toHaveBeenCalled()
    expect(r).toEqual({ sent: 0, failed: 0, recipients: 0 })
  })
})

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
