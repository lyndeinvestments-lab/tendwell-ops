import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows, loadEngineContext, reconcileRun, describeLineInsertError } from '../invoices/_lib.js'
import { validatePeriod } from '../../shared/vendor-invoice.js'
import { buildPortalDraft, dayKey, type DraftProperty, type SkippedDay } from './_draft.js'
import {
  isVendorVisible,
  loadRunLines,
  loadVendorProperties,
  loadVendorRun,
  receiptPrefix,
  RECEIPT_BUCKET,
  requireVendorActor,
  RUN_COLUMNS,
  sendError,
  serializeLine,
  serializeRun,
  todayEastern,
  vendorTotal,
  type RunRow,
  type VendorActor,
} from './_lib.js'

// /api/vendor-invoices/runs — a cleaning company's own invoices.
//
//   GET                       → { vendor, runs }
//   GET ?id=<run>             → { run, lines, properties, skipped }
//   GET ?properties=1         → { properties } (picker for added items)
//   POST { action: 'create',  period_start, period_end }  → new draft from completed tasks
//   POST { action: 'refresh', run_id }                     → pull cleans completed since
//   POST { action: 'submit',  run_id, vendor_reference? }  → hand to Tendwell for review
//   POST { action: 'delete',  run_id }                     → discard a never-submitted draft
//
// Every response is built by the allow-list serializers in _lib.ts.

const CLEAN_KINDS = ['clean', 'deep_clean', 'combined_split']

function fmtRange(start: string, end: string): string {
  return `${start} – ${end}`
}

/** Property-days already billed elsewhere: lines on approved/exported runs
 *  (any source — an uploaded Busy Bee CSV counts) and on every other active
 *  vendor-portal invoice (draft or submitted). */
export async function blockedDaysFor(supabase: SupabaseClient, runId: string, start: string, end: string): Promise<Map<string, string>> {
  const rows = await fetchAllRows<any>(
    'invoice_lines (billed days)',
    () => supabase
      .from('invoice_lines')
      .select('id, property_id, service_date, raw_date_mentioned, run_id, invoice_runs!inner(source, status, archived_at, period_start, period_end)')
      .neq('run_id', runId)
      .in('line_kind', CLEAN_KINDS)
      .neq('review_status', 'excluded')
      .not('property_id', 'is', null)
      .is('invoice_runs.archived_at', null)
      .neq('invoice_runs.status', 'void')
      .or(`and(service_date.gte.${start},service_date.lte.${end}),and(service_date.is.null,raw_date_mentioned.gte.${start},raw_date_mentioned.lte.${end})`)
      .order('id') as any,
    'id',
  )
  const out = new Map<string, string>()
  for (const r of rows) {
    const run = Array.isArray(r.invoice_runs) ? r.invoice_runs[0] : r.invoice_runs
    if (!run) continue
    const billed = run.status === 'approved' || run.status === 'exported'
    if (!billed && run.source !== 'vendor_portal') continue // stale admin drafts don't block
    const d = r.service_date ?? r.raw_date_mentioned
    if (!d) continue
    out.set(dayKey(Number(r.property_id), String(d)), `invoice ${fmtRange(run.period_start, run.period_end)}`)
  }
  return out
}

/** Pull completed cleans into a draft run. On a refresh only property-days
 *  not already on the run are added (a day the vendor removed stays removed). */
export async function populateDraft(supabase: SupabaseClient, run: RunRow): Promise<{ added: number; skipped: SkippedDay[] }> {
  const [ctx, blocked, existing] = await Promise.all([
    loadEngineContext(supabase, run.period_start, run.period_end, run.id),
    blockedDaysFor(supabase, run.id, run.period_start, run.period_end),
    loadRunLines(supabase, run.id),
  ])
  const existingDays = new Set<string>()
  let maxLineNo = 0
  for (const r of existing) {
    maxLineNo = Math.max(maxLineNo, Number(r.line_no))
    const d = r.service_date ?? r.raw_date_mentioned
    if ((r.vendor_category === 'clean' || r.vendor_category === 'missing_clean') && r.property_id != null && d) {
      existingDays.add(dayKey(Number(r.property_id), d))
    }
  }
  const properties = new Map<number, DraftProperty>(ctx.properties.map(p => [p.id, { id: p.id, name: p.name, cleanerPay: p.cleanerPay }]))
  const draft = buildPortalDraft({
    tasks: ctx.tasks,
    periodStart: run.period_start,
    periodEnd: run.period_end,
    properties,
    blockedDays: blocked,
    existingDays,
  })

  if (draft.lines.length > 0) {
    const inserts = draft.lines.map((l, i) => ({
      run_id: run.id,
      line_no: maxLineNo + i + 1,
      source: 'generated',
      raw_property_text: l.propertyName,
      raw_note_text: `${l.title} on ${l.date}`,
      raw_amount: l.amount,
      raw_date_mentioned: l.date,
      service_date: l.date,
      property_id: l.propertyId,
      line_kind: l.deep ? 'deep_clean' : 'clean',
      review_status: 'ok',
      flags: [] as string[],
      vendor_category: 'clean',
      vendor_detail: { property_id: l.propertyId, task_ids: l.taskIds, task_title: l.title, flags: l.flags },
    }))
    for (let i = 0; i < inserts.length; i += 200) {
      const { error } = await supabase.from('invoice_lines').insert(inserts.slice(i, i + 200))
      if (error) throw new Error(describeLineInsertError(error))
    }
  }
  // The engine labels, prices and evidence-checks every line (and keeps the
  // run a draft — see reconcileRun).
  await reconcileRun(supabase, run.id)

  const { error: metaErr } = await supabase
    .from('invoice_runs')
    .update({ vendor_draft_meta: { pulled_at: new Date().toISOString(), added: draft.lines.length, skipped: draft.skipped } })
    .eq('id', run.id)
  if (metaErr) throw new Error(`Failed to save draft summary: ${metaErr.message}`)
  return { added: draft.lines.length, skipped: draft.skipped }
}

export async function runDetail(supabase: SupabaseClient, run: RunRow) {
  const rows = (await loadRunLines(supabase, run.id)).filter(isVendorVisible)
  const isDraft = run.status === 'draft'
  const lines = rows.map(r => serializeLine(r, isDraft))
  const ids = [...new Set(rows.map(r => r.property_id).filter((x): x is number => x != null))]
  const skipped: SkippedDay[] = Array.isArray(run.vendor_draft_meta?.skipped) ? run.vendor_draft_meta!.skipped : []
  for (const s of skipped) if (!ids.includes(s.propertyId)) ids.push(s.propertyId)
  const props = await loadVendorProperties(supabase, ids)
  return {
    run: serializeRun(run, vendorTotal(rows)),
    lines,
    properties: Object.fromEntries(props),
    skipped: skipped.map(s => ({ property_id: s.propertyId, property_name: props.get(s.propertyId)?.name ?? s.propertyName, date: s.date, title: s.title, reason: s.reason, ref: s.ref })),
    pulled_at: run.vendor_draft_meta?.pulled_at ?? null,
    in_review_count: lines.filter(l => l.in_review && !l.removed).length,
  }
}

async function listRuns(supabase: SupabaseClient, actor: VendorActor) {
  const { data, error } = await supabase
    .from('invoice_runs')
    .select(RUN_COLUMNS)
    .eq('vendor_id', actor.vendorId)
    .eq('source', 'vendor_portal')
    .is('archived_at', null)
    .order('period_start', { ascending: false })
    .limit(60)
  if (error) throw new Error(error.message)
  const runs = (data ?? []) as unknown as RunRow[]
  const out = []
  for (const run of runs) {
    // Submitted invoices keep the total the vendor submitted; a draft's total
    // is live.
    const total = run.status === 'draft'
      ? vendorTotal((await loadRunLines(supabase, run.id)).filter(isVendorVisible))
      : run.vendor_total == null ? null : Number(run.vendor_total)
    out.push(serializeRun(run, total))
  }
  return out
}

async function operationalProperties(supabase: SupabaseClient) {
  const { data: stages } = await supabase.from('pipeline_stages').select('id').eq('is_operational', true)
  const stageIds = (stages ?? []).map((s: any) => Number(s.id))
  const rows = await fetchAllRows<any>(
    'properties (operational ids)',
    () => supabase.from('properties').select('id').is('deleted_at', null).in('stage_id', stageIds.length ? stageIds : [-1]).order('id') as any,
    'id',
  )
  const props = await loadVendorProperties(supabase, rows.map(r => Number(r.id)))
  return [...props.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const auth = await requireVendorActor(req, res, req.method === 'GET' ? 'view' : 'edit')
  if (!auth) return
  const { actor, supabase } = auth
  const today = todayEastern()

  try {
    if (req.method === 'GET') {
      if (req.query.properties) {
        res.status(200).json({ properties: await operationalProperties(supabase) })
        return
      }
      if (typeof req.query.id === 'string') {
        const run = await loadVendorRun(supabase, req.query.id, actor.vendorId)
        if (!run) { res.status(404).json({ error: 'Invoice not found' }); return }
        res.status(200).json(await runDetail(supabase, run))
        return
      }
      res.status(200).json({
        vendor: { id: actor.vendorId, name: actor.vendorName },
        me: { email: actor.email, is_admin: actor.isAdmin },
        today,
        runs: await listRuns(supabase, actor),
      })
      return
    }

    const body = (req.body ?? {}) as Record<string, unknown>
    const action = body.action

    if (action === 'create') {
      const start = body.period_start
      const end = body.period_end
      const perr = validatePeriod(start, end, today)
      if (perr) { res.status(400).json({ error: perr }); return }
      const { data: created, error: insErr } = await supabase
        .from('invoice_runs')
        .insert({
          vendor_id: actor.vendorId,
          source: 'vendor_portal',
          status: 'draft',
          period_start: start,
          period_end: end,
          invoice_date: end,
          created_by: actor.email,
        })
        .select(RUN_COLUMNS)
        .single()
      if (insErr || !created) {
        if (insErr?.code === '23P01') { res.status(409).json({ error: 'overlap', detail: insErr.message }); return }
        throw new Error(insErr?.message ?? 'Failed to create invoice')
      }
      const run = created as unknown as RunRow
      try {
        await populateDraft(supabase, run)
      } catch (e) {
        // Never leave a half-built invoice behind.
        await supabase.from('invoice_runs').delete().eq('id', run.id)
        throw e
      }
      const fresh = await loadVendorRun(supabase, run.id, actor.vendorId)
      res.status(200).json(await runDetail(supabase, fresh!))
      return
    }

    const run = await loadVendorRun(supabase, body.run_id, actor.vendorId)
    if (!run) { res.status(404).json({ error: 'Invoice not found' }); return }

    if (action === 'refresh') {
      if (run.status !== 'draft') { res.status(409).json({ error: 'not_draft' }); return }
      const result = await populateDraft(supabase, run)
      const fresh = await loadVendorRun(supabase, run.id, actor.vendorId)
      res.status(200).json({ ...(await runDetail(supabase, fresh!)), added: result.added })
      return
    }

    if (action === 'submit') {
      if (run.status !== 'draft') { res.status(409).json({ error: 'not_draft' }); return }
      if (run.period_end > today) { res.status(400).json({ error: 'date_in_future' }); return }
      // Fresh evidence at the moment of submission.
      await reconcileRun(supabase, run.id)
      const rows = (await loadRunLines(supabase, run.id)).filter(isVendorVisible)
      const active = rows.filter(r => r.review_status !== 'excluded' && r.line_kind !== 'excluded')
      if (active.length === 0) { res.status(400).json({ error: 'empty' }); return }
      const { count, error: cntErr } = await supabase
        .from('invoice_lines')
        .select('id', { count: 'exact', head: true })
        .eq('run_id', run.id)
        .eq('review_status', 'needs_review')
      if (cntErr) throw new Error(cntErr.message)
      const reference = typeof body.vendor_reference === 'string' ? body.vendor_reference.trim().slice(0, 60) || null : null
      const { error: updErr } = await supabase
        .from('invoice_runs')
        .update({
          status: (count ?? 0) > 0 ? 'review_needed' : 'reconciled',
          submitted_at: new Date().toISOString(),
          submitted_by: actor.email,
          vendor_reference: reference,
          vendor_total: vendorTotal(rows),
        })
        .eq('id', run.id)
        .eq('status', 'draft')
      if (updErr) throw new Error(updErr.message)
      const fresh = await loadVendorRun(supabase, run.id, actor.vendorId)
      res.status(200).json(await runDetail(supabase, fresh!))
      return
    }

    if (action === 'delete') {
      if (run.status !== 'draft' || run.submitted_at) { res.status(409).json({ error: 'not_deletable' }); return }
      const { error } = await supabase.from('invoice_runs').delete().eq('id', run.id).eq('status', 'draft')
      if (error) throw new Error(error.message)
      // Best effort: the run's uploaded receipts go with it.
      const prefix = receiptPrefix(actor.vendorId, run.id)
      const { data: files } = await supabase.storage.from(RECEIPT_BUCKET).list(prefix.replace(/\/$/, ''))
      if (files?.length) await supabase.storage.from(RECEIPT_BUCKET).remove(files.map(f => `${prefix}${f.name}`))
      res.status(200).json({ ok: true })
      return
    }

    res.status(400).json({ error: 'Unknown action' })
  } catch (e) {
    sendError(res, e, 'Invoice request failed')
  }
}
