import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import Papa from 'papaparse'

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
//                    sample_unmatched_addresses }

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

interface PropertyMatcher {
  byName: (nickname: string | null) => number | null
  byAddress: (addr: string | null) => number | null
}

async function buildPropertyMatcher(supabase: SupabaseClient): Promise<PropertyMatcher> {
  const { data, error } = await supabase.from('properties').select('id, name, address')
  if (error || !data) return { byName: () => null, byAddress: () => null }
  const byNameIdx = new Map<string, number>()
  const byAddrIdx = new Map<string, number>()
  for (const p of data as Array<{ id: number; name: string | null; address: string | null }>) {
    if (p.name) {
      const k = p.name.trim().toLowerCase()
      if (k && !byNameIdx.has(k)) byNameIdx.set(k, p.id)
    }
    if (p.address) {
      const norm = normalizeAddress(p.address)
      if (norm && !byAddrIdx.has(norm)) byAddrIdx.set(norm, p.id)
    }
  }
  return {
    byName: (nickname) => {
      if (!nickname) return null
      const k = nickname.trim().toLowerCase()
      return byNameIdx.get(k) ?? null
    },
    byAddress: (addr) => {
      const needle = normalizeAddress(addr)
      if (!needle) return null
      if (byAddrIdx.has(needle)) return byAddrIdx.get(needle)!
      for (const [stored, id] of byAddrIdx.entries()) {
        if (stored.includes(needle) || needle.includes(stored)) return id
      }
      return null
    },
  }
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

  const cleansInBatch = rows.filter(r => r.is_clean).length
  const deepCleansInBatch = rows.filter(r => r.is_deep_clean).length
  await supabase.from('breezeway_import_log').insert({
    source_label: sourceLabel,
    rows_inserted: totalUpserted,
    rows_updated: 0,
    rows_failed: parsed.data.length - rows.length,
    cleans_in_batch: cleansInBatch,
    deep_cleans_in_batch: deepCleansInBatch,
    notes: unmatchedAddrs.size > 0
      ? `${unmatchedAddrs.size} unmatched address(es); first: ${[...unmatchedAddrs].slice(0, 3).join(' | ')}`
      : null,
  })

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
  })
}
