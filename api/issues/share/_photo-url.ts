/** Hosts allowed for issue photo URLs (this project's Storage only). */
export function allowedPhotoHosts(
  env: NodeJS.ProcessEnv = process.env,
): Set<string> {
  const hosts = new Set<string>()
  for (const raw of [env.VITE_SUPABASE_URL, env.SUPABASE_URL]) {
    if (!raw) continue
    try {
      hosts.add(new URL(raw).host.toLowerCase())
    } catch {
      /* ignore */
    }
  }
  // Custom Supabase domain used in production CSP / client config.
  hosts.add('api.tendwellcleaningco.com')
  return hosts
}

/**
 * Accept only https URLs on this project's Storage host whose path is a
 * public object under the issue-photos bucket.
 */
export function isAllowedIssuePhotoUrl(
  photoUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  let parsed: URL
  try {
    parsed = new URL(photoUrl)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  if (!allowedPhotoHosts(env).has(parsed.host.toLowerCase())) return false
  // Supabase public object paths look like:
  //   /storage/v1/object/public/issue-photos/<...>
  const path = parsed.pathname.toLowerCase()
  return path.includes('/storage/v1/object/public/issue-photos/')
}
