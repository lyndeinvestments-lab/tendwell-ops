import { supabase } from '@/lib/supabase'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SignAgreementPayload {
  agreementId: string
  signatureDataUrl: string
  ownerName: string
  entity: string
  mailingAddress: string
  propertyAddresses: string
  email: string
  phone: string
  ownerPrintedName: string
  ownerTitle: string
  consent: true
}

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function getToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token || null
}

// ─── Client helpers ───────────────────────────────────────────────────────────

/**
 * Submit a signed agreement. The owner's drawn signature, party fields, and
 * consent must all be present. The server validates ownership + status and
 * generates + stores the signed PDF.
 */
export async function signAgreement(
  payload: SignAgreementPayload,
): Promise<{ ok: boolean; error?: string }> {
  const token = await getToken()
  if (!token) return { ok: false, error: 'Not signed in' }
  try {
    const res = await fetch('/api/agreements/sign', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: data.error || `Failed (${res.status})` }
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Network error' }
  }
}

/**
 * Get a short-lived signed URL for downloading the signed PDF.
 * The caller must be the agreement's owner or a staff member.
 */
export async function getAgreementDownloadUrl(
  id: string,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const token = await getToken()
  if (!token) return { ok: false, error: 'Not signed in' }
  try {
    const res = await fetch(`/api/agreements/download?id=${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: data.error || `Failed (${res.status})` }
    return { ok: true, url: data.url }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Network error' }
  }
}
