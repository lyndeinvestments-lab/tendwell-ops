// Special cleaning rates on specific guest reservations (Jordan 2026-10-12).
//
// A client can discount the clean for particular stays (Mark Bulba's
// "TW Discounted Cleaning Reservations" list: e.g. $155 instead of $180 at
// EasyStreet2882 for confirmation HMM2YCTSSF). A reservation's clean is the
// one after the guest checks out: the clean dated the checkout day, or, when
// there is none that day, the next day's. Each reservation discounts at most
// one clean, and each clean at most one reservation. The history agrees: at
// these properties the cleans fall on checkout days (9/27, 9/29, 10/1...).
//
// Used by the invoice engine (api/invoices/_engine.ts) and by the Task audit
// import. Keep this file dependency-free: it is imported from both the Vite
// client bundle and the serverless functions.

export const SPECIAL_RATE_FLAG = 'special_rate'

export interface ReservationRate {
  propertyId: number
  confirmationCode: string
  checkin: string   // yyyy-mm-dd
  checkout: string  // yyyy-mm-dd
  standardCharge: number | null
  specialCharge: number
}

/** A billed line the rate could apply to. */
export interface RateCandidate {
  key: string
  propertyId: number
  date: string      // yyyy-mm-dd
}

const addDays = (iso: string, n: number): string => {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)))
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Clean service types a special rate replaces (never deep cleans, extras or
 *  onboarding surcharges). */
export function isRateEligibleService(serviceType: string | null | undefined): boolean {
  return /\b(turn|departure)\b/i.test(serviceType ?? '') || /^last clean/i.test(serviceType ?? '')
}

/**
 * Which reservation each candidate clean belongs to. Exact checkout-day
 * matches are settled first, so a clean the morning after one stay can never
 * take the place of another stay's checkout-day clean.
 */
export function planReservationRates(
  candidates: ReadonlyArray<RateCandidate>,
  rates: ReadonlyArray<ReservationRate>,
): Map<string, ReservationRate> {
  const out = new Map<string, ReservationRate>()
  const used = new Set<ReservationRate>()
  const byPropDate = new Map<string, RateCandidate[]>()
  for (const c of [...candidates].sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key))) {
    const k = `${c.propertyId}|${c.date}`
    byPropDate.set(k, [...(byPropDate.get(k) ?? []), c])
  }
  const sorted = [...rates].sort((a, b) => a.checkout.localeCompare(b.checkout) || a.confirmationCode.localeCompare(b.confirmationCode))
  for (const offset of [0, 1]) {
    for (const r of sorted) {
      if (used.has(r)) continue
      const day = offset === 0 ? r.checkout : addDays(r.checkout, offset)
      const c = (byPropDate.get(`${r.propertyId}|${day}`) ?? []).find(x => !out.has(x.key))
      if (!c) continue
      out.set(c.key, r)
      used.add(r)
    }
  }
  return out
}

const usd = (n: number) => `$${n.toFixed(2)}`
const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`

export function specialRateNote(r: ReservationRate, billedBefore: number | null): string {
  const normally = r.standardCharge ?? billedBefore
  return `Special rate ${usd(r.specialCharge)} for reservation ${r.confirmationCode} (stay ${md(r.checkin)}–${md(r.checkout)})` +
    (normally != null && Math.abs(normally - r.specialCharge) > 0.005 ? ` instead of ${usd(normally)}.` : '.')
}

// ─── Importing a client's list ───────────────────────────────────────────────
//
// Reads the columns of the list Mark Bulba sent (LISTING'S NICKNAME,
// CONFIRMATION CODE, CHECK-IN, CHECK-OUT, LISTING'S ADDRESS, TW Rate,
// TW Special Rate), tolerant of header case and punctuation.

export interface ImportedRateRow {
  row: number
  nickname: string | null
  address: string | null
  confirmationCode: string
  checkin: string
  checkout: string
  standardCharge: number | null
  specialCharge: number
}

export interface ImportProblem { row: number; message: string }

const headerKey = (h: string) => h.toLowerCase().replace(/[^a-z]/g, '')
const HEADERS: Record<string, keyof ImportedRateRow> = {
  listingsnickname: 'nickname', nickname: 'nickname', listing: 'nickname', listingname: 'nickname',
  listingsaddress: 'address', address: 'address',
  confirmationcode: 'confirmationCode', confirmation: 'confirmationCode', reservation: 'confirmationCode',
  checkin: 'checkin', checkout: 'checkout',
  twrate: 'standardCharge', rate: 'standardCharge', standardrate: 'standardCharge',
  twspecialrate: 'specialCharge', specialrate: 'specialCharge',
}

/** yyyy-mm-dd from "2026-10-10 04:00 PM", "10/10/2026", or an Excel serial. */
export function parseSheetDate(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000).toISOString().slice(0, 10)
  }
  const s = String(v).trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s)
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3]
    return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  }
  if (/^\d+(\.\d+)?$/.test(s)) return parseSheetDate(Number(s))
  return null
}

const money = (v: unknown): number | null => {
  if (v == null || String(v).trim() === '') return null
  const n = Number(String(v).replace(/[$,\s]/g, ''))
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
}

const COLUMN_LABEL: Record<string, string> = {
  confirmationCode: 'the confirmation code', checkin: 'check-in', checkout: 'check-out', specialCharge: 'the special rate',
}

/** Parse sheet rows (first row = headers). */
export function parseRateRows(table: ReadonlyArray<ReadonlyArray<unknown>>): { rows: ImportedRateRow[]; problems: ImportProblem[] } {
  const rows: ImportedRateRow[] = []
  const problems: ImportProblem[] = []
  if (table.length === 0) return { rows, problems: [{ row: 0, message: 'The file is empty.' }] }
  const cols = new Map<keyof ImportedRateRow, number>()
  table[0].forEach((h, i) => {
    const k = HEADERS[headerKey(String(h ?? ''))]
    if (k && !cols.has(k)) cols.set(k, i)
  })
  for (const need of ['confirmationCode', 'checkin', 'checkout', 'specialCharge'] as const) {
    if (!cols.has(need)) problems.push({ row: 1, message: `Missing a column for ${COLUMN_LABEL[need]}.` })
  }
  if (problems.length) return { rows, problems }
  const get = (r: ReadonlyArray<unknown>, k: keyof ImportedRateRow) => (cols.has(k) ? r[cols.get(k)!] : undefined)
  table.slice(1).forEach((r, i) => {
    const rowNo = i + 2
    if (!r.some(c => c != null && String(c).trim() !== '')) return
    const code = String(get(r, 'confirmationCode') ?? '').trim()
    const checkin = parseSheetDate(get(r, 'checkin'))
    const checkout = parseSheetDate(get(r, 'checkout'))
    const special = money(get(r, 'specialCharge'))
    if (!code) { problems.push({ row: rowNo, message: 'No confirmation code.' }); return }
    if (!checkin || !checkout) { problems.push({ row: rowNo, message: `${code}: check-in or check-out is not a date.` }); return }
    if (checkout < checkin) { problems.push({ row: rowNo, message: `${code}: check-out is before check-in.` }); return }
    if (special == null) { problems.push({ row: rowNo, message: `${code}: no special rate.` }); return }
    const nick = get(r, 'nickname')
    const addr = get(r, 'address')
    rows.push({
      row: rowNo,
      nickname: nick == null || String(nick).trim() === '' ? null : String(nick).trim(),
      address: addr == null || String(addr).trim() === '' ? null : String(addr).trim(),
      confirmationCode: code,
      checkin,
      checkout,
      standardCharge: money(get(r, 'standardCharge')),
      specialCharge: special,
    })
  })
  return { rows, problems }
}

export interface PropertyRef { id: number; name: string; address: string | null }

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
/** "2936 Valley Springs Way, Sevierville…" → "2936 valley" */
const streetKey = (a: string | null) => {
  const m = /^\s*(\d+)\s+([a-z]+)/i.exec(a ?? '')
  return m ? `${m[1]} ${m[2].toLowerCase()}` : null
}

/** The property a row is for: the listing name (spaces and punctuation
 *  ignored, a trailing house number optional), else the street number and
 *  name. Ambiguous or no match → null, never a guess. */
export function matchRateProperty(row: Pick<ImportedRateRow, 'nickname' | 'address'>, props: ReadonlyArray<PropertyRef>): PropertyRef | null {
  if (row.nickname) {
    const n = squash(row.nickname)
    const byName = props.filter(p => squash(p.name) === n)
    if (byName.length === 1) return byName[0]
    const bare = n.replace(/\d+$/, '')
    const loose = props.filter(p => squash(p.name).replace(/\d+$/, '') === bare && bare.length >= 4)
    if (byName.length === 0 && loose.length === 1) return loose[0]
  }
  const key = streetKey(row.address)
  if (key) {
    const byAddr = props.filter(p => streetKey(p.address) === key)
    if (byAddr.length === 1) return byAddr[0]
  }
  return null
}
