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
import { parseLead, rateLimit, clientIp } from './_lib.js'
import type { LeadInput } from './_lib.js'

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

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}
