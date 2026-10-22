// Ramp API helpers — server-side only, secrets never exposed to the client.

export const RAMP_API_BASE = 'https://api.ramp.com/developer/v1'

// Ramp's edge rejects requests without a recognizable User-Agent (Cloudflare 1010).
export const RAMP_USER_AGENT = 'tendwell-ops/1.0'

/** Client-credentials token for the given space-separated scopes. */
export async function getRampToken(scope: string): Promise<string> {
  const clientId = process.env.RAMP_CLIENT_ID
  const clientSecret = process.env.RAMP_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('Ramp credentials not configured')

  // Ramp requires Basic auth header for client_credentials flow
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const res = await fetch(`${RAMP_API_BASE}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': RAMP_USER_AGENT,
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Ramp auth failed: ${err}`)
  }
  const data = await res.json()
  return data.access_token
}
