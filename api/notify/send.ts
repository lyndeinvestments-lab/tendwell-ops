import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  getSupabaseConfig, verifyAuthHeader, getStaffRole, getAllUsersWithViews, getAllPreferences,
  filterRecipients, sendEmail, logNotification, renderEmailLayout, composeBodyHtml, validateCtaUrl,
} from './_lib.js'

// POST /api/notify/send
// Body: { eventType, subject, bodyLines: string[], quoteText?, ctaUrl?, ctaLabel?, meta?, targetUserIds? }
//
// Server composes the email body from structured fields so callers can't
// inject arbitrary HTML (bounty finding #2). Any `bodyHtml` from clients is
// ignored. ctaUrl is allowlisted to tendwellcleaning.com + preview hosts
// (bounty finding #1).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let sb
  try { sb = getSupabaseConfig() } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }

  const session = await verifyAuthHeader(sb, req.headers.authorization)
  if (!session) return res.status(401).json({ error: 'Unauthorized' })
  // Must be a staff user (app_users). A valid Supabase session alone is not
  // enough — owners (property_owners) now authenticate too and must not be able
  // to send blast notifications to staff.
  const role = await getStaffRole(sb, session.email)
  if (!role) return res.status(403).json({ error: 'Forbidden: staff access required' })

  const { eventType, subject, bodyLines, quoteText, ctaUrl, ctaLabel, meta, targetUserIds } = (req.body || {}) as any
  if (!eventType || !subject) {
    return res.status(400).json({ error: 'eventType and subject required' })
  }
  const lines = Array.isArray(bodyLines)
    ? bodyLines.filter((l: any) => typeof l === 'string').slice(0, 8)
    : []
  if (lines.length === 0) {
    return res.status(400).json({ error: 'bodyLines must be a non-empty string array' })
  }
  const quote = typeof quoteText === 'string' && quoteText.trim().length > 0
    ? quoteText.slice(0, 2000)
    : null
  const safeCta = validateCtaUrl(ctaUrl)
  const safeCtaLabel = typeof ctaLabel === 'string' ? ctaLabel.slice(0, 64) : undefined

  try {
    const [users, prefs] = await Promise.all([
      getAllUsersWithViews(sb),
      getAllPreferences(sb),
    ])
    const onlyUserIds = Array.isArray(targetUserIds) && targetUserIds.length > 0
      ? new Set<number>(targetUserIds.map((x: any) => Number(x)).filter((n: number) => !Number.isNaN(n)))
      : undefined
    const recipients = filterRecipients(users, prefs, eventType, { onlyUserIds })

    const bodyHtml = composeBodyHtml({ lines, quote })
    const html = renderEmailLayout({ title: subject, bodyHtml, ctaUrl: safeCta || undefined, ctaLabel: safeCtaLabel })
    const results = await Promise.all(recipients.map(async u => {
      const r = await sendEmail({ to: u.google_email, subject, html })
      await logNotification(sb, {
        recipient_email: u.google_email,
        recipient_user_id: u.id,
        event_type: eventType,
        subject,
        status: r.ok ? 'sent' : 'failed',
        error: r.error,
        meta,
      })
      return { recipient: u.google_email, status: r.ok ? 'sent' : 'failed', error: r.error }
    }))

    const sent = results.filter(r => r.status === 'sent').length
    return res.json({ ok: true, sent, total: results.length, results })
  } catch (err: any) {
    console.error('Notify send error:', err)
    return res.status(500).json({ error: err.message || 'Failed to send' })
  }
}

export const config = { runtime: 'nodejs' }
