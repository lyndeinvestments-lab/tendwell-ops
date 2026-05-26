import type { VercelRequest, VercelResponse } from '@vercel/node'

// Vercel-scheduled cleanup of laundry-weigh-in photos older than
// RETENTION_DAYS. The DB rows stay (weight + cleaner name + dates are
// useful for reporting), only the photo blobs in the `laundry-weigh-ins`
// bucket and their `photo_url` / `photo_path` columns get cleared.
//
// Runs daily via the schedule in vercel.json. Service-role auth bypasses
// RLS; Vercel authenticates the cron caller via CRON_SECRET (Authorization:
// Bearer <secret>).

const RETENTION_DAYS = 90
const BUCKET = 'laundry-weigh-ins'

function getEnv(): { url: string; serviceKey: string } {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) throw new Error('Supabase config missing')
  return { url, serviceKey }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
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
      `${cfg.url}/rest/v1/rpc/purge_old_laundry_photos`,
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
      return res.status(500).json({ error: `RPC failed: ${rpcRes.status} ${await rpcRes.text()}` })
    }
    const rows = (await rpcRes.json()) as Array<{ storage_path: string }>
    const paths = rows.map(r => r.storage_path).filter(Boolean)
    if (paths.length === 0) {
      return res.json({ ok: true, purged_rows: 0, deleted_objects: 0 })
    }

    const CHUNK = 200
    let deleted = 0
    const failures: string[] = []
    for (let i = 0; i < paths.length; i += CHUNK) {
      const chunk = paths.slice(i, i + CHUNK)
      const delRes = await fetch(
        `${cfg.url}/storage/v1/object/${BUCKET}`,
        {
          method: 'DELETE',
          headers: {
            apikey: cfg.serviceKey,
            Authorization: `Bearer ${cfg.serviceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ prefixes: chunk }),
        },
      )
      if (delRes.ok) {
        deleted += chunk.length
      } else {
        failures.push(`${delRes.status}: ${await delRes.text()}`)
      }
    }

    return res.json({
      ok: failures.length === 0,
      purged_rows: paths.length,
      deleted_objects: deleted,
      failures: failures.length > 0 ? failures : undefined,
    })
  } catch (err: any) {
    console.error('purge-laundry-photos error:', err)
    return res.status(500).json({ error: err.message || 'Purge failed' })
  }
}

export const config = { runtime: 'nodejs' }
