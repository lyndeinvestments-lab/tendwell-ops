import type { VercelRequest, VercelResponse } from '@vercel/node'

// Owner self-service email change — owner-gated, service-role.
//
// Changing the Supabase Auth email requires the service-role key (admin API),
// so it runs server-side here. The caller must present their own valid session
// token; the endpoint derives the user from that token and never trusts a
// client-supplied id.
//
//   POST { newEmail: string } → { ok: true } | { error: string }

interface Sb { url: string; serviceKey: string }

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function getSupabaseConfig(): Sb {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) throw new Error('Supabase config missing')
  return { url, serviceKey }
}

// Resolve the caller from their own Bearer token. Returns the auth user object
// (including id and email) or null if the token is invalid/expired.
async function resolveCallerUser(
  sb: Sb,
  token: string,
): Promise<{ id: string; email?: string } | null> {
  const res = await fetch(`${sb.url}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: sb.serviceKey },
  })
  if (!res.ok) return null
  const user = (await res.json()) as { id?: string; email?: string }
  return user.id ? { id: user.id, email: user.email } : null
}

// Lookup an owner row by email via the service-role REST API.
// Returns { id } on a match, null when no row exists, or throws on HTTP/network error.
async function findOwnerByEmail(sb: Sb, email: string): Promise<{ id: string } | null> {
  const res = await fetch(
    `${sb.url}/rest/v1/property_owners?select=id&email=eq.${encodeURIComponent(email)}&limit=1`,
    { headers: { apikey: sb.serviceKey, Authorization: `Bearer ${sb.serviceKey}` } },
  )
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Owner lookup failed (${res.status}): ${errText}`)
  }
  const rows = (await res.json()) as Array<{ id: string }>
  return rows[0] ?? null
}

// Check if a new email is already taken in property_owners or app_users.
// Throws on HTTP/network error so callers can surface a 500 rather than silently skipping a failed check.
async function isEmailTaken(sb: Sb, email: string): Promise<boolean> {
  const [ownerRes, staffRes] = await Promise.all([
    fetch(
      `${sb.url}/rest/v1/property_owners?select=id&email=eq.${encodeURIComponent(email)}&limit=1`,
      { headers: { apikey: sb.serviceKey, Authorization: `Bearer ${sb.serviceKey}` } },
    ),
    fetch(
      `${sb.url}/rest/v1/app_users?select=id&google_email=eq.${encodeURIComponent(email)}&limit=1`,
      { headers: { apikey: sb.serviceKey, Authorization: `Bearer ${sb.serviceKey}` } },
    ),
  ])
  if (!ownerRes.ok) {
    const errText = await ownerRes.text()
    throw new Error(`Email conflict check (owners) failed (${ownerRes.status}): ${errText}`)
  }
  if (!staffRes.ok) {
    const errText = await staffRes.text()
    throw new Error(`Email conflict check (staff) failed (${staffRes.status}): ${errText}`)
  }
  const [ownerRows, staffRows] = await Promise.all([
    ownerRes.json() as Promise<unknown[]>,
    staffRes.json() as Promise<unknown[]>,
  ])
  return ownerRows.length > 0 || staffRows.length > 0
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: `Method ${req.method} not allowed` })
  }

  let sb: Sb
  try { sb = getSupabaseConfig() } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }

  const authHeader = req.headers.authorization || ''
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not signed in' })
  }
  const token = authHeader.slice(7)

  const newEmailRaw = ((req.body?.newEmail ?? '') as string).trim().toLowerCase()
  if (!EMAIL_RE.test(newEmailRaw)) {
    return res.status(400).json({ error: 'Enter a valid email address.' })
  }

  // 1. Resolve the caller from their own token — never trust a client-supplied id.
  const authUser = await resolveCallerUser(sb, token)
  if (!authUser) return res.status(401).json({ error: 'Session expired. Please sign in again.' })

  const currentEmail = (authUser.email || '').toLowerCase()
  if (newEmailRaw === currentEmail) {
    return res.status(400).json({ error: 'That is already your email.' })
  }

  // 2. Must be an existing owner (self-service is owner-only).
  let owner: { id: string } | null
  try {
    owner = await findOwnerByEmail(sb, currentEmail)
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }
  if (!owner) return res.status(403).json({ error: 'Not an owner account.' })

  // 3. Reject if the new email is already taken anywhere.
  let taken: boolean
  try {
    taken = await isEmailTaken(sb, newEmailRaw)
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }
  if (taken) {
    return res.status(409).json({ error: 'That email is already in use.' })
  }

  // 4. Change the auth email immediately (no verification round-trip).
  const updRes = await fetch(`${sb.url}/auth/v1/admin/users/${authUser.id}`, {
    method: 'PUT',
    headers: {
      apikey: sb.serviceKey,
      Authorization: `Bearer ${sb.serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email: newEmailRaw, email_confirm: true }),
  })
  if (!updRes.ok) {
    const errText = await updRes.text()
    const dup = /already|registered|exists/i.test(errText)
    return res.status(dup ? 409 : 500).json({
      error: dup ? 'That email is already in use.' : `Failed to update auth email: ${errText}`,
    })
  }

  // 5. Sync property_owners.email in place (id unchanged → permissions preserved).
  const syncRes = await fetch(
    `${sb.url}/rest/v1/property_owners?id=eq.${encodeURIComponent(owner.id)}`,
    {
      method: 'PATCH',
      headers: {
        apikey: sb.serviceKey,
        Authorization: `Bearer ${sb.serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ email: newEmailRaw }),
    },
  )
  if (!syncRes.ok) {
    const syncErr = await syncRes.text()
    return res.status(500).json({ error: `Failed to sync owner email: ${syncErr}` })
  }

  return res.status(200).json({ ok: true })
}

export const config = { runtime: 'nodejs' }
