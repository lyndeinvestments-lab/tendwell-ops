import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  getSupabaseConfig, getAllUsersWithViews, getAllPreferences, filterRecipients,
  sendEmail, logNotification, renderEmailLayout, escapeHtml,
} from './_lib.js'

// POST /api/notify/public — for events triggered from unauthenticated pages (e.g. public onboarding form)
// Only the following event types are allowed; payload is verified against DB before sending.
// Body: { eventType: 'onboarding_submitted', token: string }
const ALLOWED_EVENTS = new Set(['onboarding_submitted', 'onboarding_intake_submitted'])

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let sb
  try { sb = getSupabaseConfig() } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }

  const { eventType, token } = (req.body || {}) as any
  if (!eventType || !ALLOWED_EVENTS.has(eventType)) {
    return res.status(400).json({ error: 'Invalid event type' })
  }

  if (eventType === 'onboarding_submitted') {
    if (!token || typeof token !== 'string') return res.status(400).json({ error: 'token required' })
    // Verify submission exists & was submitted within last 5 minutes
    const r = await fetch(`${sb.url}/rest/v1/onboarding_submissions?token=eq.${encodeURIComponent(token)}&select=property_name,client_name,address,submitted_at`, {
      headers: { apikey: sb.serviceKey, Authorization: `Bearer ${sb.serviceKey}` },
    })
    if (!r.ok) return res.status(500).json({ error: 'Lookup failed' })
    const rows = await r.json()
    const sub = rows[0]
    if (!sub) return res.status(404).json({ error: 'Submission not found' })
    const submittedAt = sub.submitted_at ? new Date(sub.submitted_at).getTime() : 0
    if (Date.now() - submittedAt > 5 * 60 * 1000) return res.status(403).json({ error: 'Submission too old' })

    const subject = `Onboarding form submitted: ${sub.property_name || sub.client_name || 'New submission'}`
    const bodyHtml = `<p style="font-size:14px;line-height:1.6;"><strong>${escapeHtml(sub.property_name || 'Unnamed property')}</strong>${sub.client_name ? ` — ${escapeHtml(sub.client_name)}` : ''}</p>
      ${sub.address ? `<p style="font-size:13px;color:#475569;">${escapeHtml(sub.address)}</p>` : ''}`

    const [users, prefs] = await Promise.all([getAllUsersWithViews(sb), getAllPreferences(sb)])
    const recipients = filterRecipients(users, prefs, eventType)
    const html = renderEmailLayout({ title: subject, bodyHtml, ctaUrl: 'https://app.tendwellcleaningco.com/master-list', ctaLabel: 'View in Master List' })

    let sent = 0
    await Promise.all(recipients.map(async u => {
      const r = await sendEmail({ to: u.google_email, subject, html })
      await logNotification(sb, {
        recipient_email: u.google_email,
        recipient_user_id: u.id,
        event_type: eventType,
        subject, status: r.ok ? 'sent' : 'failed', error: r.error,
      })
      if (r.ok) sent++
    }))

    return res.json({ ok: true, sent })
  }

  if (eventType === 'onboarding_intake_submitted') {
    const { address, client_name } = (req.body || {}) as any
    const addr = typeof address === 'string' ? address.trim() : ''
    const cli = typeof client_name === 'string' ? client_name.trim() : ''
    if (!addr && !cli) return res.status(400).json({ error: 'address or client_name required' })
    // Anti-spam: only notify if a matching submission was actually created in
    // the last 5 minutes (the public intake form writes onboarding_submissions
    // immediately before calling this). No token on the intake flow, so we
    // verify by recent matching row instead.
    // Build the filter via URLSearchParams so the user-supplied value is fully
    // encoded and can't break out of the `eq.` operator into another PostgREST
    // filter (e.g. injecting `not`/`gte` to bypass the freshness check).
    const params = new URLSearchParams()
    params.set(addr ? 'address' : 'client_name', `eq.${addr || cli}`)
    params.set('select', 'address,client_name,submitted_at')
    params.set('order', 'submitted_at.desc')
    params.set('limit', '1')
    const r = await fetch(`${sb.url}/rest/v1/onboarding_submissions?${params.toString()}`, {
      headers: { apikey: sb.serviceKey, Authorization: `Bearer ${sb.serviceKey}` },
    })
    if (!r.ok) return res.status(500).json({ error: 'Lookup failed' })
    const rows = await r.json()
    const sub = rows[0]
    if (!sub) return res.status(404).json({ error: 'Submission not found' })
    const submittedAt = sub.submitted_at ? new Date(sub.submitted_at).getTime() : 0
    if (Date.now() - submittedAt > 5 * 60 * 1000) return res.status(403).json({ error: 'Submission too old' })

    const subject = `New onboarding intake: ${sub.client_name || sub.address || 'New submission'}`
    const bodyHtml = `<p style="font-size:14px;line-height:1.6;"><strong>${escapeHtml(sub.client_name || 'New client')}</strong></p>
      ${sub.address ? `<p style="font-size:13px;color:#475569;">${escapeHtml(sub.address)}</p>` : ''}`

    const [users, prefs] = await Promise.all([getAllUsersWithViews(sb), getAllPreferences(sb)])
    const recipients = filterRecipients(users, prefs, eventType)
    const html = renderEmailLayout({ title: subject, bodyHtml, ctaUrl: 'https://app.tendwellcleaningco.com/master-list', ctaLabel: 'View in Master List' })

    let sent = 0
    await Promise.all(recipients.map(async u => {
      const rr = await sendEmail({ to: u.google_email, subject, html })
      await logNotification(sb, {
        recipient_email: u.google_email,
        recipient_user_id: u.id,
        event_type: eventType,
        subject, status: rr.ok ? 'sent' : 'failed', error: rr.error,
      })
      if (rr.ok) sent++
    }))

    return res.json({ ok: true, sent })
  }

  return res.status(400).json({ error: 'Unhandled event' })
}

export const config = { runtime: 'nodejs' }
