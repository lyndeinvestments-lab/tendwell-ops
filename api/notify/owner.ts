import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSupabaseConfig, verifyAuthHeader, getStaffRole, sendEmail, logNotification, renderEmailLayout, composeBodyHtml, escapeHtml } from './_lib.js'

const SITE_URL = 'https://app.tendwellcleaningco.com'

type OwnerEventCtx = { propertyName?: string; status?: string; referredName?: string }

// Per-event email copy. Returns null for unknown events (caller 400s).
function buildEmail(event: string, ctx: OwnerEventCtx): { subject: string; lines: string[] } | null {
  const prop = ctx.propertyName ? escapeHtml(ctx.propertyName) : 'your property'
  const status = ctx.status ? escapeHtml(ctx.status) : ''
  switch (event) {
    case 'quote_sent':
      return {
        subject: 'Your Tendwell quote is ready',
        lines: [
          `We've prepared a cleaning quote for ${prop}.`,
          `Sign in to your owner portal to review the details and approve or decline.`,
        ],
      }
    case 'referral_update':
      return {
        subject: 'Update on your referral',
        lines: [
          `Thanks for your referral${ctx.referredName ? ` of ${escapeHtml(ctx.referredName)}` : ''}.`,
          status ? `Its status is now: ${status}.` : `We've updated its status.`,
          `You can see the latest in your owner portal.`,
        ],
      }
    case 'testimonial_update':
      return {
        subject: 'Update on your testimonial',
        lines: [
          `Thank you for sharing your experience with Tendwell.`,
          status ? `Your testimonial status is now: ${status}.` : `We've updated your testimonial.`,
        ],
      }
    case 'feedback_update':
      return {
        subject: 'Update on your feedback',
        lines: [
          `Thanks for your feedback.`,
          status ? `Its status is now: ${status}.` : `We've updated its status.`,
          `See details in your owner portal.`,
        ],
      }
    default:
      return null
  }
}

// POST /api/notify/owner
// Body: { ownerId, event, propertyName?, status?, referredName? }
// Staff-only. Emails an owner about a portal event. The recipient is resolved
// server-side from property_owners (never trusted from the client) to prevent
// an attacker smuggling an arbitrary recipient.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let sb
  try { sb = getSupabaseConfig() } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }

  const session = await verifyAuthHeader(sb, req.headers.authorization)
  if (!session) return res.status(401).json({ error: 'Unauthorized' })
  const role = await getStaffRole(sb, session.email)
  if (!role) return res.status(403).json({ error: 'Forbidden: staff access required' })

  const { ownerId, event, propertyName, status, referredName } = (req.body || {}) as {
    ownerId?: string; event?: string; propertyName?: string; status?: string; referredName?: string
  }
  if (!ownerId || typeof ownerId !== 'string') return res.status(400).json({ error: 'ownerId is required' })
  if (!event || typeof event !== 'string') return res.status(400).json({ error: 'event is required' })

  const tpl = buildEmail(event, { propertyName, status, referredName })
  if (!tpl) return res.status(400).json({ error: 'Unknown event' })

  // Resolve the owner's email server-side via the service role.
  let owner: { email?: string; name?: string | null; active?: boolean } | null = null
  try {
    const r = await fetch(
      `${sb.url}/rest/v1/property_owners?id=eq.${encodeURIComponent(ownerId)}&select=email,name,active`,
      { headers: { apikey: sb.serviceKey, Authorization: `Bearer ${sb.serviceKey}` } },
    )
    if (r.ok) {
      const rows = await r.json()
      owner = Array.isArray(rows) && rows[0] ? rows[0] : null
    }
  } catch { /* fall through to 404 */ }

  if (!owner?.email) return res.status(404).json({ error: 'Owner not found' })
  if (owner.active === false) return res.json({ ok: false, skipped: 'owner inactive' })

  const bodyHtml = composeBodyHtml({ lines: [`Hi ${escapeHtml(owner.name || 'there')},`, ...tpl.lines] })
  const html = renderEmailLayout({ title: tpl.subject, bodyHtml, ctaUrl: SITE_URL, ctaLabel: 'Open your portal' })
  const result = await sendEmail({ to: owner.email, subject: tpl.subject, html })

  await logNotification(sb, {
    recipient_email: owner.email,
    event_type: `owner_${event}`,
    subject: tpl.subject,
    status: result.ok ? 'sent' : 'failed',
    error: result.error,
    meta: { ownerId, event, status: status ?? null, propertyName: propertyName ?? null },
  })

  if (!result.ok) return res.status(500).json({ error: result.error || 'Failed to send' })
  return res.json({ ok: true })
}

export const config = { runtime: 'nodejs' }
