import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Hostaway → Supabase listing sync core.
// Fetches all listings from the Hostaway API (OAuth2 client-credentials) and
// upserts them into hostaway_listing_snapshot. All matching/diff logic lives
// in the hostaway_reconciliation SQL view — this stays a dumb ingest, same
// pattern as api/trellis/_sync-core.ts.
//
// Env (server-side only):
// - HOSTAWAY_ACCOUNT_ID  — Hostaway account ID (OAuth client_id)
// - HOSTAWAY_API_KEY     — API key from Hostaway → Settings → Hostaway API
//                          (OAuth client_secret)

const HOSTAWAY_BASE = 'https://api.hostaway.com/v1'
const PAGE_SIZE = 100
const MAX_LISTINGS = 5000 // runaway-pagination backstop

export function makeServiceSupabase(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured')
  return createClient(url, key, { auth: { persistSession: false } })
}

async function getAccessToken(): Promise<string> {
  const accountId = process.env.HOSTAWAY_ACCOUNT_ID
  const apiKey = process.env.HOSTAWAY_API_KEY
  if (!accountId || !apiKey) throw new Error('HOSTAWAY_ACCOUNT_ID / HOSTAWAY_API_KEY not configured')
  const res = await fetch(`${HOSTAWAY_BASE}/accessTokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: accountId,
      client_secret: apiKey,
      scope: 'general',
    }).toString(),
  })
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 300)
    throw new Error(`Hostaway auth failed (${res.status}): ${body}`)
  }
  const json = (await res.json()) as { access_token?: string }
  if (!json.access_token) throw new Error('Hostaway auth: no access_token in response')
  return json.access_token
}

async function fetchAllListings(token: string): Promise<any[]> {
  const all: any[] = []
  for (let offset = 0; offset < MAX_LISTINGS; offset += PAGE_SIZE) {
    const res = await fetch(`${HOSTAWAY_BASE}/listings?limit=${PAGE_SIZE}&offset=${offset}`, {
      headers: { Authorization: `Bearer ${token}`, 'Cache-control': 'no-cache' },
    })
    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 300)
      throw new Error(`Hostaway listings failed (${res.status}): ${body}`)
    }
    const json = (await res.json()) as { status?: string; result?: any[] }
    if (json.status !== 'success' || !Array.isArray(json.result)) {
      throw new Error(`Hostaway listings: unexpected response shape (status=${json.status})`)
    }
    all.push(...json.result)
    if (json.result.length < PAGE_SIZE) break
  }
  return all
}

// Keep the raw column useful but bounded — full listing objects are huge
// (amenities, images, descriptions). Whitelist the fields we may want later
// (e.g. bed-type breakdown for the linen formula).
const RAW_KEYS = [
  'id', 'name', 'externalListingName', 'internalListingName',
  'address', 'street', 'city', 'state', 'zipcode', 'countryCode', 'lat', 'lng',
  'personCapacity', 'bedroomsNumber', 'bathroomsNumber', 'bedsNumber',
  'guestBathroomsNumber', 'roomType', 'propertyTypeId', 'squareMeters',
  'listingBedTypes', 'instantBookable',
] as const

function pickRaw(l: any): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of RAW_KEYS) if (l[k] !== undefined) out[k] = l[k]
  return out
}

export interface SyncCounts {
  listings: number
  removed: number
}

export async function runSync(_opts: { trigger: 'manual' | 'nightly' } = { trigger: 'manual' }): Promise<SyncCounts> {
  const sb = makeServiceSupabase()
  const token = await getAccessToken()
  const listings = await fetchAllListings(token)
  const syncedAt = new Date().toISOString()

  const rows = listings
    .filter((l) => l && typeof l.id === 'number')
    .map((l) => ({
      hostaway_id: l.id,
      name: l.externalListingName || l.name || null,
      internal_name: l.internalListingName || null,
      address: l.address || [l.street, l.city, l.state, l.zipcode].filter(Boolean).join(', ') || null,
      city: l.city ?? null,
      state: l.state ?? null,
      zipcode: l.zipcode ?? null,
      bedrooms: l.bedroomsNumber ?? null,
      bathrooms: l.bathroomsNumber ?? null,
      beds: l.bedsNumber ?? null,
      person_capacity: l.personCapacity ?? null,
      raw: pickRaw(l),
      synced_at: syncedAt,
      // matched_property_id deliberately omitted: PostgREST upsert only sets
      // provided columns, so manual matches survive every sync.
    }))

  for (let i = 0; i < rows.length; i += PAGE_SIZE) {
    const { error } = await sb
      .from('hostaway_listing_snapshot')
      .upsert(rows.slice(i, i + PAGE_SIZE), { onConflict: 'hostaway_id' })
    if (error) throw new Error(`snapshot upsert: ${error.message}`)
  }

  // Remove snapshot rows for listings deleted in Hostaway.
  const { data: existing, error: selErr } = await sb
    .from('hostaway_listing_snapshot')
    .select('hostaway_id')
  if (selErr) throw new Error(`snapshot select: ${selErr.message}`)
  const fetched = new Set(rows.map((r) => r.hostaway_id))
  const stale = (existing ?? [])
    .map((r: any) => r.hostaway_id as number)
    .filter((id) => !fetched.has(id))
  for (let i = 0; i < stale.length; i += PAGE_SIZE) {
    const { error } = await sb
      .from('hostaway_listing_snapshot')
      .delete()
      .in('hostaway_id', stale.slice(i, i + PAGE_SIZE))
    if (error) throw new Error(`snapshot stale delete: ${error.message}`)
  }

  return { listings: rows.length, removed: stale.length }
}
