// POST /api/leads/intake
//
// Website lead capture. The marketing site's "Book a Call" form POSTs here (from
// its own server route, which holds the API key) BEFORE the Calendly step, so a
// person who fills the form and then abandons the calendar is still a CRM
// record rather than a lost visit.
//
// Auth is the standard scoped API key (`clients:edit` — the same grant that lets
// a key write `contacts`). The write itself goes through the `crm_log_web_lead`
// RPC, never raw table inserts, so the contact row, the interaction and the
// audit trail are all written in one statement and the idempotency key is
// enforced by the database rather than by this endpoint.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { authenticateApiKey, sbFetch } from '../issues/_lib.js'
import { getSupabaseConfig, notifyStaff } from '../notify/_lib.js'
import { parseLead, rateLimit, clientIp } from './_lib.js'
import type { LeadInput, LeadRpcArgs } from './_lib.js'

const REQUIRED_SCOPES = ['clients:edit']

interface LeadRpcResult {
  lead_id: string
  contact_id: string
  interaction_id: string
  created_contact: boolean
  already_logged: boolean
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const auth = await authenticateApiKey(req, REQUIRED_SCOPES)
  if (!auth.ok) return res.status(auth.status ?? 403).json({ error: auth.error ?? 'Forbidden' })

  if (!rateLimit(`lead:${clientIp(req.headers)}`, 20, 10 * 60_000)) {
    return res.status(429).json({ error: 'Too many submissions. Try again shortly.' })
  }

  const body = (typeof req.body === 'string' ? safeJson(req.body) : req.body) as LeadInput | null
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Invalid JSON body' })

  const parsed = parseLead(body, req.headers['user-agent'] ?? null)
  // Honeypot: answer exactly like a success so the bot learns nothing, and
  // write nothing.
  if (parsed.ok === 'ignored') return res.status(200).json({ ok: true })
  if (parsed.ok === false) return res.status(400).json({ error: parsed.error })

  try {
    const result = await sbFetch<LeadRpcResult>('rpc/crm_log_web_lead', {
      method: 'POST',
      body: JSON.stringify(parsed.args),
    })

    // Tell staff, unless this POST was a retry of one already recorded — the
    // RPC is idempotent on external_id and the email should be too.
    if (!result?.already_logged) {
      await sendLeadEmail(parsed.args, result)
    }

    return res.status(200).json({
      ok: true,
      lead_id: result?.lead_id ?? null,
      contact_id: result?.contact_id ?? null,
      created_contact: result?.created_contact ?? false,
      already_logged: result?.already_logged ?? false,
    })
  } catch (e) {
    // Log the detail, return a generic message: the error text can name tables
    // and constraints, and this endpoint's output reaches the public internet
    // through the website's form.
    console.error('crm_log_web_lead failed:', e)
    return res.status(500).json({ error: 'Could not record the lead' })
  }
}

// Email the CRM audience the moment a form lands, with everything they need to
// reply without opening the app. Deliberately awaited but never allowed to
// throw: notifyStaff swallows its own errors, so a Resend outage costs the
// email, not the lead.
async function sendLeadEmail(args: LeadRpcArgs, result: LeadRpcResult | null): Promise<void> {
  let sb
  try {
    sb = getSupabaseConfig()
  } catch {
    return // no service role configured; the lead itself already landed
  }

  const name = args.p_full_name
  const lines = [
    `<strong>${name}</strong> just asked for a 5-Star Audit call on the website.`,
    args.p_email ? `Email: ${args.p_email}` : '',
    args.p_phone ? `Phone: ${args.p_phone}` : '',
    args.p_property_count ? `Portfolio: ${args.p_property_count}` : '',
    args.p_property_location ? `Location: ${args.p_property_location}` : '',
    args.p_source_page ? `Page: ${args.p_source_page}` : '',
    // They have NOT booked yet at this point in the flow — Calendly loads
    // after this call returns, and plenty of people never pick a time.
    result?.created_contact
      ? 'New client card, filed under Clients → Pipeline → New.'
      : 'Matched an existing client, so this is on their card rather than a new one.',
  ].filter(Boolean)

  await notifyStaff(sb, {
    eventType: 'web_lead_received',
    subject: `New website lead: ${name}`,
    lines,
    quote: args.p_message || null,
    ctaUrl: 'https://app.tendwellcleaningco.com/contacts',
    ctaLabel: 'Open Clients',
    meta: {
      lead_id: result?.lead_id ?? null,
      contact_id: result?.contact_id ?? null,
      source_page: args.p_source_page ?? null,
    },
  })
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}
