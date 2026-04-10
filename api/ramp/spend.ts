import type { VercelRequest, VercelResponse } from '@vercel/node'

// Ramp API proxy — server-side only, secrets never exposed to client
const RAMP_API_BASE = 'https://api.ramp.com/developer/v1'

async function getRampToken(): Promise<string> {
  const clientId = process.env.RAMP_CLIENT_ID
  const clientSecret = process.env.RAMP_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('Ramp credentials not configured')

  // Ramp requires Basic auth header for client_credentials flow
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const res = await fetch(`${RAMP_API_BASE}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'transactions:read',
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Ramp auth failed: ${err}`)
  }
  const data = await res.json()
  return data.access_token
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  // Auth: verify Supabase session
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })

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
    const allTransactions: any[] = []
    let nextUrl: string | null = `${RAMP_API_BASE}/transactions?from_date=${thirtyDaysAgo}&page_size=100`

    // Paginate through all results
    while (nextUrl && allTransactions.length < 500) {
      const txRes = await fetch(nextUrl, {
        headers: { Authorization: `Bearer ${rampToken}` },
      })
      if (!txRes.ok) throw new Error(`Ramp API error: ${txRes.status}`)
      const txData = await txRes.json()
      allTransactions.push(...(txData.data || []))
      nextUrl = txData.page?.next || null
    }

    // Summarize
    let totalSpend = 0
    const byCategory: Record<string, number> = {}
    const byMerchant: Record<string, number> = {}

    for (const tx of allTransactions) {
      // amount field is in dollars
      const amount = Math.abs(tx.amount || 0)
      totalSpend += amount

      const cat = tx.sk_category_name || 'Uncategorized'
      byCategory[cat] = (byCategory[cat] || 0) + amount

      const merchant = tx.merchant_name || tx.merchant_descriptor || 'Unknown'
      byMerchant[merchant] = (byMerchant[merchant] || 0) + amount
    }

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
      transactionCount: allTransactions.length,
      topCategories,
      topMerchants,
      period: '30 days',
    })
  } catch (err: any) {
    console.error('Ramp API error:', err)
    return res.status(500).json({ error: err.message || 'Failed to fetch Ramp data' })
  }
}
