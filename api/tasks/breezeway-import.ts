import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import Papa from 'papaparse'
import { autoActivateProperties } from './_auto-stage.js'

// POST /api/tasks/breezeway-import?source=current_month|next_month
//
// Auth: shared secret in `x-tendwell-import-key` header
//   (env var BREEZEWAY_IMPORT_KEY).
//
// Body: raw CSV text matching Breezeway's export shape:
//   Task title,Property,Department,Assignees,Due date,Issues,Comments,
//   Status,Priority,Total cost,Currency (Total cost),Estimated time,
//   Created date,Created by,Completed date,Completed by,Last updated date,
//   Property Time Zone
//
// Idempotent: each row's stable external_id is sha256(created|property|title|due)
// so re-imports overwrite the same row and the two daily exports
// (current month + next month) deduplicate naturally where their windows overlap.
//
// Response (200): { ok, batch, source, rows_seen, rows_upserted, rows_skipped,
//                    cleans_in_batch, unmatched_addresses_count,
//                    sample_unmatched_addresses, full_export? }
//
// OPT-IN full-export mode: ?full_export=true&window_start=YYYY-MM-DD&
// window_end=YYYY-MM-DD[&force=true] (or the same keys in a JSON body). The
// caller declares the CSV is Breezeway's COMPLETE list of tasks due in that
// window, so any breezeway_tasks row due in the window that is missing from
// it was deleted or cancelled in Breezeway: it is marked
// status='deleted_or_canceled' + disappeared_at (never deleted). Refused with
// 409, before anything is written, when it would mark more than
// disappearanceLimit() rows unless force=true. The daily incremental files
// never send these params, so nothing is ever marked by them.

interface BreezewayRow {
  'Task title'?: string
  'Property'?: string
  'Department'?: string
  'Assignees'?: string
  'Due date'?: string
  'Status'?: string
  'Priority'?: string
  'Created date'?: string
  'Completed date'?: string
  'Completed by'?: string
  'Last updated date'?: string
}

interface UpsertRow {
  external_id: string
  task_title: string
  property_raw: string | null
  property_address: string | null
  property_id: number | null
  department: string | null
  assignees: string | null
  due_date: string | null
  status: string | null
  priority: string | null
  completed_date: string | null
  completed_by: string | null
  created_date: string | null
  last_updated_date: string | null
  is_clean: boolean
  is_deep_clean: boolean
  source_label: string | null
  import_batch: string
  raw: Record<string, unknown>
}

// Titles that count as a regular "clean" for revenue / cleans-per-month
// rollups. Deep Clean is handled SEPARATELY (DEEP_CLEAN_TITLE_PATTERNS
// below) because it has its own cost + income profile.
//
// The list is intentionally explicit (no catch-all on "clean") because
// Breezeway uses non-revenue clean titles too — most importantly
// `Vacancy Clean`, which is intentionally EXCLUDED per the operator
// (unbooked tidy, not a revenue event).
//
// Inclusions (positive matches):
//   Departure Clean    e.g. "Departure Clean", "Departure Clean - HT"
//   Turn Clean         e.g. "Turn Clean"
//   Same Day Turn      e.g. "Same Day Turn"
//   Arrival Clean      e.g. "Arrival Clean"
//   Last Clean         e.g. "Last Clean & Linen Pull"
//   Onboarding Clean   first clean for a new property
const CLEAN_TITLE_PATTERNS = [
  /departure\s*clean/i,
  /turn\s*clean/i,
  /same\s*day\s*turn/i,
  /arrival\s*clean/i,
  /last\s*clean/i,
  /onboarding\s*clean/i,
]

// Deep cleans are priced differently from regular cleans (separate cost +
// separate income line item), so they get their own flag. Mutually
// exclusive with is_clean — deep wins if both regexes match (Deep Clean
// shouldn't ever be a Departure Clean, but defensive ordering matters).
const DEEP_CLEAN_TITLE_PATTERNS = [/deep\s*clean/i]

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

function normalizeDate(s: string | undefined): string | null {
  if (!s) return null
  const trimmed = s.trim()
  if (!trimmed) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  const d = new Date(trimmed)
  if (Number.isNaN(d.getTime())) return null
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function trimOrNull(s: string | undefined): string | null {
  if (!s) return null
  const t = s.trim()
  return t || null
}

// Property column shape: "{Name} {#} {emojis} ({Region}) - {Address}".
// We pull everything after the LAST " - " as the address; matching against
// `properties.address` walks backwards from that.
function extractAddress(propertyRaw: string | null): string | null {
  if (!propertyRaw) return null
  const parts = propertyRaw.split(' - ')
  if (parts.length < 2) return null
  return parts.slice(1).join(' - ').trim() || null
}

// The portion BEFORE " - " in Breezeway's Property column matches Tendwell's
// `properties.name` exactly when you strip the trailing " (REGION)" tag and
// any decorative emojis. e.g.
//   "Bobby Nicely 1132 (SCounty) - 1132 Sanctuary Shrs Wy…"  →  "Bobby Nicely 1132"
//   "Patrick Glasco 2728 ❌ 🔑 (SCounty) - 2728 Grn Mountain Wy…"  →  "Patrick Glasco 2728"
// Name match is more reliable than address match because Breezeway and
// Tendwell use wildly inconsistent abbreviations / formatting on addresses.
function extractPropertyNickname(propertyRaw: string | null): string | null {
  if (!propertyRaw) return null
  const beforeAddress = propertyRaw.split(' - ')[0]
  if (!beforeAddress) return null
  // Strip trailing region tag " (SCounty)" / " (GAT)" / " (PCenter)" / etc.
  const noRegion = beforeAddress.replace(/\s*\([^)]+\)\s*$/, '')
  // Strip emoji + ZWJ + variation selectors (covers ❌ 🔑 🙋 etc.).
  const noEmoji = noRegion.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}‍️]/gu, '')
  return noEmoji.replace(/\s+/g, ' ').trim() || null
}

function isDeepCleanTask(title: string | null): boolean {
  if (!title) return false
  return DEEP_CLEAN_TITLE_PATTERNS.some(re => re.test(title))
}

function isCleanTask(title: string | null): boolean {
  if (!title) return false
  // Deep cleans are categorized separately — don't double-count.
  if (isDeepCleanTask(title)) return false
  return CLEAN_TITLE_PATTERNS.some(re => re.test(title))
}

function getServiceClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

// Drain the request stream into a UTF-8 string. Used when the runtime did
// not auto-parse the body (e.g. Content-Type: text/csv on @vercel/node).
async function readRawBody(req: VercelRequest): Promise<string> {
  // Bound the stream so a key-holder can't OOM/timeout the function with a
  // multi-GB body. Breezeway CSV exports are far below this.
  const MAX_BYTES = 10 * 1024 * 1024 // 10 MB
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req as unknown as AsyncIterable<Buffer | string>) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    total += buf.length
    if (total > MAX_BYTES) throw new Error('Request body too large')
    chunks.push(buf)
  }
  return Buffer.concat(chunks).toString('utf8')
}

// USPS-style street-suffix abbreviations → expanded form. Both sides of the
// match (Breezeway and Tendwell) use mixed forms ("811 Bethlehem Way" vs
// "811 Bethlehem Wy, Sevierville, TN 37876, USA"), so we normalize to the
// full-word form before comparing.
const SUFFIX_EXPANSIONS: Record<string, string> = {
  wy: 'way',
  dr: 'drive',
  rd: 'road',
  ct: 'court',
  ln: 'lane',
  ave: 'avenue',
  av: 'avenue',
  blvd: 'boulevard',
  pl: 'place',
  st: 'street',
  hwy: 'highway',
  cir: 'circle',
  pkwy: 'parkway',
  ter: 'terrace',
  trl: 'trail',
  tr: 'trail',
  cv: 'cove',
  pt: 'point',
  sq: 'square',
}

// Strip the trailing ", City, State Zip[, Country]" that Tendwell's
// properties.address carries but Breezeway's CSV doesn't. Conservative —
// only removes from the FIRST comma onward.
function stripCityStateZip(addr: string): string {
  const idx = addr.indexOf(',')
  return idx >= 0 ? addr.slice(0, idx) : addr
}

function normalizeAddress(input: string | null): string {
  if (!input) return ''
  const stripped = stripCityStateZip(input)
  const lower = stripped.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim()
  // Expand each token if it's a known abbreviation. Keep order — only the
  // last 2-3 tokens of a typical address are suffixes, but tokens earlier
  // (like "St James Road") wouldn't normally collide because the comparison
  // is whole-string after normalization.
  const tokens = lower.split(' ').map(t => SUFFIX_EXPANSIONS[t] ?? t)
  return tokens.join(' ')
}

// Property-name normalization for the byName index. Mirrors `normalizeText`
// (plus its WTN→CTN rule) in api/invoices/_engine.ts — the two matchers are
// deliberately separate files (this endpoint is self-contained), so keep them
// in sync.
//
// Punctuation is collapsed to spaces because Breezeway and Ops disagree on
// separators: Ops has "CTN Engle Town 3030" where Breezeway writes
// "WTN-Engle Town 3030". Before this, that row imported with property_id NULL.
// Verified against the live table: normalizing introduces no new name
// collisions (the only collisions are rows that are already exact duplicates).
export function normalizePropertyName(s: string): string {
  const base = s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  // The CTN group was renamed from WTN; Ops has zero WTN properties, so
  // rewriting a leading wtn token is lossless.
  return base.replace(/^wtn\b/, 'ctn')
}

interface PropertyMatcher {
  byName: (nickname: string | null) => number | null
  byAddress: (addr: string | null) => number | null
}

async function buildPropertyMatcher(supabase: SupabaseClient): Promise<PropertyMatcher> {
  const { data, error } = await supabase
    .from('properties')
    .select('id, name, address')
    .is('deleted_at', null)
    .order('id')
  if (error || !data) return { byName: () => null, byAddress: () => null }
  return buildPropertyMatcherFrom(data as Array<{ id: number; name: string | null; address: string | null }>)
}

/** Pure, so the ambiguity rules are testable.
 *
 *  Both indexes only ever return a UNIQUE match. Before 2026-10-08 the address
 *  fallback returned the first stored address that merely CONTAINED the
 *  Breezeway one, in whatever order Postgres returned rows — so
 *  "Eric Fleming 1260-6203 … 1260 Ski View Drive" (no unit) landed on
 *  Stephanie Keegan 1260-5307 on some days and on Eric Fleming on others, and
 *  Mike Gunter 2691-8's tasks landed on Lewis Anderson 2691. A wrong property
 *  here bills one owner for another owner's clean, so an ambiguous match is
 *  left NULL for the resolution queue instead. */
export function buildPropertyMatcherFrom(
  rows: Array<{ id: number; name: string | null; address: string | null }>,
): PropertyMatcher {
  const byNameIdx = new Map<string, number | null>() // null = ambiguous
  const byAddrIdx = new Map<string, number | null>()
  const names: Array<{ key: string; id: number }> = []
  for (const p of rows) {
    if (p.name) {
      const k = normalizePropertyName(p.name)
      if (k) {
        byNameIdx.set(k, byNameIdx.has(k) && byNameIdx.get(k) !== p.id ? null : p.id)
        names.push({ key: k, id: p.id })
      }
    }
    if (p.address) {
      const norm = normalizeAddress(p.address)
      if (norm) byAddrIdx.set(norm, byAddrIdx.has(norm) && byAddrIdx.get(norm) !== p.id ? null : p.id)
    }
  }
  const unique = (ids: number[]): number | null => {
    const set = new Set(ids)
    return set.size === 1 ? [...set][0] : null
  }
  return {
    byName: (nickname) => {
      if (!nickname) return null
      const k = normalizePropertyName(nickname)
      if (!k) return null
      if (byNameIdx.has(k)) return byNameIdx.get(k) ?? null
      // "Eric Fleming 1260-6203" vs Ops "Eric Fleming 1260": the Ops name is a
      // whole-token prefix of the Breezeway one. Accept only when exactly one
      // Ops name is such a prefix (and it carries a number, so a bare owner
      // name with several cabins can never match).
      const prefixes = names.filter(n => /\d/.test(n.key) && k.startsWith(`${n.key} `)).map(n => n.id)
      return unique(prefixes)
    },
    byAddress: (addr) => {
      const needle = normalizeAddress(addr)
      if (!needle) return null
      if (byAddrIdx.has(needle)) return byAddrIdx.get(needle) ?? null
      const hits: number[] = []
      for (const [stored, id] of byAddrIdx.entries()) {
        if (id != null && (stored.includes(needle) || needle.includes(stored))) hits.push(id)
      }
      return unique(hits)
    },
  }
}

// ─── Full-export mode: tasks that disappeared from Breezeway ───────────────

// Mirrors DISAPPEARED_TASK_STATUS in shared/aux-tasks.ts (this endpoint is
// self-contained; keep the two in sync). The engine treats it as cancelled.
export const DISAPPEARED_STATUS = 'deleted_or_canceled'

// Safety threshold: a full export may mark at most this share of the window's
// live tasks, and never more than DISAPPEAR_MAX_COUNT, without force. A wrong
// window or a truncated export would otherwise wipe out a month of evidence.
export const DISAPPEAR_MAX_SHARE = 0.25
export const DISAPPEAR_MAX_COUNT = 50
// A full export covers a month or two; a longer window is almost certainly a
// typo (2026 for 2025) and would put a whole year's tasks at risk.
export const FULL_EXPORT_MAX_SPAN_DAYS = 93

export interface FullExportRequest {
  start: string
  end: string
  force: boolean
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const truthy = (v: unknown) => v === true || (typeof v === 'string' && /^(1|true|yes)$/i.test(v.trim()))
const firstStr = (v: unknown): string | null =>
  typeof v === 'string' ? v.trim() : Array.isArray(v) && typeof v[0] === 'string' ? v[0].trim() : null

/** Reads the opt-in flags. `request` is null for an ordinary (daily) import. */
export function parseFullExportRequest(
  params: Record<string, unknown>,
): { request: FullExportRequest | null; error?: undefined } | { request?: undefined; error: string } {
  const on = truthy(firstStr(params.full_export) ?? params.full_export)
  if (!on) return { request: null }
  const start = firstStr(params.window_start) ?? ''
  const end = firstStr(params.window_end) ?? ''
  if (!ISO_DAY.test(start) || !ISO_DAY.test(end) || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) {
    return { error: 'full_export needs window_start and window_end as YYYY-MM-DD' }
  }
  if (start > end) return { error: 'window_start is after window_end' }
  const span = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1
  if (span > FULL_EXPORT_MAX_SPAN_DAYS) {
    return { error: `full_export window is ${span} days; the maximum is ${FULL_EXPORT_MAX_SPAN_DAYS}` }
  }
  return { request: { start, end, force: truthy(firstStr(params.force) ?? params.force) } }
}

/** How many tasks a full export may mark without force. */
export function disappearanceLimit(windowCount: number): number {
  return Math.min(DISAPPEAR_MAX_COUNT, Math.floor(windowCount * DISAPPEAR_MAX_SHARE))
}

export interface WindowTask {
  external_id: string
  status: string | null
}

export interface DisappearancePlan {
  /** Live (not already cancelled/deleted) tasks due in the window. */
  windowCount: number
  limit: number
  toMark: WindowTask[]
  /** True when toMark exceeds the limit and force was not given. */
  refused: boolean
}

const alreadyGone = (status: string | null) => status === DISAPPEARED_STATUS || /cancel|delet/i.test(status ?? '')

/** Which window tasks a full export proves gone. Pure. */
export function planDisappearances(
  existing: ReadonlyArray<WindowTask>,
  presentIds: ReadonlySet<string>,
  force: boolean,
): DisappearancePlan {
  const live = existing.filter(t => !alreadyGone(t.status))
  const toMark = live.filter(t => !presentIds.has(t.external_id))
  const limit = disappearanceLimit(live.length)
  return { windowCount: live.length, limit, toMark, refused: !force && toMark.length > limit }
}

/** Rows of this CSV due inside the window. Zero means the file is not a
 *  full export of that window at all, whatever the caller says. */
export function countRowsInWindow(rows: ReadonlyArray<{ due_date: string | null }>, start: string, end: string): number {
  return rows.filter(r => r.due_date != null && r.due_date >= start && r.due_date <= end).length
}

/** PostgREST / Postgres "that table or column doesn't exist": the migration
 *  adding the disappearance columns hasn't been applied yet. */
export function isMissingSchemaError(err: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!err) return false
  if (['42P01', '42703', 'PGRST204', 'PGRST205'].includes(err.code ?? '')) return true
  return /does not exist|could not find the .* column/i.test(err.message ?? '')
}

async function loadWindowTasks(
  supabase: SupabaseClient,
  start: string,
  end: string,
): Promise<{ rows: WindowTask[]; error: { code?: string; message: string } | null }> {
  const rows: WindowTask[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    // disappeared_at is selected only to prove the migration is applied
    // before anything is written.
    const { data, error } = await supabase
      .from('breezeway_tasks')
      .select('external_id, status, disappeared_at')
      .gte('due_date', start)
      .lte('due_date', end)
      .order('external_id')
      .range(from, from + PAGE - 1)
    if (error) return { rows, error }
    const page = (data ?? []) as WindowTask[]
    rows.push(...page.map(r => ({ external_id: r.external_id, status: r.status })))
    if (page.length < PAGE) return { rows, error: null }
    if (rows.length >= 100 * PAGE) return { rows, error: { message: 'window holds over 100k tasks; refusing' } }
  }
}

/** Marks the planned rows, grouped by their current status so the previous
 *  status is kept, and only while that status is still what we read (a row
 *  touched in between is left alone). Returns the number marked. */
async function markDisappeared(
  supabase: SupabaseClient,
  toMark: ReadonlyArray<WindowTask>,
  batch: string,
): Promise<number> {
  const now = new Date().toISOString()
  const byStatus = new Map<string | null, string[]>()
  for (const t of toMark) {
    const arr = byStatus.get(t.status)
    if (arr) arr.push(t.external_id)
    else byStatus.set(t.status, [t.external_id])
  }
  let marked = 0
  for (const [prev, ids] of byStatus) {
    for (let i = 0; i < ids.length; i += 200) {
      let q = supabase
        .from('breezeway_tasks')
        .update({ status: DISAPPEARED_STATUS, disappeared_at: now, disappeared_prev_status: prev, disappeared_batch: batch })
        .in('external_id', ids.slice(i, i + 200))
      q = prev == null ? q.is('status', null) : q.eq('status', prev)
      const { data, error } = await q.select('id')
      if (error) throw new Error(error.message)
      marked += data?.length ?? 0
    }
  }
  return marked
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const expectedKey = process.env.BREEZEWAY_IMPORT_KEY?.trim()
  if (!expectedKey) {
    res.status(503).json({ error: 'BREEZEWAY_IMPORT_KEY not configured on server' })
    return
  }
  const presentedKey = (req.headers['x-tendwell-import-key'] as string | undefined)?.trim()
  // Constant-time comparison: hash both sides to a fixed 32-byte digest first so
  // neither the key contents nor its length leak through comparison timing.
  const expectedDigest = createHash('sha256').update(expectedKey).digest()
  const presentedDigest = createHash('sha256').update(presentedKey ?? '').digest()
  if (!presentedKey || !timingSafeEqual(presentedDigest, expectedDigest)) {
    res.status(401).json({ error: 'Invalid or missing x-tendwell-import-key' })
    return
  }

  const supabase = getServiceClient()
  if (!supabase) {
    res.status(503).json({ error: 'Supabase service role not configured' })
    return
  }

  const sourceParam = typeof req.query.source === 'string' ? req.query.source.trim().toLowerCase() : ''
  const sourceLabel = sourceParam === 'current_month' || sourceParam === 'next_month' ? sourceParam : null

  // Opt-in only: without full_export nothing below marks a single row.
  const bodyParams = req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? (req.body as Record<string, unknown>) : {}
  const fullParsed = parseFullExportRequest({ ...bodyParams, ...(req.query as Record<string, unknown>) })
  if (fullParsed.error != null) {
    res.status(400).json({ error: fullParsed.error })
    return
  }
  const fullReq = fullParsed.request

  // Body shape options the agent may send:
  //   Content-Type: text/csv         → @vercel/node leaves req.body undefined,
  //                                     so we drain the raw request stream
  //   Content-Type: application/json → req.body is parsed; we expect { csv }
  //   Content-Type: text/plain       → req.body may be a string
  //   Buffer body (rare)             → toString('utf8')
  let csvText: string
  if (typeof req.body === 'string') {
    csvText = req.body
  } else if (req.body && typeof req.body === 'object' && typeof (req.body as any).csv === 'string') {
    csvText = (req.body as any).csv
  } else if (Buffer.isBuffer(req.body)) {
    csvText = (req.body as Buffer).toString('utf8')
  } else {
    // No parsed body — drain the request stream ourselves. This is the
    // path the agent runbook expects for Content-Type: text/csv.
    try {
      csvText = await readRawBody(req)
    } catch (e) {
      res.status(400).json({ error: 'Failed to read request body', detail: e instanceof Error ? e.message : String(e) })
      return
    }
  }
  // Strip optional UTF-8 BOM that Breezeway emits on CSV exports.
  if (csvText.charCodeAt(0) === 0xfeff) csvText = csvText.slice(1)
  if (!csvText || csvText.trim().length === 0) {
    res.status(400).json({ error: 'Empty CSV body' })
    return
  }

  const parsed = Papa.parse<BreezewayRow>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: h => h.trim(),
  })
  if (parsed.errors.length > 0) {
    const headerErrors = parsed.errors.filter(e => e.row == null)
    if (headerErrors.length > 0) {
      res.status(400).json({ error: 'CSV header parse error', detail: headerErrors[0].message })
      return
    }
  }

  // Load manual resolutions (admin-matched property_raw → property_id) so that
  // previously resolved orphans are durably matched on every re-import, even
  // when the automatic name/address matcher can't find them.
  const resolutionMap = new Map<string, number>()
  {
    const { data: resRows } = await supabase
      .from('breezeway_property_resolutions')
      .select('property_raw, property_id')
      .eq('status', 'matched')
      .not('property_id', 'is', null)
    for (const row of (resRows ?? []) as Array<{ property_raw: string; property_id: number }>) {
      resolutionMap.set(row.property_raw, row.property_id)
    }
  }

  // Load admin-dismissed orphans (status='ignored') so they stop counting toward
  // the "unmatched address(es)" banner. These are property_raw strings an admin
  // intentionally marked as non-Ops properties; without this they'd be re-counted
  // as unmatched on every import (matching still can't resolve them), so the
  // banner would never clear after dismissal.
  const ignoredRaws = new Set<string>()
  {
    const { data: ignRows } = await supabase
      .from('breezeway_property_resolutions')
      .select('property_raw')
      .eq('status', 'ignored')
    for (const row of (ignRows ?? []) as Array<{ property_raw: string }>) {
      ignoredRaws.add(row.property_raw)
    }
  }

  const matcher = await buildPropertyMatcher(supabase)

  const batch = randomUUID()
  const rows: UpsertRow[] = []
  const unmatchedAddrs = new Set<string>()
  const seenIds = new Set<string>()

  for (const r of parsed.data) {
    const taskTitle = trimOrNull(r['Task title'])
    if (!taskTitle) continue
    const propertyRaw = trimOrNull(r['Property'])
    const propertyAddress = extractAddress(propertyRaw)
    const dueDate = normalizeDate(r['Due date'])
    const createdDate = normalizeDate(r['Created date'])

    const idSeed = `${createdDate ?? ''}|${propertyRaw ?? ''}|${taskTitle}|${dueDate ?? ''}`
    const externalId = sha256Hex(idSeed)
    if (seenIds.has(externalId)) continue
    seenIds.add(externalId)

    // Resolution map (admin-curated) takes priority over automatic matching.
    // Falls back to name-match (more reliable) then address-match.
    const nickname = extractPropertyNickname(propertyRaw)
    const propertyId = (propertyRaw != null ? resolutionMap.get(propertyRaw) ?? null : null)
      ?? matcher.byName(nickname)
      ?? matcher.byAddress(propertyAddress)
    const isIgnored = propertyRaw != null && ignoredRaws.has(propertyRaw)
    if (propertyId == null && propertyAddress && !isIgnored) unmatchedAddrs.add(propertyAddress)

    rows.push({
      external_id: externalId,
      task_title: taskTitle,
      property_raw: propertyRaw,
      property_address: propertyAddress,
      property_id: propertyId,
      department: trimOrNull(r['Department']),
      assignees: trimOrNull(r['Assignees']),
      due_date: dueDate,
      status: trimOrNull(r['Status']),
      priority: trimOrNull(r['Priority']),
      completed_date: normalizeDate(r['Completed date']),
      completed_by: trimOrNull(r['Completed by']),
      created_date: createdDate,
      last_updated_date: normalizeDate(r['Last updated date']),
      is_clean: isCleanTask(taskTitle),
      is_deep_clean: isDeepCleanTask(taskTitle),
      source_label: sourceLabel,
      import_batch: batch,
      raw: r as unknown as Record<string, unknown>,
    })
  }

  if (rows.length === 0) {
    res.status(400).json({ error: 'No valid rows parsed from CSV' })
    return
  }

  // Full-export mode: decide what disappeared BEFORE writing anything, so a
  // refusal leaves the table exactly as it was.
  let disappearancePlan: DisappearancePlan | null = null
  let fullExportSkipped: string | null = null
  if (fullReq) {
    if (countRowsInWindow(rows, fullReq.start, fullReq.end) === 0) {
      res.status(400).json({ error: `full_export: no row in this CSV is due between ${fullReq.start} and ${fullReq.end}, so it is not a full export of that window` })
      return
    }
    const { rows: existing, error: winErr } = await loadWindowTasks(supabase, fullReq.start, fullReq.end)
    if (winErr && isMissingSchemaError(winErr)) {
      // Migration 20261009e not applied yet: import as an ordinary file.
      fullExportSkipped = 'migration_not_applied'
    } else if (winErr) {
      res.status(500).json({ error: 'full_export: failed to read the window', detail: winErr.message })
      return
    } else {
      disappearancePlan = planDisappearances(existing, seenIds, fullReq.force)
      if (disappearancePlan.refused) {
        res.status(409).json({
          error: `full_export would mark ${disappearancePlan.toMark.length} of ${disappearancePlan.windowCount} tasks due ${fullReq.start}..${fullReq.end} as deleted_or_canceled, over the safety limit of ${disappearancePlan.limit}. Check the window and the export; re-run with force=true only if they really were removed in Breezeway. Nothing was written.`,
          window_start: fullReq.start,
          window_end: fullReq.end,
          window_tasks: disappearancePlan.windowCount,
          would_mark: disappearancePlan.toMark.length,
          limit: disappearancePlan.limit,
          sample_external_ids: disappearancePlan.toMark.slice(0, 10).map(t => t.external_id),
        })
        return
      }
    }
  }

  const CHUNK = 500
  let totalUpserted = 0
  let firstError: string | null = null
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const { data, error } = await supabase
      .from('breezeway_tasks')
      .upsert(chunk, { onConflict: 'external_id', ignoreDuplicates: false })
      .select('id')
    if (error) {
      firstError = error.message
      break
    }
    totalUpserted += data?.length ?? 0
  }

  if (firstError) {
    await supabase.from('breezeway_import_log').insert({
      source_label: sourceLabel,
      rows_inserted: 0,
      rows_updated: 0,
      rows_failed: rows.length,
      cleans_in_batch: rows.filter(r => r.is_clean).length,
      deep_cleans_in_batch: rows.filter(r => r.is_deep_clean).length,
      notes: `Upsert failed: ${firstError.slice(0, 500)}`,
    })
    res.status(500).json({ error: 'Failed to upsert breezeway_tasks', detail: firstError })
    return
  }

  // Rows are upserted; now mark the window's missing tasks. A failure here
  // is reported, never fatal: the import itself already landed.
  let markedCount = 0
  let markError: string | null = null
  if (fullReq && disappearancePlan && disappearancePlan.toMark.length > 0) {
    try {
      markedCount = await markDisappeared(supabase, disappearancePlan.toMark, batch)
    } catch (e) {
      markError = e instanceof Error ? e.message : String(e)
    }
  }
  const fullExportNote = fullReq
    ? fullExportSkipped
      ? `full export ${fullReq.start}..${fullReq.end} NOT applied (${fullExportSkipped})`
      : `full export ${fullReq.start}..${fullReq.end}: ${markedCount} of ${disappearancePlan?.toMark.length ?? 0} missing task(s) marked ${DISAPPEARED_STATUS}${fullReq.force ? ' (force)' : ''}${markError ? `; mark failed: ${markError.slice(0, 200)}` : ''}`
    : null

  const cleansInBatch = rows.filter(r => r.is_clean).length
  const deepCleansInBatch = rows.filter(r => r.is_deep_clean).length
  const unmatchedNote = unmatchedAddrs.size > 0
    ? `${unmatchedAddrs.size} unmatched address(es); first: ${[...unmatchedAddrs].slice(0, 3).join(' | ')}`
    : null
  await supabase.from('breezeway_import_log').insert({
    source_label: sourceLabel,
    rows_inserted: totalUpserted,
    rows_updated: 0,
    rows_failed: parsed.data.length - rows.length,
    cleans_in_batch: cleansInBatch,
    deep_cleans_in_batch: deepCleansInBatch,
    notes: [unmatchedNote, fullExportNote].filter(Boolean).join(' · ') || null,
  })

  // Auto-activate pre-Active properties that now have a turn/departure clean.
  // Best-effort: an activation failure must never fail the import itself.
  let autoActivated: Awaited<ReturnType<typeof autoActivateProperties>> = []
  try {
    autoActivated = await autoActivateProperties(supabase)
  } catch (e) {
    console.error('auto-activate failed (import succeeded):', e)
  }

  res.status(200).json({
    ok: true,
    batch,
    source: sourceLabel,
    rows_seen: parsed.data.length,
    rows_upserted: totalUpserted,
    rows_skipped: parsed.data.length - rows.length,
    cleans_in_batch: cleansInBatch,
    deep_cleans_in_batch: deepCleansInBatch,
    unmatched_addresses_count: unmatchedAddrs.size,
    sample_unmatched_addresses: [...unmatchedAddrs].slice(0, 5),
    auto_activated: autoActivated.map(a => a.name),
    ...(fullReq
      ? {
          full_export: {
            window_start: fullReq.start,
            window_end: fullReq.end,
            applied: fullExportSkipped == null && markError == null,
            skipped_reason: fullExportSkipped,
            window_tasks: disappearancePlan?.windowCount ?? null,
            missing: disappearancePlan?.toMark.length ?? null,
            marked: markedCount,
            limit: disappearancePlan?.limit ?? null,
            forced: fullReq.force,
            error: markError,
          },
        }
      : {}),
  })
}
