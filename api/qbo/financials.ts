import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { requireAdminBearer } from './_lib.js'

// QBO API proxy — fetches P&L and balance data
// Tokens are stored in app_settings, refreshed automatically

const QBO_BASE = (env: string) =>
  env === 'sandbox' ? 'https://sandbox-quickbooks.api.intuit.com' : 'https://quickbooks.api.intuit.com'

async function getTokens(supabase: any): Promise<{ access_token: string; refresh_token: string; realm_id: string; expires_at: number } | null> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', 'qbo_tokens').single()
  if (!data?.value) return null
  return typeof data.value === 'string' ? JSON.parse(data.value) : data.value
}

async function refreshTokens(supabase: any, tokens: any): Promise<any> {
  const clientId = process.env.QBO_CLIENT_ID
  const clientSecret = process.env.QBO_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('QBO credentials missing')

  const res = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
    }),
  })
  if (!res.ok) throw new Error('Token refresh failed — reconnect QuickBooks')
  const newTokens = await res.json()

  const updated = {
    access_token: newTokens.access_token,
    refresh_token: newTokens.refresh_token,
    expires_at: Date.now() + (newTokens.expires_in || 3600) * 1000,
    realm_id: tokens.realm_id,
  }
  await supabase.from('app_settings').upsert({ key: 'qbo_tokens', value: JSON.stringify(updated) }, { onConflict: 'key' })
  return updated
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  // Auth: admin only — exposes company-wide P&L / financial data.
  const admin = await requireAdminBearer(req, res)
  if (!admin) return // requireAdminBearer already wrote the 401/403 response

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseKey) return res.status(500).json({ error: 'Server config error' })

  const supabase = createClient(supabaseUrl, supabaseKey)
  const env = process.env.QBO_ENVIRONMENT || 'sandbox'

  try {
    let tokens = await getTokens(supabase)
    if (!tokens) return res.status(400).json({ error: 'QuickBooks not connected', needsAuth: true })

    // Refresh if expired (with 5 min buffer)
    if (Date.now() > tokens.expires_at - 300000) {
      tokens = await refreshTokens(supabase, tokens)
    }

    const realmId = tokens.realm_id || process.env.QBO_REALM_ID
    const base = QBO_BASE(env)
    const headers = {
      Authorization: `Bearer ${tokens.access_token}`,
      Accept: 'application/json',
    }

    // Fetch P&L report (current month)
    const now = new Date()
    const startOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    const today = now.toISOString().split('T')[0]

    const plRes = await fetch(
      `${base}/v3/company/${realmId}/reports/ProfitAndLoss?start_date=${startOfMonth}&end_date=${today}&minorversion=65`,
      { headers }
    )

    let profitLoss = null
    if (plRes.ok) {
      const plData = await plRes.json()
      // Extract summary from QBO report format
      const rows = plData?.Rows?.Row || []
      let totalIncome = 0, totalExpenses = 0
      for (const row of rows) {
        if (row.group === 'Income' && row.Summary?.ColData) {
          totalIncome = parseFloat(row.Summary.ColData[1]?.value || '0')
        }
        if (row.group === 'Expense' && row.Summary?.ColData) {
          totalExpenses = parseFloat(row.Summary.ColData[1]?.value || '0')
        }
      }
      profitLoss = {
        totalIncome: Math.round(totalIncome * 100) / 100,
        totalExpenses: Math.round(totalExpenses * 100) / 100,
        netIncome: Math.round((totalIncome - totalExpenses) * 100) / 100,
        period: `${startOfMonth} to ${today}`,
      }
    }

    // Fetch company info
    const compRes = await fetch(
      `${base}/v3/company/${realmId}/companyinfo/${realmId}?minorversion=65`,
      { headers }
    )
    let companyName = null
    if (compRes.ok) {
      const compData = await compRes.json()
      companyName = compData?.CompanyInfo?.CompanyName
    }

    return res.json({
      connected: true,
      companyName,
      profitLoss,
      environment: env,
    })
  } catch (err: any) {
    console.error('QBO API error:', err)
    if (err.message?.includes('reconnect')) {
      return res.status(400).json({ error: err.message, needsAuth: true })
    }
    return res.status(500).json({ error: err.message || 'Failed to fetch QBO data' })
  }
}
