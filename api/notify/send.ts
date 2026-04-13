import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  getSupabaseConfig, verifyAuthHeader, getAllUsersWithViews, getAllPreferences,
  filterRecipients, sendEmail, logNotification, renderEmailLayout, escapeHtml,
} from './_lib'

// POST /api/notify/send
// Body: { eventType, subject, bodyHtml, ctaUrl?, ctaLabel?, meta? }
// Fans out to all users who: (a) can see the related view, (b) have the pref enabled, (c) have instant digest.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let sb
  try { sb = getSupabaseConfig() } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }

  const session = await verifyAuthHeader(sb, req.headers.authorization)
  if (!session) return res.status(401).json({ error: 'Unauthorized' })

  const { eventType, subject, bodyHtml, ctaUrl, ctaLabel, meta } = (req.body || {}) as any
  if (!eventType || !subject || !bodyHtml) {
    return res.status(400).json({ error: 'eventType, subject, bodyHtml required' })
  }

  try {
    const [users, prefs] = await Promise.all([
      getAllUsersWithViews(sb),
      getAllPreferences(sb),
    ])
    const recipients = filterRecipients(users, prefs, eventType)

    const html = renderEmailLayout({ title: subject, bodyHtml, ctaUrl, ctaLabel })
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
