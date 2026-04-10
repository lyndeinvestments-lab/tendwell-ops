import type { VercelRequest, VercelResponse } from '@vercel/node'

// Ramp API proxy — server-side only, secrets never exposed to client
// Fetches recent transactions/spend data from Ramp
// Requires: RAMP_CLIENT_ID, RAMP_CLIENT_SECRET env vars

const RAMP_API_BASE = 'https://api.ramp.com/developer/v1'

async function getRampToken(): Promise<string> {
  const clientId = process.env.RAMP_CLIENT_ID
  const clientSecret = process.env.RAMP_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('Ramp credentials not configured')

  const res = await fetch('https://api.ramp.com/developer/v1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'transactions:read',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })
  if (!res.ok) throw new Error(`Ramp auth failed: ${res.status}`)
  const data = await res.json()
  return data.access_token
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow GET
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  // Auth check: require Supabase session token in Authorization header
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // Verify the Supabase token to confirm the user is authenticated
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseKey) return res.status(500).json({ error: 'Server config error' })

  const token = authHeader.slice(7)
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: supabaseKey },
  })
  if (!userRes.ok) return res.status(401).json({ error: 'Invalid session' })

  try {
    const rampToken = await getRampToken()

    // Fetch recent transactions (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const txRes = await fetch(
      `${RAMP_API_BASE}/transactions?from_date=${thirtyDaysAgo}&page_size=100`,
      { headers: { Authorization: `Bearer ${rampToken}` } }
    )
    if (!txRes.ok) throw new Error(`Ramp API error: ${txRes.status}`)
    const txData = await txRes.json()

    // Summarize: total spend, by category, by merchant
    const transactions = txData.data || []
    let totalSpend = 0
    const byCategory: Record<string, number> = {}
    const byMerchant: Record<string, number> = {}

    for (const tx of transactions) {
      const amount = Math.abs(tx.amount || 0)
      totalSpend += amount
      const cat = tx.sk_category_name || tx.category?.name || 'Uncategorized'
      byCategory[cat] = (byCategory[cat] || 0) + amount
      const merchant = tx.merchant_name || tx.merchant_descriptor || 'Unknown'
      byMerchant[merchant] = (byMerchant[merchant] || 0) + amount
    }

    // Sort and limit
    const topCategories = Object.entries(byCategory)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, amount]) => ({ name, amount: Math.round(amount * 100) / 100 }))

    const topMerchants = Object.entries(byMerchant)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, amount]) => ({ name, amount: Math.round(amount * 100) / 100 }))

    return res.json({
      totalSpend: Math.round(totalSpend * 100) / 100,
      transactionCount: transactions.length,
      topCategories,
      topMerchants,
      period: '30 days',
    })
  } catch (err: any) {
    console.error('Ramp API error:', err)
    return res.status(500).json({ error: err.message || 'Failed to fetch Ramp data' })
  }
}
