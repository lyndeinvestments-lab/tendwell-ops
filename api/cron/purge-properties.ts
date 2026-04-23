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
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const header = req.headers.authorization || ''
    if (header !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }

  let cfg
  try { cfg = getEnv() } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()

  try {
    // List expired soft-deletes. Need names too so we can cascade delete
    // tasks that reference properties by property_name (text, not FK).
    const listRes = await fetch(
      `${cfg.url}/rest/v1/properties?select=id,name&deleted_at=lt.${encodeURIComponent(cutoff)}`,
      {
        headers: {
          apikey: cfg.serviceKey,
          Authorization: `Bearer ${cfg.serviceKey}`,
        },
      },
    )
    if (!listRes.ok) {
      return res.status(500).json({ error: `List failed: ${listRes.status} ${await listRes.text()}` })
    }
    const doomed = (await listRes.json()) as Array<{ id: number; name: string }>
    if (doomed.length === 0) return res.json({ ok: true, purged: 0, cutoff })

    // Remove workflow tasks keyed by property_name (no FK cascade exists).
    const names = doomed.map(p => `"${p.name.replace(/"/g, '\\"')}"`).join(',')
    await fetch(
      `${cfg.url}/rest/v1/tasks?property_name=in.(${encodeURIComponent(names)})`,
      {
        method: 'DELETE',
        headers: {
          apikey: cfg.serviceKey,
          Authorization: `Bearer ${cfg.serviceKey}`,
          Prefer: 'count=none',
        },
      },
    )

    // Hard-delete the properties. Related tables with ON DELETE CASCADE FKs
    // (property_notes, stage_transitions, property_photos, property_supplies,
    // issues, etc.) clean up automatically.
    const ids = doomed.map(p => p.id).join(',')
    const delRes = await fetch(
      `${cfg.url}/rest/v1/properties?id=in.(${ids})`,
      {
        method: 'DELETE',
        headers: {
          apikey: cfg.serviceKey,
          Authorization: `Bearer ${cfg.serviceKey}`,
          Prefer: 'count=none',
        },
      },
    )
    if (!delRes.ok) {
      return res.status(500).json({ error: `Delete failed: ${delRes.status} ${await delRes.text()}` })
    }

    return res.json({
      ok: true,
      purged: doomed.length,
      cutoff,
      ids: doomed.map(p => p.id),
    })
  } catch (err: any) {
    console.error('purge-properties error:', err)
    return res.status(500).json({ error: err.message || 'Purge failed' })
  }
}

export const config = { runtime: 'nodejs' }
