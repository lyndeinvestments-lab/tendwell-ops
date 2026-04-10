import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// Step 2 of OAuth2: exchange code for tokens and store them
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { code, realmId } = req.query
  if (!code) return res.status(400).json({ error: 'No authorization code' })

  const clientId = process.env.QBO_CLIENT_ID
  const clientSecret = process.env.QBO_CLIENT_SECRET
  const redirectUri = process.env.QBO_REDIRECT_URI
  if (!clientId || !clientSecret || !redirectUri) return res.status(500).json({ error: 'QBO not configured' })

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: redirectUri,
      }),
    })
    if (!tokenRes.ok) {
      const err = await tokenRes.text()
      throw new Error(`Token exchange failed: ${err}`)
    }
    const tokens = await tokenRes.json()

    // Store tokens in Supabase app_settings (encrypted at rest via Supabase)
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseKey) throw new Error('Supabase not configured')

    const supabase = createClient(supabaseUrl, supabaseKey)
    await supabase.from('app_settings').upsert({
      key: 'qbo_tokens',
      value: JSON.stringify({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: Date.now() + (tokens.expires_in || 3600) * 1000,
        realm_id: realmId || process.env.QBO_REALM_ID,
      }),
    }, { onConflict: 'key' })

    // Redirect back to the app
    return res.redirect('/#/settings?qbo=connected')
  } catch (err: any) {
    console.error('QBO callback error:', err)
    return res.redirect(`/#/settings?qbo=error&msg=${encodeURIComponent(err.message)}`)
  }
}
