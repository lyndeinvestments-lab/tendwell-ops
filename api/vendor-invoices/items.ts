import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { describeLineInsertError, reconcileRun } from '../invoices/_lib.js'
import { validateVendorItem, type NormalizedItem, type VendorItemInput } from '../../shared/vendor-invoice.js'
import {
  ENGINE_ITEM_CATEGORIES,
  isOwnReceiptPath,
  loadRunLines,
  loadVendorRun,
  RECEIPT_BUCKET,
  requireVendorActor,
  sendError,
  todayEastern,
  type LineRow,
  type RunRow,
  type VendorActor,
} from './_lib.js'

// /api/vendor-invoices/items — a vendor's own billable items on a DRAFT.
//
//   POST { action: 'add',     run_id, item }            → add an item
//   POST { action: 'update',  run_id, line_id, item }   → edit one of your items
//   POST { action: 'delete',  run_id, line_id }         → delete one of your items
//   POST { action: 'remove',  run_id, line_id, reason } → take a clean off (with why)
//   POST { action: 'restore', run_id, line_id }         → put a removed clean back
//
// Items are validated by shared/vendor-invoice.ts on the server, whatever the
// form sent. Missing cleans and extras go through the reconcile engine (task
// evidence, fee-list pricing, owner stays); reimbursements and hours are
// stored as entered. Every vendor item is sent to Tendwell's review queue.

const REMOVE_REASON_MIN = 10

async function receiptExists(supabase: SupabaseClient, path: string): Promise<boolean> {
  const slash = path.lastIndexOf('/')
  const { data } = await supabase.storage.from(RECEIPT_BUCKET).list(path.slice(0, slash), { search: path.slice(slash + 1) })
  return (data ?? []).some(f => f.name === path.slice(slash + 1))
}

async function propertyFor(supabase: SupabaseClient, id: number | null) {
  if (id == null) return null
  const { data } = await supabase
    .from('properties')
    .select('id, name, cleaner_pay, contact_id')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  return data as { id: number; name: string; cleaner_pay: number | null; contact_id: string | null } | null
}

async function channelFor(supabase: SupabaseClient, contactId: string | null): Promise<string> {
  if (!contactId) return 'none'
  const { data } = await supabase.from('contacts').select('billing_channel').eq('id', contactId).maybeSingle()
  return (data as any)?.billing_channel ?? 'none'
}

const money = (n: number) => `$${n.toFixed(2)}`

/** The stored row for a validated item (everything but run_id / line_no). */
export async function rowFor(
  supabase: SupabaseClient,
  item: NormalizedItem,
  prop: { id: number; name: string; contact_id: string | null } | null,
  actor: VendorActor,
): Promise<Record<string, unknown>> {
  const detail = {
    property_id: item.property_id,
    service_type: item.service_type,
    worker: item.worker,
    hours: item.hours,
    rate: item.rate,
    description: item.description,
    requested_by: item.requested_by,
    evidence_url: item.evidence_url,
    flags: item.late ? ['late_item'] : [],
    entered_by: actor.email,
    entered_at: new Date().toISOString(),
  }
  const common = {
    raw_amount: item.amount,
    raw_date_mentioned: item.date,
    service_date: item.date,
    property_id: item.property_id,
    vendor_category: item.category,
    vendor_detail: detail,
    receipt_path: item.receipt_path,
    flags: ['vendor_added', ...(item.late ? ['late_item'] : [])],
    review_status: 'needs_review',
    matched_task_id: null,
    split_group: null,
  }

  if (item.category === 'missing_clean') {
    return { ...common, source: 'vendor', raw_property_text: prop!.name, raw_note_text: `${item.service_type} on ${item.date}`, line_kind: item.service_type === 'Deep Clean' ? 'deep_clean' : 'clean' }
  }
  if (item.category === 'extra') {
    return { ...common, source: 'vendor', raw_property_text: prop!.name, raw_note_text: `${item.service_type} - ${item.description}`, line_kind: 'extra', service_type: item.service_type }
  }
  if (item.category === 'reimbursement') {
    // Billed back to the client at cost (Jordan 2026-10-05). The review note
    // starts from the vendor's own detail; Tendwell adds the Slack/Quo link
    // the approve gate requires (reimbursementDetailOk) while reviewing.
    return {
      ...common,
      source: 'manual',
      raw_property_text: prop!.name,
      raw_note_text: `Reimbursement - ${item.description}`,
      line_kind: 'extra',
      service_type: 'Reimbursement',
      cleaner_pay_amount: item.amount,
      client_charge_amount: item.amount,
      billing_channel: await channelFor(supabase, prop!.contact_id),
      review_note: `From ${actor.vendorName}: ${item.description}. Requested by: ${item.requested_by}.${item.evidence_url ? ` ${item.evidence_url}` : ''} Receipt attached.`,
      engine_note: `Vendor reimbursement of ${money(item.amount)} — check the receipt and who it was for before billing it back.`,
    }
  }
  // Inspection hours / labor: a Tendwell expense paid to the vendor, never
  // invoiced to a client.
  const label = item.category === 'inspection' ? 'Inspection Work' : 'Labor'
  return {
    ...common,
    source: 'manual',
    raw_property_text: `${item.worker} ${label}`,
    raw_note_text: `${item.hours} h × ${money(item.rate ?? 0)}${item.description ? ` - ${item.description}` : ''}`,
    line_kind: 'operating_expense',
    service_type: null,
    cleaner_pay_amount: item.amount,
    client_charge_amount: null,
    billing_channel: null,
    engine_note: `${item.category === 'inspection' ? 'Inspection' : 'Labor'} hours from the vendor: ${item.worker}, ${item.hours} h at ${money(item.rate ?? 0)} = ${money(item.amount)}.`,
  }
}

async function validated(
  supabase: SupabaseClient,
  run: RunRow,
  raw: unknown,
  res: VercelResponse,
  actor: VendorActor,
  keepReceipt: string | null = null,
): Promise<{ item: NormalizedItem; prop: Awaited<ReturnType<typeof propertyFor>> } | null> {
  const input = { ...((raw ?? {}) as VendorItemInput) }
  // Editing without a new upload keeps the stored receipt (its path is never
  // sent to the browser).
  if (!input.receipt_path && keepReceipt) input.receipt_path = keepReceipt
  const pid = input.property_id == null || (input.property_id as unknown) === '' ? null : Number(input.property_id)
  const prop = await propertyFor(supabase, pid != null && Number.isFinite(pid) ? pid : null)
  if (pid != null && !prop) {
    res.status(400).json({ error: 'invalid_item', errors: { property_id: 'required' } })
    return null
  }
  const v = validateVendorItem(input, {
    periodStart: run.period_start,
    periodEnd: run.period_end,
    today: todayEastern(),
    propertyCleanerPay: prop?.cleaner_pay == null ? null : Number(prop.cleaner_pay),
  })
  if (!v.ok) {
    res.status(400).json({ error: 'invalid_item', errors: v.errors })
    return null
  }
  if (!isOwnReceiptPath(v.item.receipt_path, actor.vendorId, run.id)) {
    res.status(400).json({ error: 'invalid_item', errors: { receipt_path: 'receipt_required' } })
    return null
  }
  if (v.item.receipt_path && !(await receiptExists(supabase, v.item.receipt_path))) {
    res.status(400).json({ error: 'invalid_item', errors: { receipt_path: 'receipt_required' } })
    return null
  }
  return { item: v.item, prop }
}

function ownItem(lines: LineRow[], id: unknown): LineRow | null {
  const row = lines.find(l => l.id === id)
  if (!row || !row.vendor_category || row.vendor_category === 'clean') return null
  return row
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const auth = await requireVendorActor(req, res, 'edit')
  if (!auth) return
  const { actor, supabase } = auth
  const body = (req.body ?? {}) as Record<string, any>

  try {
    const run = await loadVendorRun(supabase, body.run_id, actor.vendorId)
    if (!run) { res.status(404).json({ error: 'Invoice not found' }); return }
    if (run.status !== 'draft') { res.status(409).json({ error: 'not_draft' }); return }
    const lines = await loadRunLines(supabase, run.id)

    if (body.action === 'add') {
      const ok = await validated(supabase, run, body.item, res, actor)
      if (!ok) return
      const lineNo = Math.max(0, ...lines.map(l => Number(l.line_no))) + 1
      const row = { ...(await rowFor(supabase, ok.item, ok.prop, actor)), run_id: run.id, line_no: lineNo }
      const { error } = await supabase.from('invoice_lines').insert(row)
      if (error) throw new Error(describeLineInsertError(error))
      if (ENGINE_ITEM_CATEGORIES.has(ok.item.category)) await reconcileRun(supabase, run.id)
      res.status(200).json({ ok: true })
      return
    }

    if (body.action === 'update') {
      const existing = ownItem(lines, body.line_id)
      if (!existing) { res.status(404).json({ error: 'Item not found' }); return }
      if ((body.item ?? {}).category !== existing.vendor_category) {
        res.status(400).json({ error: 'invalid_item', errors: { category: 'unknown_type' } })
        return
      }
      const ok = await validated(supabase, run, body.item, res, actor, existing.receipt_path)
      if (!ok) return
      const row = await rowFor(supabase, ok.item, ok.prop, actor)
      // Engine-path items share a line_no with their split rows, if any.
      const { error: delErr } = await supabase.from('invoice_lines').delete().eq('run_id', run.id).eq('line_no', existing.line_no)
      if (delErr) throw new Error(delErr.message)
      const { error } = await supabase.from('invoice_lines').insert({ ...row, run_id: run.id, line_no: existing.line_no })
      if (error) throw new Error(describeLineInsertError(error))
      if (existing.receipt_path && existing.receipt_path !== ok.item.receipt_path) {
        await supabase.storage.from(RECEIPT_BUCKET).remove([existing.receipt_path])
      }
      if (ENGINE_ITEM_CATEGORIES.has(ok.item.category)) await reconcileRun(supabase, run.id)
      res.status(200).json({ ok: true })
      return
    }

    if (body.action === 'delete') {
      const existing = ownItem(lines, body.line_id)
      if (!existing) { res.status(404).json({ error: 'Item not found' }); return }
      const { error } = await supabase.from('invoice_lines').delete().eq('run_id', run.id).eq('line_no', existing.line_no)
      if (error) throw new Error(error.message)
      if (existing.receipt_path) await supabase.storage.from(RECEIPT_BUCKET).remove([existing.receipt_path])
      res.status(200).json({ ok: true })
      return
    }

    if (body.action === 'remove' || body.action === 'restore') {
      const row = lines.find(l => l.id === body.line_id)
      if (!row || row.vendor_category !== 'clean') { res.status(404).json({ error: 'Line not found' }); return }
      const group = lines.filter(l => l.line_no === row.line_no)
      if (body.action === 'remove') {
        const reason = typeof body.reason === 'string' ? body.reason.replace(/\s+/g, ' ').trim() : ''
        if (reason.length < REMOVE_REASON_MIN) { res.status(400).json({ error: 'invalid_item', errors: { description: reason ? 'too_short' : 'required' } }); return }
        for (const r of group) {
          const { error } = await supabase
            .from('invoice_lines')
            .update({
              review_status: 'excluded',
              vendor_detail: { ...(r.vendor_detail ?? {}), removed_reason: reason.slice(0, 500), removed_by: actor.email, removed_at: new Date().toISOString() },
            })
            .eq('id', r.id)
          if (error) throw new Error(error.message)
        }
      } else {
        const d = row.vendor_detail ?? {}
        // Only a clean the VENDOR removed can be put back here; one Tendwell
        // removed stays Tendwell's call.
        if (row.review_status !== 'excluded' || typeof d.removed_reason !== 'string') {
          res.status(409).json({ error: 'not_restorable' })
          return
        }
        for (const r of group) {
          const { removed_reason: _a, removed_by: _b, removed_at: _c, ...rest } = r.vendor_detail ?? {}
          const { error } = await supabase.from('invoice_lines').update({ review_status: 'ok', vendor_detail: rest }).eq('id', r.id)
          if (error) throw new Error(describeLineInsertError(error))
        }
        await reconcileRun(supabase, run.id)
      }
      res.status(200).json({ ok: true })
      return
    }

    res.status(400).json({ error: 'Unknown action' })
  } catch (e) {
    sendError(res, e, 'Item request failed')
  }
}
