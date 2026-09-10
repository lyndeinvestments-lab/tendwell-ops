// Shared helpers for website lead intake (api/leads/*.ts).
//
// The marketing site (tendwellcleaningco.com) gates its "Book a Call" CTA
// behind a short form and POSTs the answers here before showing Calendly.
// These endpoints are the only public write path into the CRM, so everything
// that arrives is treated as hostile: validated, length-capped, and shaped into
// the exact RPC argument list before it reaches Postgres.
//
// The parsing/validation half is deliberately pure and I/O-free so it can be
// unit-tested (see _lib.test.ts); the endpoints own the network.

// Length caps. Generous enough for a real answer, small enough that a bot
// cannot use the form as free storage.
const MAX_SHORT = 200
const MAX_MESSAGE = 2000
const MAX_URL = 500

// Anything longer than this is not a name someone typed.
const MAX_NAME = 120

export interface LeadInput {
  external_id?: unknown
  full_name?: unknown
  name?: unknown
  email?: unknown
  phone?: unknown
  company?: unknown
  property_count?: unknown
  property_location?: unknown
  message?: unknown
  source_page?: unknown
  referrer?: unknown
  utm?: unknown
  /** Honeypot — a real browser leaves this empty. */
  website?: unknown
}

export interface LeadRpcArgs {
  p_external_id: string
  p_full_name: string
  p_email: string | null
  p_phone: string | null
  p_company: string | null
  p_property_count: string | null
  p_property_location: string | null
  p_message: string | null
  p_source_page: string | null
  p_referrer: string | null
  p_utm: Record<string, string>
  p_user_agent: string | null
}

export type LeadParse =
  | { ok: true; args: LeadRpcArgs }
  | { ok: false; error: string }
  // A honeypot hit. The caller answers 200 so the bot learns nothing, but
  // nothing is written.
  | { ok: 'ignored' }

function text(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (!t) return null
  return t.slice(0, max)
}

// Deliberately permissive: a single `@` with something either side and no
// whitespace. Anything stricter rejects real addresses, and the CRM tolerates a
// bad email far better than it tolerates a lost lead — an unusable address just
// means staff call the phone number instead.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isLikelyEmail(v: string): boolean {
  return EMAIL_RE.test(v)
}

// Only these keys are carried through, so a caller cannot smuggle arbitrary
// JSON into the row's jsonb column.
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid']

export function pickUtm(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {}
  const src = raw as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const k of UTM_KEYS) {
    const v = text(src[k], MAX_SHORT)
    if (v) out[k] = v
  }
  return out
}

/**
 * Validate + normalize a raw submission into RPC arguments.
 *
 * Requires a name and at least one way to reach the person. Everything else is
 * optional — a half-filled form from someone genuinely interested is worth more
 * than a rejection, and the form itself is the place to ask nicely.
 */
export function parseLead(body: LeadInput, userAgent?: string | null): LeadParse {
  // Honeypot first: a filled hidden field means a bot, and we skip every other
  // check so the response timing gives nothing away either.
  if (typeof body.website === 'string' && body.website.trim() !== '') return { ok: 'ignored' }

  const fullName = text(body.full_name ?? body.name, MAX_NAME)
  if (!fullName) return { ok: false, error: 'A name is required' }

  const email = text(body.email, MAX_SHORT)
  const phone = text(body.phone, MAX_SHORT)
  if (!email && !phone) return { ok: false, error: 'An email address or a phone number is required' }
  if (email && !isLikelyEmail(email)) return { ok: false, error: 'That email address does not look right' }

  // The website mints this so a retried POST is a no-op. Generating one here
  // when it's absent keeps the endpoint usable by hand (curl, a future form),
  // at the cost of that particular call not being idempotent.
  const externalId = text(body.external_id, MAX_SHORT) ?? `web:${cryptoRandomId()}`

  return {
    ok: true,
    args: {
      p_external_id: externalId,
      p_full_name: fullName,
      p_email: email,
      p_phone: phone,
      p_company: text(body.company, MAX_SHORT),
      p_property_count: text(body.property_count, MAX_SHORT),
      p_property_location: text(body.property_location, MAX_SHORT),
      p_message: text(body.message, MAX_MESSAGE),
      p_source_page: text(body.source_page, MAX_URL),
      p_referrer: text(body.referrer, MAX_URL),
      p_utm: pickUtm(body.utm),
      p_user_agent: text(userAgent, MAX_SHORT),
    },
  }
}

function cryptoRandomId(): string {
  // globalThis.crypto is available on the Node 18+ runtime Vercel uses.
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

// ─── Rate limiting ───────────────────────────────────────────────────────────
// Best-effort only: a serverless instance is ephemeral and there may be many of
// them, so this throttles a single hot instance rather than enforcing a global
// quota. That is the right weight here — the real gate is the API key, and the
// caller (the website's own server route) applies its own per-IP limit. This
// exists so one runaway loop cannot fill the CRM from a single instance.
const hits = new Map<string, number[]>()

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const recent = (hits.get(key) ?? []).filter(t => now - t < windowMs)
  if (recent.length >= limit) {
    hits.set(key, recent)
    return false
  }
  recent.push(now)
  hits.set(key, recent)
  // Bound the map so a long-lived instance seeing many keys can't grow forever.
  if (hits.size > 500) {
    for (const [k, v] of hits) {
      if (v.every(t => now - t >= windowMs)) hits.delete(k)
    }
  }
  return true
}

/** The caller's IP, best-effort, for rate-limit bucketing only. */
export function clientIp(headers: Record<string, string | string[] | undefined>): string {
  const fwd = headers['x-forwarded-for']
  const raw = Array.isArray(fwd) ? fwd[0] : fwd
  return (raw ?? '').split(',')[0]?.trim() || 'unknown'
}
