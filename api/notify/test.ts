import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSupabaseConfig, verifyAuthHeader, sendEmail, logNotification, renderEmailLayout } from './_lib'

// POST /api/notify/test — sends a test email to the requesting user
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let sb
  try { sb = getSupabaseConfig() } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }

  const session = await verifyAuthHeader(sb, req.headers.authorization)
  if (!session) return res.status(401).json({ error: 'Unauthorized' })

  const html = renderEmailLayout({
    title: 'Test notification',
    bodyHtml: `<p style="font-size:14px;line-height:1.6;">If you can read this, email notifications are working. You can configure which events trigger emails in Settings → Notifications.</p>`,
    ctaUrl: 'https://tendwellcleaning.com/#/settings',
    ctaLabel: 'Open Settings',
  })

  const r = await sendEmail({ to: session.email, subject: 'Tendwell Ops — test notification', html })
  await logNotification(sb, {
    recipient_email: session.email,
    event_type: 'test',
    subject: 'Tendwell Ops — test notification',
    status: r.ok ? 'sent' : 'failed',
    error: r.error,
  })

  if (!r.ok) return res.status(500).json({ error: r.error })
  return res.json({ ok: true, sentTo: session.email })
}

export const config = { runtime: 'nodejs' }
