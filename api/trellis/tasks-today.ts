import type { VercelRequest, VercelResponse } from '@vercel/node'

// Returns today's Trellis task count by asking a Trellis agent.
// Trellis's public API doesn't expose a plain "list tasks" REST endpoint,
// so we POST to /v1/agent/invoke with a count-only prompt and parse the
// integer out of the reply. Lightweight but each pageview bills one invoke.
//
// Self-contained (no _lib import) — sibling _lib bundling via includeFiles
// was not reliably bundling at runtime, and this endpoint is small enough
// to inline.

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

// Tries x-api-key first (matches Jordan's internal docs). If Trellis
// rejects with 401/403 we retry with Authorization: Bearer (matches the
// published OpenAPI spec). Whichever succeeds first wins.
async function invokeTrellis(key: string, message: string): Promise<{ ok: true; data: any } | { ok: false; status: number; body: string }> {
  const body = JSON.stringify({ message })
  const base: Record<string, string> = { 'Content-Type': 'application/json' }
  const attempts = [
    { ...base, 'x-api-key': key },
    { ...base, Authorization: `Bearer ${key}` },
  ]
  let lastStatus = 0
  let lastBody = ''
  for (const headers of attempts) {
    const r = await fetch(`${TRELLIS_API_BASE}/agent/invoke`, { method: 'POST', headers, body })
    const text = await r.text()
    if (r.ok) {
      try { return { ok: true, data: JSON.parse(text) } } catch { return { ok: true, data: { response: text } } }
    }
    lastStatus = r.status
    lastBody = text
    // 401/403 = key rejected by that auth scheme; 422 = Trellis complaining
    // the expected header (Authorization per OpenAPI) was missing because we
    // sent x-api-key instead. Any other status means the call reached the
    // right place — don't retry and risk double-billing an invoke.
    if (![401, 403, 422].includes(r.status)) break
  }
  return { ok: false, status: lastStatus, body: lastBody }
}

// Extract a non-negative integer from the agent's reply. The agent is
// instructed to answer with one integer only, but models drift.
function parseCount(reply: string): number | null {
  if (!reply) return null
  const m = reply.match(/(?<![\d.])(\d+)(?![\d.])/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return Number.isFinite(n) && n >= 0 ? n : null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Require a valid Supabase session — each call bills a Trellis agent invoke,
  // so this must not be reachable by unauthenticated traffic.
  const authHeader = req.headers.authorization
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!authHeader?.startsWith('Bearer ') || !supabaseUrl || !supabaseKey) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: supabaseKey },
  })
  if (!userRes.ok) {
    res.status(401).json({ error: 'Invalid session' })
    return
  }

  try {
    const key = process.env.TRELLIS_API_KEY
    if (!key) {
      res.status(503).json({ error: 'TRELLIS_API_KEY not configured', hint: 'Set TRELLIS_API_KEY in Vercel env, then redeploy.' })
      return
    }
    const date = todayInCentral()
    const prompt = `How many open tasks are due on ${date} (today, America/Chicago)? Reply with a single non-negative integer and nothing else. If no tasks are due, reply 0.`
    const result = await invokeTrellis(key, prompt)
    if (!result.ok) {
      res.status(result.status || 502).json({
        error: `Trellis invoke failed (${result.status})`,
        body: result.body.slice(0, 500),
        hint: 'Check that TRELLIS_API_KEY is a valid Workspace API key.',
      })
      return
    }
    const reply = typeof result.data?.response === 'string' ? result.data.response : String(result.data?.response ?? '')
    const count = parseCount(reply)
    if (count == null) {
      res.status(502).json({
        error: 'Agent reply did not include an integer count',
        reply: reply.slice(0, 500),
        hint: 'Open /api/trellis/tasks-today in the browser to see the raw agent reply, then adjust the prompt if needed.',
      })
      return
    }
    res.status(200).json({ date, count, source: 'agent', reply: reply.slice(0, 200), timed_out: Boolean(result.data?.timed_out) })
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
  }
}
