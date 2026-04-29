import type { VercelRequest, VercelResponse } from '@vercel/node'
import { buildStateCookie, generateState, requireAdminBearer } from './_lib.js'

// Step 1 of OAuth2: build the QuickBooks authorize URL. Now admin-gated and
// state-bound:
//   (1) the caller must present a valid admin Bearer session
//   (2) we mint a fresh random `state` nonce per call and store it in an
//       HttpOnly cookie scoped to /api/qbo
//   (3) the callback verifies cookie equals the `state` query param
//
// Without all three, the previous version allowed an unauthenticated
// attacker to overwrite Tendwell's QBO tokens by completing OAuth with
// their own QuickBooks account (security audit finding #1).
//
// Response shape changed: returns { url } JSON instead of a 302 redirect,
// so the client must navigate via window.location.href = response.url.
// That's required because the auth check needs the Bearer header that
// browsers don't carry on top-level navigation.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: `Method ${req.method} not allowed` })
  }

  const admin = await requireAdminBearer(req, res)
  if (!admin) return // requireAdminBearer already wrote the 401/403 response

  const clientId = process.env.QBO_CLIENT_ID
  const redirectUri = process.env.QBO_REDIRECT_URI
  if (!clientId || !redirectUri) return res.status(500).json({ error: 'QBO not configured' })

  const state = generateState()

  const authUrl = new URL('https://appcenter.intuit.com/connect/oauth2')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', 'com.intuit.quickbooks.accounting')
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('state', state)

  res.setHeader('Set-Cookie', buildStateCookie(state))
  return res.status(200).json({ url: authUrl.toString() })
}
