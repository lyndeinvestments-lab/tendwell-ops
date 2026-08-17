import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { getFreshQboTokens, qboApiBase, requireAdminBearer } from './_lib.js'

// QBO API proxy — fetches P&L and balance data
// Tokens are stored in app_settings, refreshed automatically (see _lib.ts)

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
    const tokens = await getFreshQboTokens(supabase)
    if (!tokens) return res.status(400).json({ error: 'QuickBooks not connected', needsAuth: true })

    const realmId = tokens.realm_id || process.env.QBO_REALM_ID
    const base = qboApiBase(env)
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
