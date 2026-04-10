import type { VercelRequest, VercelResponse } from '@vercel/node'

// Step 1 of OAuth2: redirect user to QuickBooks authorization page
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const clientId = process.env.QBO_CLIENT_ID
  const redirectUri = process.env.QBO_REDIRECT_URI
  if (!clientId || !redirectUri) return res.status(500).json({ error: 'QBO not configured' })

  const authUrl = new URL('https://appcenter.intuit.com/connect/oauth2')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', 'com.intuit.quickbooks.accounting')
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('state', 'tendwell-qbo-auth')

  return res.redirect(authUrl.toString())
}
