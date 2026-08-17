import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { getFreshQboTokens, getSupabaseConfig, qboApiBase, requireAdminBearer } from '../qbo/_lib.js'

// GET /api/cron/qbo-classes-sync
//
// Nightly QBO Class list snapshot into public.qbo_classes (04:15 UTC). The
// invoicing exporters use this list to fill the Class column only when the
// class actually exists in QBO (see api/invoices/_exporters.ts qboClassFor).
//
// Auth mirrors the other crons (`Authorization: Bearer ${CRON_SECRET}` or
// x-cron-secret), plus an admin session bearer for on-demand runs.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.authorization
  const headerSecret = (req.headers['x-cron-secret'] as string | undefined) ?? ''
  const cronOk = !!cronSecret && (authHeader === `Bearer ${cronSecret}` || headerSecret === cronSecret)
  if (!cronOk) {
    const admin = await requireAdminBearer(req, res)
    if (!admin) return // requireAdminBearer already wrote the 401/403
  }

  let sb
  try {
    const cfg = getSupabaseConfig()
    sb = createClient(cfg.url, cfg.serviceKey)
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }

  try {
    const tokens = await getFreshQboTokens(sb)
    if (!tokens) return res.status(400).json({ error: 'QuickBooks not connected', needsAuth: true })

    const env = process.env.QBO_ENVIRONMENT || 'sandbox'
    const base = qboApiBase(env)
    const realmId = tokens.realm_id || process.env.QBO_REALM_ID
    const headers = { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' }

    // Pull every class, active AND inactive, so deactivations propagate.
    const all: Array<{ Id: string; Name?: string; FullyQualifiedName?: string; Active?: boolean }> = []
    const pageSize = 1000
    for (let start = 1; ; start += pageSize) {
      const q = encodeURIComponent(
        `select Id, Name, FullyQualifiedName, Active from Class where Active in (true, false) startposition ${start} maxresults ${pageSize}`,
      )
      const r = await fetch(`${base}/v3/company/${realmId}/query?query=${q}&minorversion=65`, { headers })
      if (!r.ok) {
        const detail = (await r.text()).slice(0, 300)
        return res.status(502).json({ error: `QBO class query failed (${r.status})`, detail })
      }
      const page = ((await r.json()) as any)?.QueryResponse?.Class ?? []
      all.push(...page)
      if (page.length < pageSize) break
    }

    const nowIso = new Date().toISOString()
    const rows = all.map(c => ({
      qbo_id: String(c.Id),
      name: c.Name ?? '',
      fully_qualified_name: c.FullyQualifiedName ?? c.Name ?? '',
      active: c.Active !== false,
      synced_at: nowIso,
    }))

    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await sb.from('qbo_classes').upsert(rows.slice(i, i + 500), { onConflict: 'qbo_id' })
      if (error) return res.status(500).json({ error: `qbo_classes upsert failed: ${error.message}` })
    }

    // Classes hard-deleted in QBO never come back from the query — anything
    // this run didn't touch goes inactive so the exporters stop matching it.
    // Guard rows.length: an empty QBO result must not deactivate everything
    // (more likely a wrong realm/env than a company with zero classes).
    if (rows.length > 0) {
      await sb.from('qbo_classes').update({ active: false }).lt('synced_at', nowIso)
    }

    return res.json({ ok: true, classes: rows.length, active: rows.filter(r => r.active).length, environment: env })
  } catch (err: any) {
    console.error('QBO CLASSES SYNC FAILED:', err?.message || err)
    const needsAuth = String(err?.message ?? '').includes('reconnect')
    return res.status(needsAuth ? 400 : 500).json({ ok: false, error: err?.message || String(err), ...(needsAuth ? { needsAuth: true } : {}) })
  }
}

export const config = { runtime: 'nodejs' }
