import type { VercelRequest, VercelResponse } from '@vercel/node'

// Returns today's Trellis tasks. Self-contained (no _lib import) while we
// diagnose why importing from ./\_lib fails at runtime in Vercel.

const TRELLIS_API_BASE = 'https://api.trellistech.com/v1'

function todayInCentral(): string {
  const now = new Date()
  const year = now.getUTCFullYear()
  const marchStart = new Date(Date.UTC(year, 2, 1))
  const dstStart = new Date(Date.UTC(year, 2, 1 + ((14 - marchStart.getUTCDay()) % 7) + 7, 8, 0, 0))
  const novStart = new Date(Date.UTC(year, 10, 1))
  const dstEnd = new Date(Date.UTC(year, 10, 1 + ((7 - novStart.getUTCDay()) % 7), 7, 0, 0))
  const isDst = now >= dstStart && now < dstEnd
  const offsetHours = isDst ? 5 : 6
  return new Date(now.getTime() - offsetHours * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const key = process.env.TRELLIS_API_KEY
    if (!key) {
      res.status(503).json({ error: 'TRELLIS_API_KEY not configured', hint: 'Set TRELLIS_API_KEY in Vercel env, then redeploy.' })
      return
    }
    const date = todayInCentral()
    const upstream = await fetch(`${TRELLIS_API_BASE}/operations/tasks?due_date=${date}&status=open`, {
      method: 'GET',
      headers: {
        'x-api-key': key,
        'Content-Type': 'application/json',
      },
    })
    const text = await upstream.text()
    if (!upstream.ok) {
      res.status(upstream.status).json({
        error: `Trellis API ${upstream.status}`,
        body: text.slice(0, 500),
        hint: 'Verify the Trellis task filter — param name or status value may differ from the assumed due_date/status=open.',
      })
      return
    }
    let parsed: any
    try { parsed = text ? JSON.parse(text) : {} } catch { parsed = {} }
    const tasks = Array.isArray(parsed) ? parsed : (parsed.data ?? parsed.items ?? parsed.results ?? parsed.tasks ?? [])
    res.status(200).json({ date, count: tasks.length, tasks })
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : undefined })
  }
}
