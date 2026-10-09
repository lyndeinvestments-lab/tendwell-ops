// Safety gate for the scripts that write throwaway data to a database
// (scripts/verify-vendor-portal.ts, scripts/verify-vendor-portal-http.ts).
//
// On 2026-10-08 the HTTP check was run against production: it created a test
// vendor in the live DB and the live server emailed Jordan that "ZZ E2E Vendor"
// had submitted a $35k invoice. These scripts must only ever target a
// non-production database, chosen explicitly through VERIFY_* env vars (never
// the app's own SUPABASE_URL / .env.local), and this check has no override.
//
// Pure: takes the env and the deployment URL, returns ok or a reason. The
// scripts call it through scripts/_nonprod-guard.ts before creating a client.
//
// Keep this file dependency-free.

/** The production Supabase project. */
export const PROD_SUPABASE_REF = 'eetsudoksvsmwtiqraot'
/** Production app + custom-domain Supabase (api.tendwellcleaningco.com). */
export const PROD_DOMAIN = 'tendwellcleaningco.com'

export interface VerifyTarget {
  supabaseUrl: string
  serviceRoleKey: string
  anonKey: string
  deploymentUrl: string | null
}

export type VerifyGuardResult = { ok: true; target: VerifyTarget } | { ok: false; reason: string }

function isProdHost(host: string): boolean {
  const h = host.toLowerCase()
  return h === PROD_DOMAIN || h.endsWith(`.${PROD_DOMAIN}`)
}

/** A legacy Supabase JWT key carries the project ref in its payload. */
function keyNamesProd(key: string): boolean {
  if (key.toLowerCase().includes(PROD_SUPABASE_REF)) return true
  const parts = key.split('.')
  if (parts.length !== 3) return false
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    return atob(b64).includes(PROD_SUPABASE_REF)
  } catch {
    return false
  }
}

export function checkVerifyTarget(
  env: Record<string, string | undefined>,
  opts: { deploymentUrl?: string | null; requireDeployment?: boolean } = {},
): VerifyGuardResult {
  const supabaseUrl = (env.VERIFY_SUPABASE_URL ?? '').trim()
  const serviceRoleKey = (env.VERIFY_SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
  const anonKey = (env.VERIFY_SUPABASE_ANON_KEY ?? '').trim()
  const missing = [
    !supabaseUrl && 'VERIFY_SUPABASE_URL',
    !serviceRoleKey && 'VERIFY_SUPABASE_SERVICE_ROLE_KEY',
    !anonKey && 'VERIFY_SUPABASE_ANON_KEY',
  ].filter(Boolean)
  if (missing.length) {
    return { ok: false, reason: `missing ${missing.join(', ')} (set them to a NON-production Supabase project; SUPABASE_URL and .env.local are deliberately ignored)` }
  }

  let sbHost: string
  try {
    const u = new URL(supabaseUrl)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('protocol')
    sbHost = u.hostname
  } catch {
    return { ok: false, reason: `VERIFY_SUPABASE_URL is not a valid http(s) URL: ${supabaseUrl}` }
  }
  if (supabaseUrl.toLowerCase().includes(PROD_SUPABASE_REF)) {
    return { ok: false, reason: `VERIFY_SUPABASE_URL points at the production project (${PROD_SUPABASE_REF}); these scripts never run against production` }
  }
  if (isProdHost(sbHost)) {
    return { ok: false, reason: `VERIFY_SUPABASE_URL host ${sbHost} is the production custom domain; these scripts never run against production` }
  }
  if (keyNamesProd(serviceRoleKey) || keyNamesProd(anonKey)) {
    return { ok: false, reason: `a VERIFY_SUPABASE_* key belongs to the production project (${PROD_SUPABASE_REF})` }
  }

  let deploymentUrl: string | null = null
  if (opts.requireDeployment || opts.deploymentUrl) {
    const raw = (opts.deploymentUrl ?? '').trim().replace(/\/$/, '')
    if (!raw) return { ok: false, reason: 'missing deployment URL (https://<preview-host>)' }
    let u: URL
    try {
      u = new URL(raw)
    } catch {
      return { ok: false, reason: `deployment URL is not a valid URL: ${raw}` }
    }
    if (u.protocol !== 'https:') return { ok: false, reason: `deployment URL must be https: ${raw}` }
    if (isProdHost(u.hostname)) {
      return { ok: false, reason: `deployment host ${u.hostname} is the production app; run against a preview deployment that uses VERIFY_SUPABASE_URL as its database` }
    }
    deploymentUrl = raw
  }

  return { ok: true, target: { supabaseUrl, serviceRoleKey, anonKey, deploymentUrl } }
}
