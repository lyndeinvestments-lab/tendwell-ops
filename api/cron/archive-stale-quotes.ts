import type { VercelRequest, VercelResponse } from '@vercel/node'

// Vercel-scheduled auto-archive of stale quotes. Archives any Quote-stage
// property whose created_at (the "quote added" date) is older than
// MAX_AGE_DAYS and isn't already archived. Runs daily via the schedule in
// vercel.json (`/api/cron/archive-stale-quotes`).
//
// Delegates to the archive_stale_quotes() SECURITY DEFINER RPC so the work
// runs as parameterized SQL under the service role. Reversible: archived
// quotes remain visible under the quote-sheet Archived/All views and can be
// restored. Vercel authenticates the cron via CRON_SECRET.

const MAX_AGE_DAYS = 90

function getEnv(): { url: string; serviceKey: string } {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) throw new Error('Supabase config missing')
  return { url, serviceKey }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Fail closed: a missing CRON_SECRET is a misconfiguration, not permit-all.
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('CRON_SECRET not configured; refusing to run')
    return res.status(500).json({ error: 'Server misconfigured' })
  }
  const header = req.headers.authorization || ''
  if (header !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  let cfg
  try { cfg = getEnv() } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }

  try {
    const rpcRes = await fetch(
      `${cfg.url}/rest/v1/rpc/archive_stale_quotes`,
      {
        method: 'POST',
        headers: {
          apikey: cfg.serviceKey,
          Authorization: `Bearer ${cfg.serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ max_age_days: MAX_AGE_DAYS }),
      },
    )
    if (!rpcRes.ok) {
      return res.status(500).json({ error: `Archive RPC failed: ${rpcRes.status} ${await rpcRes.text()}` })
    }
    const archived = (await rpcRes.json()) as number

    return res.json({ ok: true, archived, maxAgeDays: MAX_AGE_DAYS })
  } catch (err: any) {
    console.error('archive-stale-quotes error:', err)
    return res.status(500).json({ error: err.message || 'Archive failed' })
  }
}

export const config = { runtime: 'nodejs' }
