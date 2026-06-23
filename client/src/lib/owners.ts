import { supabase } from '@/lib/supabase'

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
