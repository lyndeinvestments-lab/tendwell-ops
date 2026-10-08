// HTTP end-to-end check of the vendor invoicing portal against a DEPLOYED
// build (preview or production), as a real signed-in vendor login.
//
//   npx tsx scripts/verify-vendor-portal-http.ts https://<deployment-host> [period_start] [period_end]
//
// Creates, then always removes: a throwaway vendor, a temporary password
// auth user + `supervisor` app_users row linked to it, and the vendor's
// invoices/receipts. Exits non-zero on any failed check. Optional
// VERCEL_BYPASS env = protection-bypass secret, or VERCEL_COOKIE = a
// `_vercel_jwt=…` cookie from a share link, for protected previews.

import { readFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

for (const f of ['.env.local', '../../../.env.local']) {
  if (!existsSync(f)) continue
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
  }
}

const BASE = (process.argv[2] ?? '').replace(/\/$/, '')
if (!/^https:\/\//.test(BASE)) throw new Error('usage: verify-vendor-portal-http.ts https://<host> [start] [end]')
const START = process.argv[3] ?? '2026-10-04'
const END = process.argv[4] ?? '2026-10-07'
const SB_URL = process.env.SUPABASE_URL!
const admin = createClient(SB_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const anon = createClient(SB_URL, process.env.VITE_SUPABASE_ANON_KEY!, { auth: { persistSession: false } })

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}
const FORBIDDEN = ['client_charge_amount', 'billing_channel', 'engine_note', 'review_note', 'ce_charged', 'contact_id', 'raw_note_text', 'receipt_path', 'vendor_draft_meta']
function leaks(v: unknown, path = '$'): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => leaks(x, `${path}[${i}]`))
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => [...(FORBIDDEN.includes(k) ? [`${path}.${k}`] : []), ...leaks(x, `${path}.${k}`)])
  return []
}

const stamp = Date.now()
const email = `zz-portal-e2e-${stamp}@example.com`
const password = `E2e-${stamp}-${Math.random().toString(36).slice(2)}`
let token = ''
async function api(path: string, opts: { method?: string; body?: unknown; query?: Record<string, string> } = {}) {
  const qs = opts.query ? `?${new URLSearchParams(opts.query)}` : ''
  const res = await fetch(`${BASE}/api/${path}${qs}`, {
    method: opts.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(process.env.VERCEL_BYPASS ? { 'x-vercel-protection-bypass': process.env.VERCEL_BYPASS } : {}),
      ...(process.env.VERCEL_COOKIE ? { Cookie: process.env.VERCEL_COOKIE } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}

// Active for the few seconds the check runs: the API refuses logins linked to
// an inactive vendor (asserted at the end).
const { data: vendor } = await admin.from('vendors').insert({ name: `ZZ E2E Vendor ${stamp}`, active: true }).select('id, name').single()
let userId: string | null = null
try {
  const { data: created, error: cuErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (cuErr || !created.user) throw new Error(`createUser: ${cuErr?.message}`)
  userId = created.user.id
  await admin.from('app_users').insert({ google_email: email, role: 'supervisor', label: 'ZZ Portal E2E' })
  const { data: sess, error: sErr } = await anon.auth.signInWithPassword({ email, password })
  if (sErr || !sess.session) throw new Error(`signIn: ${sErr?.message}`)
  token = sess.session.access_token

  // ── Not linked yet ──
  const unlinked = await api('vendor-invoices/runs')
  check('an unlinked supervisor is refused', unlinked.status === 403 && unlinked.json.error === 'not_linked', `${unlinked.status} ${unlinked.json.error}`)

  await admin.from('vendor_users').insert({ vendor_id: vendor!.id, email, created_by: 'e2e' })

  // ── Home ──
  const home = await api('vendor-invoices/runs')
  check('linked supervisor sees their own vendor', home.status === 200 && home.json.vendor?.id === vendor!.id, `${home.status} ${home.json.vendor?.name}`)

  // ── Create ──
  const t0 = Date.now()
  const created2 = await api('vendor-invoices/runs', { method: 'POST', body: { action: 'create', period_start: START, period_end: END } })
  check('create draft from completed tasks', created2.status === 200 && created2.json.lines?.length > 0, `${created2.status} ${created2.json.lines?.length} lines in ${Date.now() - t0} ms ${created2.json.error ?? ''} ${created2.json.detail ?? ''}`)
  const runId: string = created2.json.run?.id
  if (!runId) throw new Error('create failed — aborting')
  const l = leaks(created2.json)
  check('create response leaks nothing internal', l.length === 0, l.slice(0, 5).join(', '))
  const propKeys = new Set(Object.values(created2.json.properties ?? {}).flatMap((p: any) => Object.keys(p)))
  check('property fields = Property List set', [...propKeys].sort().join(',') === 'address,bedrooms,cleaner_pay,full_baths,guest_count,id,name,square_footage,status', [...propKeys].join(','))
  const dupe = await api('vendor-invoices/runs', { method: 'POST', body: { action: 'create', period_start: START, period_end: START } })
  check('an overlapping second invoice is refused', dupe.status === 409 && dupe.json.error === 'overlap', `${dupe.status} ${dupe.json.error}`)
  const future = await api('vendor-invoices/runs', { method: 'POST', body: { action: 'create', period_start: '2030-01-01', period_end: '2030-01-07' } })
  check('a future period is refused', future.status === 400 && future.json.error === 'date_in_future', `${future.status} ${future.json.error}`)

  // ── Items ──
  const firstClean = created2.json.lines.find((x: any) => x.category === 'clean')
  const pid = firstClean.property_id
  const up = await api('vendor-invoices/receipts', { method: 'POST', body: { action: 'upload_url', run_id: runId, content_type: 'application/pdf', size: 20 } })
  check('receipt upload link issued', up.status === 200 && !!up.json.token, `${up.status}`)
  const { error: upErr } = await anon.storage.from('vendor-invoices').uploadToSignedUrl(up.json.path, up.json.token, new Blob(['%PDF-1.4 e2e'], { type: 'application/pdf' }), { contentType: 'application/pdf' })
  check('receipt uploads through the signed link', !upErr, upErr?.message)
  const badType = await api('vendor-invoices/receipts', { method: 'POST', body: { action: 'upload_url', run_id: runId, content_type: 'text/html', size: 20 } })
  check('non-image/PDF uploads are refused', badType.status === 400, `${badType.status}`)

  const noReceipt = await api('vendor-invoices/items', { method: 'POST', body: { action: 'add', run_id: runId, item: { category: 'reimbursement', property_id: pid, date: START, amount: 20, description: 'UPS label for guest charger', requested_by: 'Guest J. Doe res HM1' } } })
  check('a reimbursement without a receipt is refused by the server', noReceipt.status === 400 && noReceipt.json.errors?.receipt_path === 'receipt_required', JSON.stringify(noReceipt.json.errors))
  const foreign = await api('vendor-invoices/items', { method: 'POST', body: { action: 'add', run_id: runId, item: { category: 'reimbursement', property_id: pid, date: START, amount: 20, description: 'UPS label for guest charger', requested_by: 'Guest J. Doe res HM1', receipt_path: 'vendor-portal/other/other/x.pdf' } } })
  check("another run's receipt path is refused", foreign.status === 400, `${foreign.status}`)
  const undated = await api('vendor-invoices/items', { method: 'POST', body: { action: 'add', run_id: runId, item: { category: 'labor', worker: 'Joshua', hours: 2, rate: 18, description: 'Linen washing at facility' } } })
  check('undated labor is refused', undated.status === 400 && undated.json.errors?.date === 'required', JSON.stringify(undated.json.errors))
  const reimb = await api('vendor-invoices/items', { method: 'POST', body: { action: 'add', run_id: runId, item: { category: 'reimbursement', property_id: pid, date: START, amount: 20.5, description: 'UPS label for guest charger', requested_by: 'Guest J. Doe res HM1', receipt_path: up.json.path } } })
  check('complete reimbursement accepted', reimb.status === 200, JSON.stringify(reimb.json))
  const insp = await api('vendor-invoices/items', { method: 'POST', body: { action: 'add', run_id: runId, item: { category: 'inspection', worker: 'Irma', hours: 4, rate: 18 } } })
  check('inspection hours without a date accepted', insp.status === 200, JSON.stringify(insp.json))
  const pet = await api('vendor-invoices/items', { method: 'POST', body: { action: 'add', run_id: runId, item: { category: 'extra', property_id: pid, date: START, service_type: 'Pet Fee', amount: 25, description: 'Dog hair on all beds and couch', evidence_url: 'https://tendwell.slack.com/archives/C1/p2' } } })
  check('pet fee with link accepted', pet.status === 200, JSON.stringify(pet.json))
  const dupClean = await api('vendor-invoices/items', { method: 'POST', body: { action: 'add', run_id: runId, item: { category: 'missing_clean', property_id: pid, date: firstClean.date, service_type: 'Turn Clean', description: 'testing the duplicate guard' } } })
  check('a missing clean on an already-billed day is refused', dupClean.status === 409, `${dupClean.status} ${dupClean.json.error}`)

  // ── Concurrency: two saves at once never collide ──
  const [c1, c2] = await Promise.all([
    api('vendor-invoices/items', { method: 'POST', body: { action: 'add', run_id: runId, item: { category: 'labor', worker: 'Joshua', date: START, hours: 1, rate: 18, description: 'Concurrent save test one' } } }),
    api('vendor-invoices/items', { method: 'POST', body: { action: 'add', run_id: runId, item: { category: 'labor', worker: 'Joshua', date: START, hours: 1, rate: 18, description: 'Concurrent save test two' } } }),
  ])
  check('simultaneous saves: one wins, the other is told to retry (or both land)', [c1.status, c2.status].includes(200) && [c1.status, c2.status].every(s => s === 200 || (s === 409)), `${c1.status}/${c2.status} ${c1.json.error ?? ''}${c2.json.error ?? ''}`)
  const afterConc = await api('vendor-invoices/runs', { query: { id: runId } })
  const nos = afterConc.json.lines.map((x: any) => x.line_no)
  check('no two lines share a line number', new Set(nos).size === nos.length, `${nos.length} lines`)
  for (const x of afterConc.json.lines.filter((x: any) => x.category === 'labor')) {
    await api('vendor-invoices/items', { method: 'POST', body: { action: 'delete', run_id: runId, line_no: x.line_no } })
  }

  // ── Remove / restore ──
  const shortReason = await api('vendor-invoices/items', { method: 'POST', body: { action: 'remove', run_id: runId, line_no: firstClean.line_no, reason: 'no' } })
  check('removing a clean needs a real reason', shortReason.status === 400, `${shortReason.status}`)
  const rm = await api('vendor-invoices/items', { method: 'POST', body: { action: 'remove', run_id: runId, line_no: firstClean.line_no, reason: 'Another company did this clean' } })
  const rs = await api('vendor-invoices/items', { method: 'POST', body: { action: 'restore', run_id: runId, line_no: firstClean.line_no } })
  check('remove then restore a clean', rm.status === 200 && rs.status === 200, `${rm.status}/${rs.status} ${JSON.stringify(rs.json)}`)

  // ── Detail after items ──
  const detail = await api('vendor-invoices/runs', { query: { id: runId } })
  const dl = leaks(detail.json)
  check('detail response leaks nothing internal', detail.status === 200 && dl.length === 0, dl.slice(0, 5).join(', '))
  const items = detail.json.lines.filter((x: any) => x.category !== 'clean')
  check('three vendor items, all in Tendwell review', items.length === 3 && items.every((x: any) => x.in_review), items.map((x: any) => `${x.category}:${x.in_review}`).join(' '))
  const sum = detail.json.lines.filter((x: any) => !x.removed).reduce((a: number, x: any) => a + (x.amount ?? 0), 0)
  check('total equals the sum of lines', Math.abs(sum - detail.json.run.total) < 0.01, `${detail.json.run.total} vs ${sum.toFixed(2)}`)
  const rcpt = await api('vendor-invoices/receipts', { query: { line_id: items.find((x: any) => x.category === 'reimbursement').id } })
  check('vendor can open their own receipt', rcpt.status === 200 && /^https:/.test(rcpt.json.url ?? ''), `${rcpt.status}`)

  // ── Isolation ──
  const { data: otherRun } = await admin.from('invoice_runs').select('id').neq('vendor_id', vendor!.id).limit(1).single()
  const peek = await api('vendor-invoices/runs', { query: { id: otherRun!.id } })
  check("another vendor's / admin's run is a 404", peek.status === 404, `${peek.status}`)
  const poke = await api('vendor-invoices/items', { method: 'POST', body: { action: 'add', run_id: otherRun!.id, item: { category: 'inspection', worker: 'X', hours: 1, rate: 1 } } })
  check("cannot add items to someone else's run", poke.status === 404, `${poke.status}`)
  const approve = await api('invoices/approve', { method: 'POST', body: { run_id: runId } })
  check('vendor login cannot call admin approve', approve.status === 403, `${approve.status}`)
  const authed = createClient(SB_URL, process.env.VITE_SUPABASE_ANON_KEY!, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: directLines } = await authed.from('invoice_lines').select('id, client_charge_amount').limit(5)
  const { data: directRuns } = await authed.from('invoice_runs').select('id').limit(5)
  check('vendor session reads no invoice rows directly (RLS)', (directLines ?? []).length === 0 && (directRuns ?? []).length === 0, `${directLines?.length}/${directRuns?.length}`)

  // ── Submit ──
  const sub = await api('vendor-invoices/runs', { method: 'POST', body: { action: 'submit', run_id: runId, vendor_reference: 'E2E-1' } })
  check('submit moves it to Tendwell', sub.status === 200 && sub.json.run?.status === 'submitted', `${sub.status} ${sub.json.run?.status}`)
  const { data: dbRun } = await admin.from('invoice_runs').select('status, vendor_total, submitted_by').eq('id', runId).single()
  check('admin side sees it in review with the vendor total', ['review_needed', 'reconciled'].includes(dbRun!.status) && Number(dbRun!.vendor_total) === sub.json.run.total, `${dbRun!.status} ${dbRun!.vendor_total}`)
  const late = await api('vendor-invoices/items', { method: 'POST', body: { action: 'add', run_id: runId, item: { category: 'inspection', worker: 'Irma', hours: 1, rate: 18 } } })
  check('a submitted invoice is locked', late.status === 409, `${late.status}`)
  const del = await api('vendor-invoices/runs', { method: 'POST', body: { action: 'delete', run_id: runId } })
  check('a submitted invoice cannot be deleted', del.status === 409, `${del.status}`)

  // ── Returned by Tendwell ──
  await admin.from('invoice_runs').update({ status: 'draft', returned_at: new Date().toISOString(), returned_by: 'e2e', returned_note: 'Please add the receipt photo' }).eq('id', runId)
  const back = await api('vendor-invoices/runs', { query: { id: runId } })
  check('a returned invoice shows the note and is editable again', back.json.run?.status === 'returned' && back.json.run?.returned_note === 'Please add the receipt photo', `${back.json.run?.status}`)

  // ── Deactivated vendor ──
  await admin.from('vendors').update({ active: false }).eq('id', vendor!.id)
  const inactive = await api('vendor-invoices/runs')
  check('a login linked to an inactive vendor is refused', inactive.status === 403, `${inactive.status}`)
} finally {
  const { data: runs } = await admin.from('invoice_runs').select('id').eq('vendor_id', vendor!.id)
  for (const r of runs ?? []) {
    const prefix = `vendor-portal/${vendor!.id}/${r.id}`
    const { data: files } = await admin.storage.from('vendor-invoices').list(prefix)
    if (files?.length) await admin.storage.from('vendor-invoices').remove(files.map(f => `${prefix}/${f.name}`))
  }
  await admin.from('invoice_runs').delete().eq('vendor_id', vendor!.id)
  await admin.from('vendor_users').delete().eq('email', email)
  await admin.from('app_users').delete().eq('google_email', email)
  if (userId) await admin.auth.admin.deleteUser(userId)
  await admin.from('vendors').delete().eq('id', vendor!.id)
  console.log('cleaned up test login, vendor and invoices')
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed')
process.exit(failures ? 1 : 0)
