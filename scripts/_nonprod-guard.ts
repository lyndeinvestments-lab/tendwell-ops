// Shared entry gate for the verify scripts. Call it FIRST, before creating any
// Supabase client or importing modules that read process.env.
//
// The decision itself is the pure, unit-tested checkVerifyTarget() in
// shared/verify-guard.ts: the target comes only from VERIFY_SUPABASE_URL /
// VERIFY_SUPABASE_SERVICE_ROLE_KEY / VERIFY_SUPABASE_ANON_KEY, production is
// refused with no override, and so is any *.tendwellcleaningco.com deployment.
//
// On success it also points the app's own env names at the verify target (so
// any imported api/ module that reads SUPABASE_URL hits the same non-prod DB)
// and sets NOTIFY_DISABLED=1 so nothing this process runs can send email.

import { checkVerifyTarget, type VerifyTarget } from '../shared/verify-guard.js'

export function requireNonProdTarget(opts: { deploymentUrl?: string | null; requireDeployment?: boolean } = {}): VerifyTarget {
  const result = checkVerifyTarget(process.env, opts)
  if (!result.ok) {
    console.error(`REFUSING TO RUN: ${result.reason}`)
    process.exit(2)
  }
  const t = result.target
  process.env.SUPABASE_URL = t.supabaseUrl
  process.env.VITE_SUPABASE_URL = t.supabaseUrl
  process.env.SUPABASE_SERVICE_ROLE_KEY = t.serviceRoleKey
  process.env.VITE_SUPABASE_ANON_KEY = t.anonKey
  process.env.NOTIFY_DISABLED = '1'
  console.log(`verify target: ${t.supabaseUrl}${t.deploymentUrl ? ` via ${t.deploymentUrl}` : ''}`)
  return t
}
