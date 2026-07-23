import type { VercelRequest, VercelResponse } from '@vercel/node'

// Admin-side owner login email change — admin-gated, service-role.
//
// The owner self-service version lives at /api/owners/change-email (caller's
// own session). This endpoint lets an ADMIN change any owner's login email
// from Settings → Owners, e.g. when an owner asks for it or entered the wrong
// address. Mirrors that endpoint's flow: validate → conflict check → update
// the Supabase Auth email (email_confirm, no verification round-trip) → sync
// property_owners.email in place (id unchanged → assignments/permissions
// preserved; the contact-sync trigger mirrors it to the linked Clients
// record). Owners whose login was never provisioned just get the row update.
//
//   POST { ownerId: string, newEmail: string } → { ok: true } | { error }

interface Sb { url: string; serviceKey: string }

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function getSupabaseConfig(): Sb {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) throw new Error('Supabase config missing')
  return { url, serviceKey }
}

// Caller must be a signed-in staff admin (same gate as /api/owners/provision).
async function requireAdmin(sb: Sb, authHeader: string | undefined): Promise<boolean> {
  if (!authHeader?.startsWith('Bearer ')) return false
  const token = authHeader.slice(7)
  const userRes = await fetch(`${sb.url}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: sb.serviceKey },
  })
  if (!userRes.ok) return false
  const user = (await userRes.json()) as { email?: string }
  if (!user.email) return false
  const lookup = await fetch(
    `${sb.url}/rest/v1/app_users?select=role&google_email=eq.${encodeURIComponent(user.email.toLowerCase())}&limit=1`,
    { headers: { apikey: sb.serviceKey, Authorization: `Bearer ${sb.serviceKey}` } },
  )
  if (!lookup.ok) return false
  const rows = (await lookup.json()) as Array<{ role?: string }>
  return rows[0]?.role === 'admin'
}

async function findAuthUser(sb: Sb, email: string): Promise<{ id: string } | null> {
  const res = await fetch(
    `${sb.url}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
    { headers: { apikey: sb.serviceKey, Authorization: `Bearer ${sb.serviceKey}` } },
  )
  if (!res.ok) return null
  const data = (await res.json()) as { users?: Array<{ id: string; email?: string }> }
  const match = (data.users || []).find(u => (u.email || '').toLowerCase() === email.toLowerCase())
  return match ? { id: match.id } : null
}

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
  if (!ownerRes.ok) throw new Error(`Email conflict check (owners) failed (${ownerRes.status})`)
  if (!staffRes.ok) throw new Error(`Email conflict check (staff) failed (${staffRes.status})`)
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

  if (!(await requireAdmin(sb, req.headers.authorization))) {
    return res.status(403).json({ error: 'Admin role required' })
  }

  const ownerId = ((req.body?.ownerId ?? '') as string).trim()
  const newEmail = ((req.body?.newEmail ?? '') as string).trim().toLowerCase()
  if (!ownerId) return res.status(400).json({ error: 'ownerId is required' })
  if (!EMAIL_RE.test(newEmail)) return res.status(400).json({ error: 'Enter a valid email address.' })

  // 1. Load the owner row (service role — id is validated server-side).
  const ownerRes = await fetch(
    `${sb.url}/rest/v1/property_owners?select=id,email&id=eq.${encodeURIComponent(ownerId)}&limit=1`,
    { headers: { apikey: sb.serviceKey, Authorization: `Bearer ${sb.serviceKey}` } },
  )
  if (!ownerRes.ok) return res.status(500).json({ error: `Owner lookup failed (${ownerRes.status})` })
  const owner = ((await ownerRes.json()) as Array<{ id: string; email: string }>)[0]
  if (!owner) return res.status(404).json({ error: 'Owner not found' })

  const currentEmail = owner.email.toLowerCase()
  if (newEmail === currentEmail) {
    return res.status(400).json({ error: 'That is already this owner’s email.' })
  }

  // 2. Reject if the new email is already taken anywhere.
  let taken: boolean
  try { taken = await isEmailTaken(sb, newEmail) } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }
  if (taken) return res.status(409).json({ error: 'That email is already in use.' })

  // 3. Update the Supabase Auth login, if one has been provisioned.
  const authUser = await findAuthUser(sb, currentEmail)
  if (authUser) {
    const updRes = await fetch(`${sb.url}/auth/v1/admin/users/${authUser.id}`, {
      method: 'PUT',
      headers: {
        apikey: sb.serviceKey,
        Authorization: `Bearer ${sb.serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: newEmail, email_confirm: true }),
    })
    if (!updRes.ok) {
      const errText = await updRes.text()
      const dup = /already|registered|exists/i.test(errText)
      return res.status(dup ? 409 : 500).json({
        error: dup ? 'That email is already in use.' : `Failed to update auth email: ${errText}`,
      })
    }
  }

  // 4. Sync property_owners.email in place (id unchanged).
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
      body: JSON.stringify({ email: newEmail }),
    },
  )
  if (!syncRes.ok) {
    const syncErr = await syncRes.text()
    return res.status(500).json({ error: `Auth email updated but owner record sync failed: ${syncErr}` })
  }

  return res.status(200).json({ ok: true, authUpdated: !!authUser })
}

export const config = { runtime: 'nodejs' }
