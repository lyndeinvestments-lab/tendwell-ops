import type { VercelRequest, VercelResponse } from '@vercel/node'

// Owner auth provisioning — admin-only, service-role.
//
// Creating (or deleting) a Supabase Auth email/password user requires the
// service-role key, which only exists server-side. The Settings → Owners tab
// manages the `property_owners` / `owner_properties` rows directly with the
// admin's authenticated session (admin-only RLS), but the actual login identity
// must be minted here.
//
//   POST   { email, password }  → create a confirmed auth user (idempotent)
//   DELETE { email }            → delete the auth user (cleanup on owner removal)
//
// The caller must present a valid admin Bearer session.

interface Sb { url: string; serviceKey: string }

function getSupabaseConfig(): Sb {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) throw new Error('Supabase config missing')
  return { url, serviceKey }
}

// Verify the Bearer token belongs to an admin app_users row.
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

// Look up an existing auth user by email via the admin API.
async function findAuthUser(sb: Sb, email: string): Promise<{ id: string } | null> {
  const res = await fetch(
    `${sb.url}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
    { headers: { apikey: sb.serviceKey, Authorization: `Bearer ${sb.serviceKey}` } },
  )
  if (!res.ok) return null
  const data = (await res.json()) as { users?: Array<{ id: string; email?: string }> }
  const match = (data.users || []).find(u => (u.email || '').toLowerCase() === email)
  return match ? { id: match.id } : null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    res.setHeader('Allow', 'POST, DELETE')
    return res.status(405).json({ error: `Method ${req.method} not allowed` })
  }

  let sb: Sb
  try { sb = getSupabaseConfig() } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }

  if (!(await requireAdmin(sb, req.headers.authorization))) {
    return res.status(403).json({ error: 'Admin role required' })
  }

  const body = (req.body || {}) as { email?: string; password?: string }
  const email = (body.email || '').trim().toLowerCase()
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'A valid email is required' })
  }

  // ── DELETE: remove the auth login ──
  if (req.method === 'DELETE') {
    const existing = await findAuthUser(sb, email)
    if (!existing) return res.status(200).json({ ok: true, deleted: false })
    const del = await fetch(`${sb.url}/auth/v1/admin/users/${existing.id}`, {
      method: 'DELETE',
      headers: { apikey: sb.serviceKey, Authorization: `Bearer ${sb.serviceKey}` },
    })
    if (!del.ok) {
      return res.status(500).json({ error: `Failed to delete auth user: ${await del.text()}` })
    }
    return res.status(200).json({ ok: true, deleted: true })
  }

  // ── POST: create the auth login ──
  const password = body.password || ''
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' })
  }

  // Idempotent: if the login already exists, treat as success so the admin can
  // re-run after a partial failure without hitting a hard error.
  const existing = await findAuthUser(sb, email)
  if (existing) {
    return res.status(200).json({ ok: true, created: false, userId: existing.id })
  }

  const create = await fetch(`${sb.url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: sb.serviceKey,
      Authorization: `Bearer ${sb.serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
  if (!create.ok) {
    return res.status(500).json({ error: `Failed to create auth user: ${await create.text()}` })
  }
  const created = (await create.json()) as { id?: string }
  return res.status(200).json({ ok: true, created: true, userId: created.id })
}

export const config = { runtime: 'nodejs' }
