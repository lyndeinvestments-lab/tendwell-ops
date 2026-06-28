import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAdminBearer } from '../qbo/_lib.js'

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

  // Auth: admin only — exposes company card spend / transaction data.
  const admin = await requireAdminBearer(req, res)
  if (!admin) return // requireAdminBearer already wrote the 401/403 response

  try {
    const rampToken = await getRampToken()

    // Support ?months=N window (default 12, clamped 1–12; negative values clamped to 1)
    const windowMonths = Math.max(1, Math.min(Number(req.query.months) || 12, 12))
    const since = new Date()
    since.setMonth(since.getMonth() - windowMonths)
    since.setDate(1)
    // Ramp's /transactions from_date requires a full RFC3339 datetime — a
    // date-only string (YYYY-MM-DD) is rejected with HTTP 422.
    const fromDate = since.toISOString()

    const MAX_TX = 3000
    const allTransactions: any[] = []
    let nextUrl: string | null = `${RAMP_API_BASE}/transactions?from_date=${fromDate}&page_size=100`

    // Paginate through all results (bounded to MAX_TX to avoid runaway)
    while (nextUrl && allTransactions.length < MAX_TX) {
      const txRes = await fetch(nextUrl, {
        headers: { Authorization: `Bearer ${rampToken}` },
      })
      if (!txRes.ok) throw new Error(`Ramp API error: ${txRes.status}`)
      const txData = await txRes.json()
      allTransactions.push(...(txData.data || []))
      nextUrl = txData.page?.next || null
    }

    // Summarize — backward-compatible fields
    let totalSpend = 0
    const byCategoryLegacy: Record<string, number> = {}
    const byMerchant: Record<string, number> = {}

    // New aggregation maps for byMonth + byCategory
    const byMonthMap = new Map<string, number>()
    const byCatMap = new Map<string, number>()

    for (const tx of allTransactions) {
      // amount field is in dollars
      const amount = Math.abs(tx.amount || 0)
      totalSpend += amount

      const cat = tx.sk_category_name || 'Uncategorized'
      byCategoryLegacy[cat] = (byCategoryLegacy[cat] || 0) + amount

      const merchant = tx.merchant_name || tx.merchant_descriptor || 'Unknown'
      byMerchant[merchant] = (byMerchant[merchant] || 0) + amount

      // Monthly aggregation — Ramp date fields (try both known variants)
      const rawDate = (tx.user_transaction_time || tx.transaction_time || '') as string
      const d = rawDate.slice(0, 10)
      if (d) {
        const ym = d.slice(0, 7) // "YYYY-MM"
        byMonthMap.set(ym, (byMonthMap.get(ym) || 0) + amount)
      }

      // Category aggregation (parallel to legacy, using same field)
      byCatMap.set(cat, (byCatMap.get(cat) || 0) + amount)
    }

    const topCategories = Object.entries(byCategoryLegacy)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, amount]) => ({ name, amount: Math.round(amount * 100) / 100 }))

    const topMerchants = Object.entries(byMerchant)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, amount]) => ({ name, amount: Math.round(amount * 100) / 100 }))

    // New aggregated arrays
    const byMonth = [...byMonthMap.entries()]
      .map(([month, total]) => ({ month, total: Math.round(total * 100) / 100 }))
      .sort((a, b) => a.month.localeCompare(b.month))

    const byCategory = [...byCatMap.entries()]
      .map(([category, total]) => ({ category, total: Math.round(total * 100) / 100 }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8)

    return res.json({
      // Backward-compatible fields (existing Financial Dashboard consumers)
      totalSpend: Math.round(totalSpend * 100) / 100,
      transactionCount: allTransactions.length,
      topCategories,
      topMerchants,
      period: `${windowMonths} month${windowMonths !== 1 ? 's' : ''}`,
      // New fields for Financial Overview page
      byMonth,
      byCategory,
      windowMonths,
      truncated: allTransactions.length >= MAX_TX,
    })
  } catch (err: any) {
    console.error('Ramp API error:', err)
    return res.status(500).json({ error: err.message || 'Failed to fetch Ramp data' })
  }
}
