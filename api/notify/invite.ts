import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSupabaseConfig, verifyAuthHeader, getStaffRole, sendEmail, logNotification, renderEmailLayout, composeBodyHtml, escapeHtml } from './_lib.js'

const SITE_URL = 'https://app.tendwellcleaningco.com'

// POST /api/notify/invite
// Body: { email, name }
// Sends a welcome/invite email to a newly created app user.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let sb
  try { sb = getSupabaseConfig() } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }

  const session = await verifyAuthHeader(sb, req.headers.authorization)
  if (!session) return res.status(401).json({ error: 'Unauthorized' })
  // Inviting/adding users is an admin-only action (Settings → Users).
  const role = await getStaffRole(sb, session.email)
  if (role !== 'admin') return res.status(403).json({ error: 'Forbidden: admin access required' })

  const { email, name } = (req.body || {}) as { email?: string; name?: string }
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'email is required' })
  }
  const safeName = (name || 'there').slice(0, 100)

  const subject = `You've been added to Tendwell Ops`
  const bodyHtml = composeBodyHtml({
    lines: [
      `Hi ${safeName},`,
      `You've been added as a user on Tendwell Ops, the operations management platform for Tendwell Cleaning Co.`,
      `Click the button below to sign in using your Google account (${email}).`,
      `If you have any questions, reply to this email or contact your manager.`,
    ],
  })
  const html = renderEmailLayout({
    title: subject,
    bodyHtml,
    ctaUrl: SITE_URL,
    ctaLabel: 'Sign in to Tendwell Ops',
  })

  const result = await sendEmail({ to: email, subject, html })

  await logNotification(sb, {
    recipient_email: email,
    event_type: 'user_invite',
    subject,
    status: result.ok ? 'sent' : 'failed',
    error: result.error,
    meta: { invited_name: safeName },
  })

  if (!result.ok) {
    return res.status(500).json({ error: result.error || 'Failed to send' })
  }
  return res.json({ ok: true })
}

export const config = { runtime: 'nodejs' }
