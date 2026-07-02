import { supabase } from '@/lib/supabase'

// ─── Owner portal field permission model ──────────────────────────────────────
// Single source of truth for the per-owner/property "visible / editable" matrix.
// Each field key maps to one or more `properties` columns (see the
// 20260623c_owner_field_permissions.sql migration). The DB enforces these — the
// guard trigger for editability and get_owner_properties() for visibility — so
// this list must stay in sync with the migration.
export const OWNER_FIELD_DEFS = [
  { key: 'address',        label: 'Address' },
  { key: 'bed_sizes',      label: 'Bed sizes' },
  { key: 'bed_count',      label: 'Bed count' },
  { key: 'square_footage', label: 'Square footage' },
  { key: 'door_code',      label: 'Door / access code' },
  { key: 'auto_code',      label: 'Auto / lock code' },
  { key: 'other_codes',    label: 'Other codes' },
  { key: 'wifi_info',      label: 'Wi-Fi information' },
  { key: 'owner_contact',  label: 'Owner contact information' },
  { key: 'payment_method', label: 'Preferred payment method' },
] as const

export type OwnerFieldKey = (typeof OWNER_FIELD_DEFS)[number]['key']
export type OwnerFieldPerm = { visible: boolean; editable: boolean }
export type OwnerPermissions = Record<OwnerFieldKey, OwnerFieldPerm>

// Default for a property with no configured row: everything visible + editable,
// matching the original portal behavior for newly assigned properties.
export function defaultOwnerPermissions(): OwnerPermissions {
  return Object.fromEntries(
    OWNER_FIELD_DEFS.map(f => [f.key, { visible: true, editable: true }]),
  ) as OwnerPermissions
}

// Coerce arbitrary stored JSON into a complete, valid permission map. An
// editable field is always visible (editing requires seeing it).
export function normalizeOwnerPermissions(raw: unknown): OwnerPermissions {
  const base = defaultOwnerPermissions()
  if (raw && typeof raw === 'object') {
    for (const f of OWNER_FIELD_DEFS) {
      const p = (raw as Record<string, any>)[f.key]
      if (p && typeof p === 'object') {
        const editable = !!p.editable
        base[f.key] = { visible: editable || !!p.visible, editable }
      }
    }
  }
  return base
}

async function getToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token || null
}

// Create the Supabase Auth email/password login for an owner. Requires the
// service role, so it runs server-side (admin-gated) at /api/owners/provision.
export async function provisionOwnerLogin(
  email: string,
  password: string,
): Promise<{ ok: boolean; created?: boolean; error?: string }> {
  const token = await getToken()
  if (!token) return { ok: false, error: 'Not signed in' }
  try {
    const res = await fetch('/api/owners/provision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ email, password }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: data.error || `Failed (${res.status})` }
    return { ok: true, created: data.created }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Network error' }
  }
}

// Delete an owner's Supabase Auth login (cleanup when removing an owner).
export async function deleteOwnerLogin(email: string): Promise<{ ok: boolean; error?: string }> {
  const token = await getToken()
  if (!token) return { ok: false, error: 'Not signed in' }
  try {
    const res = await fetch('/api/owners/provision', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ email }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: data.error || `Failed (${res.status})` }
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Network error' }
  }
}

// Change the signed-in owner's login email. Runs server-side (service role) so
// the email is updated immediately and property_owners.email is kept in sync.
export async function changeOwnerEmail(newEmail: string): Promise<{ ok: boolean; error?: string }> {
  const token = await getToken()
  if (!token) return { ok: false, error: 'Not signed in' }
  try {
    const res = await fetch('/api/owners/change-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ newEmail }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: data.error || `Failed (${res.status})` }
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Network error' }
  }
}
