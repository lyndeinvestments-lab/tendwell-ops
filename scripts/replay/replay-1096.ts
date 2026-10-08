// Replays invoice run 01dd8a32 (Busy Bee 1261003821 → QBO 1096) through the
// CURRENT engine + exporters using data dumped from Supabase, so the corrected
// AP/AR files come out of the exact code that will run in production.
// Usage: npx tsx scripts/replay/replay-1096.ts <dumpDir> <outDir>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { reconcile, ownerStayDuring, type PropertyRates, type RawLine, type EngineLine, type BilledClean, type StayRow } from '../../api/invoices/_engine.js'
import { AUX_CATEGORIES, classifyAuxTask } from '../../shared/aux-tasks.js'
import { buildEngineTasks } from '../../api/invoices/_lib.js'
import { toQboFlatCsv, toQboMultilineCsv, toRampCsv, toBillComCsv, type ExportLine, type ExportRun } from '../../api/invoices/_exporters.js'

const [dir, out] = process.argv.slice(2)
mkdirSync(out, { recursive: true })
const J = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'))

const props = J('properties.json') as Array<any>
const properties: PropertyRates[] = props.map(p => ({
  id: p.id, name: p.name, ceCharged: p.ceCharged, cleanerPay: p.cleanerPay, deepClean3xCe: p.deepClean3xCe,
  billingChannel: p.billingChannel ?? null, hotTub: p.hotTub === true,
}))
const byId = new Map(properties.map(p => [p.id, p]))
const byTrellis = new Map<string, number>()
for (const p of props) if (p.trellis_id) byTrellis.set(String(p.trellis_id), p.id)

const { tasks, trellisTasks } = buildEngineTasks(J('bw_tasks.json'), J('trellis.json'), byTrellis)

// Vendor's original lines: the base row of each line_no carries the vendor amount.
const cur = J('current_lines.json') as Array<any>
const groups = new Map<number, any[]>()
for (const r of cur) if (r.source === 'vendor' || r.source === 'manual') {
  const g = groups.get(r.line_no) ?? []; g.push(r); groups.set(r.line_no, g)
}
const rawLines: RawLine[] = [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([ln, rows]) => {
  const base = rows.find(r => r.split_group == null || r.line_kind !== 'extra') ?? rows[0]
  // Dylan Robinson 3742 (294) was hand-split 171.15 + 49.85 in review; the
  // vendor billed 221 — rebuild the original.
  const amt = ln === 294 ? 221 : base.raw_amount
  const note = rows.map(r => r.raw_note_text).find(n => n && n !== 'Onboarding surcharge') ?? null
  return { lineNo: ln, source: 'vendor', rawPropertyText: base.raw_property_text, rawNoteText: note, rawAmount: amt, rawDateMentioned: base.raw_date_mentioned }
})

const firstClean = new Map<number, string>((J('first_clean.json') as any[]).map(r => [Number(r.property_id), String(r.first_clean_date)]))
const billedCleans: BilledClean[] = (J('billed.json') as any[]).map(r => ({
  propertyId: Number(r.property_id), date: String(r.service_date ?? r.raw_date_mentioned), taskId: r.matched_task_id,
  ref: `invoice ${r.qbo_invoice_no ?? '(unnumbered)'} line ${r.line_no}`,
}))

// Haven reservations (owner blocks flagged) — dumped from trellis_reservation_snapshot.
const stays: StayRow[] = existsSync(join(dir, 'stays.json'))
  ? (J('stays.json') as any[]).flatMap(r => {
    const pid = r.trellis_property_id ? byTrellis.get(String(r.trellis_property_id)) : undefined
    return pid != null && r.checkin_date && r.checkout_date
      ? [{ propertyId: pid, checkin: r.checkin_date, checkout: r.checkout_date, isOwner: r.is_owner_block === true, guestName: r.guest_name }]
      : []
  })
  : []
console.log('stays', stays.length, 'owner blocks', stays.filter(s => s.isOwner).length)

const res = reconcile({
  stays,
  vendorId: '9733deb3-03b8-4e0b-81f6-f0d97fee0565', lines: rawLines, aliases: J('aliases.json'),
  properties, tasks: [...tasks, ...trellisTasks], periodStart: '2026-09-27', periodEnd: '2026-10-03',
  firstCleanByProperty: firstClean, billedCleans,
})
writeFileSync(join(out, 'engine_lines.json'), JSON.stringify(res.lines, null, 1))
writeFileSync(join(out, 'raw_total.txt'), String(rawLines.reduce((a, l) => a + l.rawAmount, 0)))
console.log('engine summary', res.summary)
const review = res.lines.filter(l => l.reviewStatus === 'needs_review')
console.log('needs_review', review.length)
for (const l of review) console.log(` #${l.lineNo} ${l.rawPropertyText} ${l.rawDateMentioned} $${l.rawAmount} [${l.flags.join(',')}] ${l.engineNote ?? ''}`)

// ─── Stage 2: human review decisions (each backed by evidence) ────────────────
// These are the review-queue answers a person gives in Ops; recorded here so
// the corrected files are reproducible. Links = evidence.
type Decision = { note: string; apply: (ls: EngineLine[]) => EngineLine[] }
const S = 'https://havenvacationrentals.slack.com/archives/'
const TR = 'https://app.trellistech.com/haven-vacation-rentals/tasks/'
const setAll = (patch: Partial<EngineLine>) => (ls: EngineLine[]) => ls.map(l => ({ ...l, ...patch }))
const exclude = (why: string) => setAll({ reviewStatus: 'excluded', engineNote: why })
const decisions: Record<number, Decision> = {
  72: { note: 'No clean on 9/27 (9/26 turn billed on 1095 line 198; 9/28 departure is line 132). Removed.', apply: exclude('REMOVED: no clean 9/27 — duplicate of 1095 line 198') },
  177: { note: `Only an inspection happened; Christine deleted the departure clean (${S}C08V5RCALJF/p1790794560217439). Removed.`, apply: exclude('REMOVED: inspection only, clean deleted by Haven') },
  245: { note: `Mis-dated: this is the 10/4 Turn Clean (Trellis completed 10/4). Billed under its real date 10/4; next week's 10/4 line will flag as already billed.`, apply: setAll({ serviceDate: '2026-10-04', serviceType: 'Turn Clean', reviewStatus: 'resolved', flags: ['date_corrected'] }) },
  184: { note: `Verified completed in live Haven Trellis (${TR}59192fa3-8e23-4ef5-a570-70f75c4277b8); our Breezeway copy is stale.`, apply: setAll({ reviewStatus: 'resolved' }) },
  190: { note: `Verified completed in live Haven Trellis (${TR}eec705b9-09af-4f10-b0ce-9a61cdbbc3a1).`, apply: setAll({ reviewStatus: 'resolved' }) },
  19: { note: `Correct: the 9/27 departure (${TR}b1cbb67b-0d8a-4a50-9ccc-124cf86b63fd). The WRONG line is 1095 line 176 (9/26 mid-stay vacuum billed as a $320 departure) — credit that separately.`, apply: setAll({ reviewStatus: 'resolved', serviceType: 'Departure Clean', serviceDate: '2026-09-27' }) },
  155: { note: 'HOLD: UPS shipping for guest left items (Judith Sharp dop kit, Walter Franey 2170; Jennifer Landolfi stuffed cat, Dustin Francis 3213). Per-package amounts unreadable and $129.27 vs $102.07 may be one receipt billed twice ($27.20 apart). Not billed or paid until the receipt is itemized.', apply: exclude('HOLD: receipt not itemized') },
  327: { note: 'HOLD: see line 155.', apply: exclude('HOLD: receipt not itemized') },
  328: { note: 'Facility labor (Sunday linen wash) — Tendwell expense, AP only.', apply: setAll({ lineKind: 'operating_expense', cleanerPayAmount: 1284, clientChargeAmount: null, billingChannel: 'none', reviewStatus: 'resolved' }) },
  136: { note: 'No task on 9/28 (first Trellis clean 10/4) — stays excluded as reviewed.', apply: exclude('Excluded in review: no task') },
  225: { note: 'Kept as reviewed (excluded). NOTE: Trellis shows a real 10/1 departure for the owner (Tendwell task 875e6df8) — Jordan to decide whether to bill the owner via bill.com.', apply: exclude('Excluded in review — see note') },
  93: { note: 'HOLD (Hostimo/bill.com): no completed clean 9/28; the first clean was 9/29 (line 165). Likely billed twice.', apply: exclude('HOLD: no clean 9/28') },
  310: { note: `Hostimo/bill.com: clean very likely done 10/3 (linen task completed; owner complaint about lights left on ${S}C0C2ED7C8F3/p1791132339894839) but the Trellis task is still open — close it in Trellis.`, apply: setAll({ reviewStatus: 'resolved' }) },
  248: { note: `Haven's onboarding clean (Haven Trellis ${TR}bc18837d-8168-4195-9a62-5b6d693ea121, BW 166203024). Property moved to Haven management 10/1-10/2, so this clean bills to Haven. No $50: Tendwell first cleaned 4420 on 8/17. ACTION: switch the property's client to Haven in Ops.`, apply: setAll({ billingChannel: 'qbo_haven', reviewStatus: 'resolved', serviceType: 'Onboarding Clean' }) },
  329: { note: 'One mid-stay trash pickup on 9/28 (BW "Cleaning: Mid-Stay Trash Pickup", owner charge). Dated from its note, not the 10/3 header.', apply: setAll({ rawNoteText: 'Mid-stay trash pickup 9/28 (guest Nikol)' }) },
  258: { note: 'Extra towels + 4 bath rugs delivered on 10/2 for the owner\'s stay (John Bryan and Family, 10/2–10/6), at the owner\'s request. Trip Fee, owner charge.', apply: setAll({ reviewNote: `Extra towels + 4 bath rugs delivered for the owner's stay, owner request ${S}C08V5RCALJF/p1790949842297229`, reviewStatus: 'resolved' }) },
}
let final: EngineLine[] = []
const log: Array<{ line: number; property: string | null; decision: string }> = []
const byLine = new Map<number, EngineLine[]>()
for (const l of res.lines) { const g = byLine.get(l.lineNo) ?? []; g.push(l); byLine.set(l.lineNo, g) }
for (const [ln, ls] of [...byLine.entries()].sort((a, b) => a[0] - b[0])) {
  const d = decisions[ln]
  if (d) { final.push(...d.apply(ls)); log.push({ line: ln, property: ls[0].rawPropertyText, decision: d.note }) }
  else final.push(...ls)
}
const stillOpen = final.filter(l => l.reviewStatus === 'needs_review')
if (stillOpen.length) { console.error('UNRESOLVED', stillOpen.map(l => l.lineNo)); process.exit(1) }

// Billable auxiliary task lines already on the run (not paid to Busy Bee), minus
// the Brian Hopp 9/28 trash pickup — Busy Bee billed it (line 329, dated 9/28
// from its note), so the task line would bill it twice.
const taskLines = (J('task_lines.json') as any[]).filter(t => t.review_status !== 'excluded' && t.line_no !== 483)
log.push({ line: 483, property: 'Brian Hopp 3163', decision: 'Removed task line: duplicate of vendor line 329 (same 9/28 mid-stay trash pickup).' })
// Task lines were built by the pre-2026-10-08 classifier: re-derive the
// service (deliveries are Trip Fees now) and the owner-stay flag. A price a
// human set (Kristy Horn's $35) is kept.
const taskExport: ExportLine[] = taskLines.map(t => ({
  lineKind: 'extra', serviceType: AUX_CATEGORIES[classifyAuxTask(t.raw_note_text)].serviceType ?? t.service_type, serviceDate: t.raw_date_mentioned, propertyName: byId.get(t.property_id)?.name ?? t.raw_property_text,
  propertyId: t.property_id, clientName: null, billingChannel: t.billing_channel, cleanerPayAmount: null, clientChargeAmount: t.client_charge_amount,
  note: t.raw_note_text, reviewStatus: 'ok',
  flags: [...t.flags, ...(t.raw_date_mentioned && ownerStayDuring(t.property_id, t.raw_date_mentioned, stays) ? ['owner_stay'] : [])],
}))
// Craig Sims 196 10/3 turn — cleaned by Hope for Your Home (Tendwell's sub),
// completed in Haven Trellis; was hand-added to QBO 1096. Paid outside Busy Bee.
const manual: ExportLine[] = [{
  lineKind: 'clean', serviceType: 'Turn Clean', serviceDate: '2026-10-03', propertyName: 'Craig Sims 196', propertyId: 20, clientName: null,
  billingChannel: 'qbo_haven', cleanerPayAmount: null, clientChargeAmount: 250, note: null, reviewStatus: 'ok', flags: [],
}]
log.push({ line: 0, property: 'Craig Sims 196', decision: 'Added: 10/3 Turn Clean by Hope for Your Home (Tendwell subcontractor), completed in Haven Trellis — was hand-added to the original QBO 1096.' })

const toExport = (l: EngineLine): ExportLine => ({
  lineKind: l.lineKind, serviceType: l.serviceType, serviceDate: l.serviceDate ?? l.rawDateMentioned,
  propertyName: l.propertyId != null ? byId.get(l.propertyId)?.name ?? null : null, rawPropertyText: l.rawPropertyText,
  propertyId: l.propertyId, clientName: null, billingChannel: l.billingChannel, cleanerPayAmount: l.cleanerPayAmount,
  clientChargeAmount: l.clientChargeAmount, note: l.rawNoteText, reviewNote: (l as any).reviewNote ?? null,
  reviewStatus: l.reviewStatus, splitGroup: l.splitGroup, flags: l.flags,
})
const all: ExportLine[] = [...final.map(toExport), ...taskExport, ...manual]
const run: ExportRun = {
  vendorName: 'Busy Bee Cleaning', vendorInvoiceNumber: '1261003821', invoiceDate: '2026-10-03', dueDate: '2026-10-03',
  qboInvoiceNo: 1096, qboInvoiceNos: { '2026-09': 1096, '2026-10': 1097 }, periodEnd: '2026-10-03',
}
writeFileSync(join(out, 'qbo_flat.csv'), toQboFlatCsv(run, all))
writeFileSync(join(out, 'qbo_multiline.csv'), toQboMultilineCsv(run, all))
writeFileSync(join(out, 'ramp.csv'), toRampCsv(run, all))
writeFileSync(join(out, 'billcom.csv'), toBillComCsv(run, all))
writeFileSync(join(out, 'decisions.json'), JSON.stringify(log, null, 1))
writeFileSync(join(out, 'final_lines.json'), JSON.stringify(all, null, 1))
// AP reconciliation per vendor line: what Busy Bee billed vs what we pay.
const apRows = [...byLine.keys()].sort((a, b) => a - b).map(ln => {
  const ls = final.filter(l => l.lineNo === ln)
  const raw = rawLines.find(r => r.lineNo === ln)!
  const pay = ls.filter(l => l.lineKind !== 'excluded' && l.reviewStatus !== 'excluded').reduce((a, l) => a + (l.cleanerPayAmount ?? 0), 0)
  return { line: ln, property: raw.rawPropertyText, note: raw.rawNoteText, date: ls[0].serviceDate ?? raw.rawDateMentioned, billed: raw.rawAmount, pay: Math.round(pay * 100) / 100, flags: [...new Set(ls.flatMap(l => l.flags))], why: ls.map(l => l.engineNote).find(Boolean) ?? null, decision: decisions[ln]?.note ?? null }
})
writeFileSync(join(out, 'ap_recon.json'), JSON.stringify(apRows, null, 1))
console.log('done')
