import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows, loadEngineContext, reconcileRun, describeLineInsertError, withRunLease } from '../invoices/_lib.js'
import { validatePeriod } from '../../shared/vendor-invoice.js'
import { getSupabaseConfig, notifyStaff } from '../notify/_lib.js'
import { archivedDuplicateMap, buildPortalDraft, dayKey, type DraftProperty, type SkippedDay } from './_draft.js'
import {
  blockedDaysFor,
  isVendorVisible,
  receiptOk,
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

/** Pull completed cleans into a draft run. On a refresh only property-days
 *  not already on the run are added (a day the vendor removed stays removed). */
export async function populateDraft(supabase: SupabaseClient, run: RunRow): Promise<{ added: number; skipped: SkippedDay[] }> {
  const [ctx, blocked, existing] = await Promise.all([
    loadEngineContext(supabase, run.period_start, run.period_end, run.id),
    blockedDaysFor(supabase, run.id, run.vendor_id, run.period_start, run.period_end),
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
  const { data: propMeta, error: metaReadErr } = await supabase
    .from('properties')
    .select('id, address, trellis_id, archived_at')
    .is('deleted_at', null)
    .limit(5000)
  if (metaReadErr) throw new Error(`Failed to load property addresses: ${metaReadErr.message}`)
  const addressOf = new Map<number, string | null>((propMeta ?? []).map(p => [Number(p.id), p.address ?? null]))
  const canonical = archivedDuplicateMap((propMeta ?? []).map(p => ({ id: Number(p.id), trellis_id: p.trellis_id ?? null, archived_at: p.archived_at ?? null })))
  const canon = (id: number | null) => (id == null ? id : canonical.get(id) ?? id)
  const properties = new Map<number, DraftProperty>(ctx.properties.map(p => [p.id, { id: p.id, name: p.name, cleanerPay: p.cleanerPay, address: addressOf.get(p.id) ?? null }]))
  // Days billed under an archived duplicate block the active record too.
  const blockedCanon = new Map<string, string | null>()
  for (const [k, v] of blocked) {
    const [pid, d] = k.split('|')
    blockedCanon.set(k, v)
    blockedCanon.set(dayKey(canon(Number(pid))!, d), v)
  }
  const draft = buildPortalDraft({
    tasks: ctx.tasks.map(t => (t.propertyId != null && canonical.has(t.propertyId) ? { ...t, propertyId: canon(t.propertyId) } : t)),
    periodStart: run.period_start,
    periodEnd: run.period_end,
    properties,
    blockedDays: blockedCanon,
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

const money = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

/** Email the admins who keep "Vendor invoice submitted" on. Never throws
 *  (notifyStaff swallows and logs failures): a mail outage must not stop an
 *  invoice from being submitted. */
async function notifySubmitted(
  actor: VendorActor,
  run: RunRow,
  detail: Awaited<ReturnType<typeof runDetail>>,
  needsReview: boolean,
): Promise<void> {
  const active = detail.lines.filter(l => !l.removed)
  const cleans = active.filter(l => l.category === 'clean').length
  const items = active.length - cleans
  const vendor = actor.vendorName || 'A vendor'
  await notifyStaff(getSupabaseConfig(), {
    eventType: 'vendor_invoice_submitted',
    subject: `${vendor} submitted an invoice for ${run.period_start} – ${run.period_end}`,
    lines: [
      `<strong>${vendor}</strong> submitted their invoice for <strong>${run.period_start} – ${run.period_end}</strong>${run.vendor_reference ? ` (their #${run.vendor_reference})` : ''}.`,
      `Total ${money(detail.run.total)} · ${cleans} clean${cleans === 1 ? '' : 's'} · ${items} added item${items === 1 ? '' : 's'}.`,
      needsReview
        ? `${detail.in_review_count} line${detail.in_review_count === 1 ? '' : 's'} need review before it can be approved.`
        : 'Nothing is flagged — it is ready to approve.',
      `Submitted by ${actor.email}.`,
    ],
    ctaUrl: 'https://app.tendwellcleaningco.com/invoicing',
    ctaLabel: 'Review & approve',
    meta: { run_id: run.id, vendor_id: actor.vendorId, total: detail.run.total },
  })
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

    if (action !== 'refresh' && action !== 'submit' && action !== 'delete') {
      res.status(400).json({ error: 'Unknown action' })
      return
    }

    // Every write holds the run's lease and re-reads the run under it, so a
    // second tab, a double-click or an item save racing a submit can never
    // interleave (see withRunLease).
    const outcome = await withRunLease(supabase, run.id, async () => {
      const cur = await loadVendorRun(supabase, run.id, actor.vendorId)
      if (!cur || cur.status !== 'draft') return { status: 409, body: { error: action === 'delete' ? 'not_deletable' : 'not_draft' } }

      if (action === 'refresh') {
        const result = await populateDraft(supabase, cur)
        const fresh = await loadVendorRun(supabase, cur.id, actor.vendorId)
        return { status: 200, body: { ...(await runDetail(supabase, fresh!)), added: result.added } }
      }

      if (action === 'submit') {
        if (cur.period_end > today) return { status: 400, body: { error: 'date_in_future' } }
        // Fresh evidence at the moment of submission.
        await reconcileRun(supabase, cur.id)
        const rows = (await loadRunLines(supabase, cur.id)).filter(isVendorVisible)
        const active = rows.filter(r => r.review_status !== 'excluded' && r.line_kind !== 'excluded')
        if (active.length === 0) return { status: 400, body: { error: 'empty' } }
        // A reimbursement's receipt must still be there (an edit or delete of
        // another item could have removed a shared file).
        for (const r of active.filter(r => r.vendor_category === 'reimbursement')) {
          if (!r.receipt_path || !(await receiptOk(supabase, r.receipt_path))) return { status: 400, body: { error: 'receipt_required' } }
        }
        const { count, error: cntErr } = await supabase
          .from('invoice_lines')
          .select('id', { count: 'exact', head: true })
          .eq('run_id', cur.id)
          .eq('review_status', 'needs_review')
        if (cntErr) throw new Error(cntErr.message)
        const reference = typeof body.vendor_reference === 'string' ? body.vendor_reference.trim().slice(0, 60) || null : null
        const { data: updated, error: updErr } = await supabase
          .from('invoice_runs')
          .update({
            status: (count ?? 0) > 0 ? 'review_needed' : 'reconciled',
            submitted_at: new Date().toISOString(),
            submitted_by: actor.email,
            vendor_reference: reference,
            vendor_total: vendorTotal(rows),
          })
          .eq('id', cur.id)
          .eq('status', 'draft')
          .select('id')
        if (updErr) throw new Error(updErr.message)
        if (!updated?.length) return { status: 409, body: { error: 'not_draft' } }
        const fresh = await loadVendorRun(supabase, cur.id, actor.vendorId)
        const detail = await runDetail(supabase, fresh!)
        await notifySubmitted(actor, fresh!, detail, (count ?? 0) > 0)
        return { status: 200, body: detail }
      }

      // delete — only a never-submitted draft
      if (cur.submitted_at) return { status: 409, body: { error: 'not_deletable' } }
      const prefix = receiptPrefix(actor.vendorId, cur.id)
      const { data: files } = await supabase.storage.from(RECEIPT_BUCKET).list(prefix.replace(/\/$/, ''))
      const { error } = await supabase.from('invoice_runs').delete().eq('id', cur.id).eq('status', 'draft')
      if (error) throw new Error(error.message)
      // Best effort: the run's uploaded receipts go with it.
      if (files?.length) await supabase.storage.from(RECEIPT_BUCKET).remove(files.map(f => `${prefix}${f.name}`))
      return { status: 200, body: { ok: true } }
    })
    res.status(outcome.status).json(outcome.body)
  } catch (e) {
    sendError(res, e, 'Invoice request failed')
  }
}
