import type { VercelRequest, VercelResponse } from '@vercel/node'

// Vercel-scheduled purge of soft-deleted properties. Hard-deletes any row
// whose deleted_at is older than RETENTION_DAYS. Runs daily via the schedule
// in vercel.json (`/api/cron/purge-properties`).
//
// Uses the Supabase service role so it bypasses the RLS filter that hides
// deleted_at IS NOT NULL rows from normal reads. Vercel authenticates the
// cron request via CRON_SECRET (Authorization: Bearer <secret>).

const RETENTION_DAYS = 30

function getEnv(): { url: string; serviceKey: string } {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) throw new Error('Supabase config missing')
  return { url, serviceKey }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Fail closed: missing CRON_SECRET in env is a misconfiguration, not a
  // permit-all. Previously this was an `if (cronSecret)` wrapper that left
  // the endpoint public when the var wasn't set.
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
    // Delegate the purge to a SECURITY DEFINER RPC so all deletes run as
    // parameterized SQL. Eliminates the PostgREST `in.(...)` filter
    // injection vector the bounty-hunter flagged for property names with
    // special characters (finding #4).
    const rpcRes = await fetch(
      `${cfg.url}/rest/v1/rpc/purge_deleted_properties`,
      {
        method: 'POST',
        headers: {
          apikey: cfg.serviceKey,
          Authorization: `Bearer ${cfg.serviceKey}`,
          'Content-Type': 'application/json',
          Prefer: 'count=none',
        },
        body: JSON.stringify({ retention_days: RETENTION_DAYS }),
      },
    )
    if (!rpcRes.ok) {
      return res.status(500).json({ error: `Purge RPC failed: ${rpcRes.status} ${await rpcRes.text()}` })
    }
    const purged = (await rpcRes.json()) as Array<{ purged_id: number; purged_name: string }>

    return res.json({
      ok: true,
      purged: purged.length,
      ids: purged.map(p => p.purged_id),
    })
  } catch (err: any) {
    console.error('purge-properties error:', err)
    return res.status(500).json({ error: err.message || 'Purge failed' })
  }
}

export const config = { runtime: 'nodejs' }
