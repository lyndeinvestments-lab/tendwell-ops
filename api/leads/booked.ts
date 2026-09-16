// POST /api/leads/booked
//
// Second half of website lead capture: the Calendly widget that follows the
// form fires `calendly.event_scheduled`, the site relays it here, and the lead
// is stamped as booked. Without this the CRM cannot tell "filled the form and
// booked" from "filled the form and vanished", and those two need completely
// different follow-up.
//
// Same auth as intake (`clients:edit`). Writes go through
// `crm_mark_web_lead_booked`, which claims the booking atomically so a
// duplicated postMessage cannot log the call twice.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { authenticateApiKey, sbFetch } from '../issues/_lib.js'
import { getSupabaseConfig, notifyStaff } from '../notify/_lib.js'
import { rateLimit, clientIp } from './_lib.js'

const REQUIRED_SCOPES = ['clients:edit']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const auth = await authenticateApiKey(req, REQUIRED_SCOPES)
  if (!auth.ok) return res.status(auth.status ?? 403).json({ error: auth.error ?? 'Forbidden' })

  if (!rateLimit(`booked:${clientIp(req.headers)}`, 30, 10 * 60_000)) {
    return res.status(429).json({ error: 'Too many requests. Try again shortly.' })
  }

  const body = (typeof req.body === 'string' ? safeJson(req.body) : req.body) as Record<string, unknown> | null
  const leadId = typeof body?.lead_id === 'string' ? body.lead_id.trim() : ''
  // Shape-check the id here so a malformed value returns a clean 400 instead of
  // a Postgres cast error surfacing as a 500.
  if (!UUID_RE.test(leadId)) return res.status(400).json({ error: 'lead_id must be a UUID' })

  const eventUri = typeof body?.event_uri === 'string' ? body.event_uri.trim().slice(0, 500) : null
  const scheduledAt =
    typeof body?.scheduled_at === 'string' && !Number.isNaN(Date.parse(body.scheduled_at))
      ? new Date(body.scheduled_at).toISOString()
      : null

  try {
    const result = await sbFetch<{ lead_id: string; contact_id: string | null; already_booked: boolean }>(
      'rpc/crm_mark_web_lead_booked',
      {
        method: 'POST',
        body: JSON.stringify({
          p_lead_id: leadId,
          p_event_uri: eventUri,
          p_scheduled_at: scheduledAt,
        }),
      },
    )
    // Only the caller that actually claimed the booking sends the email; a
    // duplicated Calendly postMessage comes back already_booked and stays quiet.
    if (result && !result.already_booked) {
      await sendBookedEmail(leadId, result.contact_id ?? null)
    }
    return res.status(200).json({ ok: true, already_booked: result?.already_booked ?? false })
  } catch (e) {
    console.error('crm_mark_web_lead_booked failed:', e)
    // A lead id that doesn't exist is the caller's mistake, not ours. Everything
    // else is generic — see intake.ts for why.
    const msg = e instanceof Error ? e.message : ''
    if (msg.includes('not found')) return res.status(404).json({ error: 'Lead not found' })
    return res.status(500).json({ error: 'Could not record the booking' })
  }
}

// Short follow-on to the intake email. The intake one cannot say whether they
// booked — Calendly loads after it is sent — so this is the other half of the
// answer, and the reason the booked flag exists at all.
async function sendBookedEmail(leadId: string, contactId: string | null): Promise<void> {
  let sb
  try {
    sb = getSupabaseConfig()
  } catch {
    return
  }

  let who = 'A website lead'
  try {
    const rows = await sbFetch<Array<{ full_name: string }>>(
      `website_leads?id=eq.${encodeURIComponent(leadId)}&select=full_name`,
    )
    if (rows?.[0]?.full_name) who = rows[0].full_name
  } catch {
    // Name lookup is a nicety; send the email without it rather than not at all.
  }

  await notifyStaff(sb, {
    eventType: 'web_lead_booked',
    subject: `${who} booked a 5-Star Audit call`,
    lines: [
      `<strong>${who}</strong> picked a time on Calendly after filling out the website form.`,
      'The call is on the Calendly calendar; their answers are on their client card.',
    ],
    ctaUrl: 'https://app.tendwellcleaningco.com/contacts',
    ctaLabel: 'Open Clients',
    meta: { lead_id: leadId, contact_id: contactId },
  })
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}
