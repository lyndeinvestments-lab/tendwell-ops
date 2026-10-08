// End-to-end check of the vendor invoicing portal's server logic against the
// LIVE database, using a throwaway vendor that is deleted at the end.
//
//   npx tsx scripts/verify-vendor-portal.ts [period_start] [period_end]
//
// Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (reads ../../../.env.local
// when run from a worktree, else ./.env.local). Exits non-zero on any failed
// check. Safe to re-run: the test vendor's runs and receipts are removed in a
// finally block, and its draft only ever claims days for a few seconds.

import { readFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

for (const f of ['.env.local', '../../../.env.local']) {
  if (!existsSync(f)) continue
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
  }
}

const { populateDraft, runDetail } = await import('../api/vendor-invoices/runs.js')
const { rowFor } = await import('../api/vendor-invoices/items.js')
const { reconcileRun } = await import('../api/invoices/_lib.js')
const { RUN_COLUMNS, loadRunLines, vendorTotal, isVendorVisible, receiptPrefix, RECEIPT_BUCKET } = await import('../api/vendor-invoices/_lib.js')
const { validateVendorItem } = await import('../shared/vendor-invoice.js')

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const START = process.argv[2] ?? '2026-10-04'
const END = process.argv[3] ?? '2026-10-07'

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

const FORBIDDEN_KEYS = ['client_charge_amount', 'billing_channel', 'engine_note', 'review_note', 'ce_charged', 'contact_id', 'clientChargeAmount', 'raw_note_text']

function forbiddenKeysIn(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => forbiddenKeysIn(v, `${path}[${i}]`))
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => [
      ...(FORBIDDEN_KEYS.includes(k) ? [`${path}.${k}`] : []),
      ...forbiddenKeysIn(v, `${path}.${k}`),
    ])
  }
  return []
}

const { data: vendor, error: vErr } = await supabase
  .from('vendors')
  .insert({ name: `ZZ Portal Test Vendor ${Date.now()}`, active: false })
  .select('id, name')
  .single()
if (vErr || !vendor) throw new Error(`vendor: ${vErr?.message}`)
const actor = { email: 'portal-test@tendwell.invalid', label: 'test', role: 'supervisor', isAdmin: false, vendorId: vendor.id, vendorName: vendor.name }
const runIds: string[] = []

try {
  // ── 1. Draft from completed tasks ──
  const t0 = Date.now()
  const { data: run, error: rErr } = await supabase
    .from('invoice_runs')
    .insert({ vendor_id: vendor.id, source: 'vendor_portal', status: 'draft', period_start: START, period_end: END, invoice_date: END, created_by: actor.email })
    .select(RUN_COLUMNS)
    .single()
  if (rErr || !run) throw new Error(`run: ${rErr?.message}`)
  runIds.push((run as any).id)
  const draft = await populateDraft(supabase, run as any)
  console.log(`draft built in ${Date.now() - t0} ms: ${draft.added} cleans, ${draft.skipped.length} skipped`)
  check('draft has cleans', draft.added > 0)

  const lines = await loadRunLines(supabase, (run as any).id)
  const cleanRows = lines.filter(l => ['clean', 'deep_clean', 'combined_split'].includes(l.line_kind) && l.review_status !== 'excluded')
  const days = new Set(cleanRows.map(l => `${l.property_id}|${l.service_date}`))
  check('one clean per property-day', days.size === cleanRows.length, `${cleanRows.length} rows, ${days.size} days`)
  check('every clean line has a date', lines.filter(l => l.vendor_category === 'clean').every(l => !!(l.service_date ?? l.raw_date_mentioned)))
  check('run stays a draft after reconcile', (await supabase.from('invoice_runs').select('status').eq('id', (run as any).id).single()).data?.status === 'draft')
  const claimKeys = (await supabase.from('invoice_lines').select('clean_claim_key').eq('run_id', (run as any).id).not('clean_claim_key', 'is', null)).data ?? []
  check('every clean holds a claim', claimKeys.length === cleanRows.length, `${claimKeys.length} claims`)
  const dupes = lines.filter(l => (l.flags ?? []).includes('possible_duplicate'))
  console.log(`  possible duplicates sent to review: ${dupes.length} ${dupes.map(d => `${d.property_id}@${d.service_date}`).join(', ')}`)

  // Compare with the admin "generated" path for the same days, if one exists.
  const { data: adminRun } = await supabase.from('invoice_runs').select('id').eq('source', 'generated').eq('period_start', START).eq('period_end', END).is('archived_at', null).maybeSingle()
  if (adminRun) {
    // The admin path used to draft vacancy cleans / touch-ups / inspections
    // as full cleans; those are deliberately NOT portal cleans.
    const adminLines = ((await supabase.from('invoice_lines').select('property_id, service_date, raw_date_mentioned, raw_note_text, line_kind, cleaner_pay_amount').eq('run_id', adminRun.id).in('line_kind', ['clean', 'deep_clean', 'combined_split'])).data ?? [])
      .filter(l => !/vacancy|touch.?up|in?spection|assess/i.test(l.raw_note_text ?? ''))
    const adminDays = new Set(adminLines.map(l => `${l.property_id}|${l.service_date ?? l.raw_date_mentioned}`))
    const missing = [...adminDays].filter(d => !days.has(d))
    const extra = [...days].filter(d => !adminDays.has(d))
    console.log(`  admin generated run: ${adminLines.length} clean rows over ${adminDays.size} property-days; portal ${cleanRows.length}`)
    check('portal covers every property-day the admin draft found', missing.length === 0, missing.slice(0, 5).join(', '))
    console.log(`  days only in portal draft: ${extra.length} ${extra.slice(0, 5).join(', ')}`)
  }

  // ── 1b. Reconcile applies all-or-nothing (invoice_apply_reconcile) ──
  {
    const before = await loadRunLines(supabase, (run as any).id)
    const victims = before.filter(l => l.vendor_category === 'clean').slice(0, 3)
    const day = victims[0]
    const clash = { line_no: 9001, source: 'vendor', raw_property_text: 'x', raw_amount: 1, raw_date_mentioned: day.service_date, service_date: day.service_date, property_id: day.property_id, line_kind: 'clean', review_status: 'ok' }
    // Deletes 3 real lines, then inserts two rows claiming one property-day:
    // the second insert fails, so the deletes must roll back too.
    const { error: failErr } = await supabase.rpc('invoice_apply_reconcile', {
      p_run_id: (run as any).id,
      p_delete_ids: victims.map(v => v.id),
      p_rows: [clash, { ...clash, line_no: 9002 }],
      p_run: {},
    })
    const after = await loadRunLines(supabase, (run as any).id)
    check('a failure mid-apply rolls back every delete (nothing lost)', !!failErr && after.length === before.length && victims.every(v => after.some(a => a.id === v.id)), `${failErr?.code} ${before.length}→${after.length}`)
    const { error: staleErr } = await supabase.rpc('invoice_apply_reconcile', {
      p_run_id: (run as any).id, p_delete_ids: [victims[0].id, '00000000-0000-0000-0000-000000000000'], p_rows: [], p_run: {},
    })
    const after2 = await loadRunLines(supabase, (run as any).id)
    check('stale row ids abort the apply without touching the run', /changed while reconciling/.test(staleErr?.message ?? '') && after2.length === before.length, `${staleErr?.code} ${after2.length}`)
    const anonClient = createClient(process.env.SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!)
    const { error: anonErr } = await anonClient.rpc('invoice_apply_reconcile', { p_run_id: (run as any).id, p_delete_ids: [], p_rows: [], p_run: {} })
    check('only the server can call the apply function', !!anonErr, anonErr?.message ?? 'no error')
  }

  // ── 2. Vendor view carries no Tendwell-internal data ──
  const fresh = (await supabase.from('invoice_runs').select(RUN_COLUMNS).eq('id', (run as any).id).single()).data
  const detail = await runDetail(supabase, fresh as any)
  const leaks = forbiddenKeysIn(detail)
  check('vendor payload has no client/billing/internal fields', leaks.length === 0, leaks.slice(0, 5).join(', '))
  const propKeys = new Set(Object.values(detail.properties).flatMap(p => Object.keys(p as object)))
  check('property fields are exactly the Property List set', [...propKeys].sort().join(',') === 'address,bedrooms,cleaner_pay,full_baths,guest_count,id,name,square_footage,status', [...propKeys].join(','))
  check('vendor total = sum of visible line amounts', Math.abs(detail.run.total! - detail.lines.filter(l => !l.removed).reduce((a, l) => a + (l.amount ?? 0), 0)) < 0.01, String(detail.run.total))
  const taskOnly = lines.filter(l => l.source === 'task').length
  check('Tendwell-only task lines are hidden from the vendor', detail.lines.length === lines.filter(isVendorVisible).length && detail.lines.length <= lines.length - taskOnly, `${taskOnly} hidden`)

  // ── 3. Duplicate guards ──
  const { error: overlapErr } = await supabase.from('invoice_runs').insert({ vendor_id: vendor.id, source: 'vendor_portal', status: 'draft', period_start: END, period_end: END, invoice_date: END })
  check('overlapping invoice for the same vendor is refused', overlapErr?.code === '23P01', overlapErr?.message ?? 'no error')
  const sample = cleanRows[0]
  const { error: dupErr } = await supabase.from('invoice_lines').insert({
    run_id: (run as any).id, line_no: 9999, source: 'vendor', raw_property_text: 'dup', raw_amount: 1, raw_date_mentioned: sample.service_date,
    service_date: sample.service_date, property_id: sample.property_id, line_kind: 'clean', review_status: 'ok', flags: [],
  })
  check('a second clean for the same property-day is refused by the DB', dupErr?.code === '23505', dupErr?.message ?? 'no error')

  // ── 4. Vendor items ──
  const prop = (await supabase.from('properties').select('id, name, cleaner_pay, contact_id').eq('id', sample.property_id!).single()).data!
  const ctx = { periodStart: START, periodEnd: END, today: END, propertyCleanerPay: Number(prop.cleaner_pay) }
  const add = async (input: any) => {
    const v = validateVendorItem(input, ctx)
    if (!v.ok) throw new Error(`invalid: ${JSON.stringify(v.errors)}`)
    const ln = Math.max(0, ...(await loadRunLines(supabase, (run as any).id)).map(l => l.line_no)) + 1
    const row = await rowFor(supabase, v.item, prop, actor as any)
    const { error } = await supabase.from('invoice_lines').insert({ ...row, run_id: (run as any).id, line_no: ln })
    return error
  }
  const receipt = `${receiptPrefix(vendor.id, (run as any).id)}test.pdf`
  await supabase.storage.from(RECEIPT_BUCKET).upload(receipt, new Blob(['%PDF-1.4 test']), { contentType: 'application/pdf' })
  check('inspection hours (no date) accepted', !(await add({ category: 'inspection', worker: 'Irma', hours: 6, rate: 18 })))
  check('reimbursement with receipt accepted', !(await add({ category: 'reimbursement', property_id: prop.id, date: START, amount: 23.45, description: 'UPS return of guest charger', requested_by: 'Guest J. Doe, res HM123', receipt_path: receipt })))
  check('pet fee with evidence link accepted', !(await add({ category: 'extra', property_id: prop.id, date: START, service_type: 'Pet Fee', amount: 25, description: 'Dog hair on every bed and couch', evidence_url: 'https://tendwell.slack.com/archives/C08/p1' })))
  const dupMissing = await add({ category: 'missing_clean', property_id: prop.id, date: sample.service_date, service_type: 'Turn Clean', description: 'Testing the duplicate guard here' })
  check('a "missing clean" on a day already billed is refused', dupMissing?.code === '23505', dupMissing?.message ?? 'no error')
  await reconcileRun(supabase, (run as any).id)
  const after = await loadRunLines(supabase, (run as any).id)
  const items = after.filter(l => l.vendor_category && l.vendor_category !== 'clean')
  check('every vendor item is in Tendwell review', items.every(l => l.review_status === 'needs_review'), items.map(l => `${l.vendor_category}:${l.review_status}`).join(' '))
  const pet = after.find(l => l.vendor_category === 'extra')
  check('pet fee priced from the fee list, pinned type kept', pet?.service_type === 'Pet Fee' && pet?.line_kind === 'extra' && Number(pet?.cleaner_pay_amount) === 25, `${pet?.service_type} ${pet?.line_kind} pay ${pet?.cleaner_pay_amount}`)
  const insp = after.find(l => l.vendor_category === 'inspection')
  check('inspection hours paid as a Tendwell expense', insp?.line_kind === 'operating_expense' && Number(insp?.cleaner_pay_amount) === 108)

  // ── 5. Remove / restore a clean ──
  const target = after.find(l => l.vendor_category === 'clean' && l.review_status !== 'excluded')!
  await supabase.from('invoice_lines').update({ review_status: 'excluded', vendor_detail: { ...(target.vendor_detail ?? {}), removed_reason: 'Not our clean, test' } }).eq('id', target.id)
  const claimAfterRemove = (await supabase.from('invoice_lines').select('clean_claim_key').eq('id', target.id).single()).data?.clean_claim_key
  check('removing a clean releases its claim', claimAfterRemove == null)
  await reconcileRun(supabase, (run as any).id)
  check('a removed clean stays removed through reconcile', (await supabase.from('invoice_lines').select('review_status').eq('id', target.id).maybeSingle()).data?.review_status === 'excluded')

  // ── 6. Submit / return ──
  const rows = (await loadRunLines(supabase, (run as any).id)).filter(isVendorVisible)
  const total = vendorTotal(rows)
  await supabase.from('invoice_runs').update({ status: 'review_needed', submitted_at: new Date().toISOString(), submitted_by: actor.email, vendor_total: total }).eq('id', (run as any).id)
  const { error: reconErr } = await supabase.from('invoice_runs').update({ status: 'draft', returned_at: new Date().toISOString(), returned_note: 'test return' }).eq('id', (run as any).id)
  check('submit then return round-trips', !reconErr)

  // ── 7. Archiving releases claims ──
  await supabase.from('invoice_runs').update({ archived_at: new Date().toISOString() }).eq('id', (run as any).id)
  const left = (await supabase.from('invoice_lines').select('id', { count: 'exact', head: true }).eq('run_id', (run as any).id).not('clean_claim_key', 'is', null)).count
  check('archiving a vendor invoice releases every claim', left === 0, `${left} left`)
} finally {
  for (const id of runIds) {
    const prefix = receiptPrefix(vendor.id, id)
    const { data: files } = await supabase.storage.from(RECEIPT_BUCKET).list(prefix.replace(/\/$/, ''))
    if (files?.length) await supabase.storage.from(RECEIPT_BUCKET).remove(files.map(f => `${prefix}${f.name}`))
  }
  await supabase.from('invoice_runs').delete().eq('vendor_id', vendor.id)
  await supabase.from('vendors').delete().eq('id', vendor.id)
  console.log('cleaned up test vendor')
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed')
process.exit(failures ? 1 : 0)
