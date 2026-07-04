import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSupabaseConfig } from './_lib'

// GET /api/agreements/download?id=<uuid> — caller must be the agreement's owner OR staff.
//
// Returns a short-lived signed URL (5 min) for the signed PDF stored in
// Supabase Storage at agreements/signed/<id>.pdf.
//
// → { ok: true, url: string } | { error: string }

interface Sb { url: string; serviceKey: string }

/** Resolve the auth user from a Bearer token. Returns email or null. */
async function resolveCallerEmail(sb: Sb, token: string): Promise<string | null> {
  const res = await fetch(`${sb.url}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: sb.serviceKey },
  })
  if (!res.ok) return null
  const user = (await res.json()) as { email?: string }
  return user.email ? user.email.toLowerCase() : null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: `Method ${req.method} not allowed` })
  }

  let sb: ReturnType<typeof getSupabaseConfig>
  try {
    sb = getSupabaseConfig()
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = req.headers.authorization || ''
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not signed in' })
  }
  const token = authHeader.slice(7)

  let callerEmail: string | null
  try {
    callerEmail = await resolveCallerEmail(sb, token)
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }
  if (!callerEmail) {
    return res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' })
  }

  // ── Agreement id ──────────────────────────────────────────────────────────
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const id = (req.query.id as string | undefined) || ''
  if (!id) {
    return res.status(400).json({ error: 'id is required' })
  }
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: 'Invalid agreement id.' })
  }

  // ── Load agreement (service role) ─────────────────────────────────────────
  const agreementRes = await fetch(
    `${sb.url}/rest/v1/owner_agreements?id=eq.${encodeURIComponent(id)}&limit=1`,
    { headers: { apikey: sb.serviceKey, Authorization: `Bearer ${sb.serviceKey}` } },
  )
  if (!agreementRes.ok) {
    const errText = await agreementRes.text()
    return res.status(500).json({ error: `Failed to load agreement (${agreementRes.status}): ${errText}` })
  }
  const agreementRows = (await agreementRes.json()) as Array<Record<string, unknown>>
  const row = agreementRows[0]

  if (!row || row.status !== 'signed' || !row.signed_pdf_path) {
    return res.status(404).json({ error: 'Signed agreement not found.' })
  }

  // ── Determine caller identity: owner or staff ─────────────────────────────
  // Check property_owners by email
  const ownerRes = await fetch(
    `${sb.url}/rest/v1/property_owners?select=id&email=eq.${encodeURIComponent(callerEmail)}&active=eq.true&limit=1`,
    { headers: { apikey: sb.serviceKey, Authorization: `Bearer ${sb.serviceKey}` } },
  )
  if (!ownerRes.ok) {
    const errText = await ownerRes.text()
    return res.status(500).json({ error: `Owner lookup failed (${ownerRes.status}): ${errText}` })
  }
  const ownerRows = (await ownerRes.json()) as Array<{ id: string }>
  const callerOwnerId = ownerRows[0]?.id ?? null

  let isStaff = false
  if (!callerOwnerId) {
    // Check app_users by google_email (staff)
    const staffRes = await fetch(
      `${sb.url}/rest/v1/app_users?select=id&google_email=eq.${encodeURIComponent(callerEmail)}&limit=1`,
      { headers: { apikey: sb.serviceKey, Authorization: `Bearer ${sb.serviceKey}` } },
    )
    if (!staffRes.ok) {
      const errText = await staffRes.text()
      return res.status(500).json({ error: `Staff lookup failed (${staffRes.status}): ${errText}` })
    }
    const staffRows = (await staffRes.json()) as Array<{ id: string }>
    isStaff = staffRows.length > 0
  }

  // ── Access control ────────────────────────────────────────────────────────
  const isOwnerOfAgreement = callerOwnerId !== null && callerOwnerId === row.owner_id
  if (!isOwnerOfAgreement && !isStaff) {
    return res.status(403).json({ error: 'You do not have access to this agreement.' })
  }

  // ── Create signed URL (5 min TTL) ─────────────────────────────────────────
  // Use the path recorded at signing time (validated non-null above) rather
  // than reconstructing it, so a future path-scheme change can't desync.
  const storagePath = row.signed_pdf_path as string
  const signRes = await fetch(
    `${sb.url}/storage/v1/object/sign/agreements/${storagePath}`,
    {
      method: 'POST',
      headers: {
        apikey: sb.serviceKey,
        Authorization: `Bearer ${sb.serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: 300 }),
    },
  )
  if (!signRes.ok) {
    const errText = await signRes.text()
    return res.status(500).json({ error: `Failed to create signed URL (${signRes.status}): ${errText}` })
  }
  const signData = (await signRes.json()) as { signedURL?: string }
  if (!signData.signedURL) {
    return res.status(500).json({ error: 'Storage did not return a signed URL.' })
  }

  // Guard: some Supabase versions return an absolute URL; others return a relative path.
  const url = signData.signedURL.startsWith('http')
    ? signData.signedURL
    : `${sb.url}/storage/v1${signData.signedURL}`

  return res.status(200).json({ ok: true, url })
}

export const config = { runtime: 'nodejs' }
