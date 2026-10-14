// Pure rules for the Trellis → Ops sync (2026-10-14, Trellis API expansion WS1).
//
// Everything here runs at sync time in the serverless functions AND is unit
// tested, so the SQL views can filter on plain stored columns instead of
// re-implementing the title regexes:
//   - task classification   → trellis_task_snapshot.clean_kind / is_tendwell / task_category
//   - roster deactivation   → trellis_roster.missed_runs / removed_at / is_active
//   - cleaner linking       → cleaners.trellis_user_id / status
//   - review row mapping    → trellis_review_snapshot
//   - clean attribution     → TS mirror of the SQL lateral joins (review / inspection)
//
// Keep this file dependency-free apart from aux-tasks (client + NodeNext).

import { classifyAuxTask, isTendwellTask, type AuxCategory } from './aux-tasks.js'

// ─── Task classification ───────────────────────────────────────────────────

/** Sub-kind of a scheduled clean. NULL (not a clean) for everything else,
 *  including vacancy cleans and touch-ups (not cleans, matching invoicing). */
export type CleanKind =
  | 'turn' | 'departure' | 'deep' | 'onboarding' | 'last' | 'arrival' | 'double' | 'owner_stay' | 'clean'

export const CLEAN_KINDS: readonly CleanKind[] = [
  'turn', 'departure', 'deep', 'onboarding', 'last', 'arrival', 'double', 'owner_stay', 'clean',
]

// "Cleaning Inspection", "Turn Cleaning Inspection", "Inspect …". The aux
// classifier calls "Turn Cleaning Inspection" a clean (its clean regex sees
// "Turn Clean"), and invoicing already learned that a title containing
// inspection is never a clean (2026-10-08), so inspections are decided first.
const INSPECTION_RE = /\bin?spection\b|\binspect\b/i
const SELF_INSPECTION_RE = /self.?in?spection/i
const WALKTHROUGH_RE = /walk\s*-?\s*through/i

/** A Trellis task that rates a previous clean (not a cleaner's self-check,
 *  not an onboarding / owner walkthrough). */
export function isInspectionTitle(title: string | null | undefined): boolean {
  const t = (title ?? '').trim()
  if (!t) return false
  return INSPECTION_RE.test(t) && !SELF_INSPECTION_RE.test(t) && !WALKTHROUGH_RE.test(t)
}

/** classifyAuxTask, except a rating inspection is always 'inspection'. Stored
 *  as trellis_task_snapshot.task_category. */
export function trellisTaskCategory(title: string | null | undefined): AuxCategory {
  if (isInspectionTitle(title)) return 'inspection'
  return classifyAuxTask(title)
}

export function cleanKindForTitle(title: string | null | undefined): CleanKind | null {
  const t = (title ?? '').trim()
  if (!t) return null
  if (INSPECTION_RE.test(t) || WALKTHROUGH_RE.test(t)) return null
  if (classifyAuxTask(t) !== 'clean') return null
  if (/\bdeep\b/i.test(t)) return 'deep'
  if (/onboarding|htlr/i.test(t)) return 'onboarding'
  if (/\bdouble\b/i.test(t)) return 'double'
  if (/owner/i.test(t)) return 'owner_stay'
  if (/\blast\b/i.test(t)) return 'last'
  if (/\bturn\b|same\s*day\s*turn/i.test(t)) return 'turn'
  if (/departure/i.test(t)) return 'departure'
  if (/arrival|pre.?check.?in|early\s*check.?in/i.test(t)) return 'arrival'
  return 'clean'
}

export interface TrellisTaskLike {
  workspace: string
  title?: unknown
  assigned_to_id?: unknown
  assigned_to_name?: unknown
  assignees?: unknown
}

export interface TaskClassification {
  clean_kind: CleanKind | null
  is_tendwell: boolean
  task_category: AuxCategory
}

/** Columns written on every task upsert. `tendwellMemberIds` = every
 *  workspace-A roster user id (same set invoicing passes isTendwellTask). */
export function classifyTrellisTask(t: TrellisTaskLike, tendwellMemberIds: ReadonlySet<string>): TaskClassification {
  const title = typeof t.title === 'string' ? t.title : null
  return {
    clean_kind: cleanKindForTitle(title),
    task_category: trellisTaskCategory(title),
    is_tendwell: isTendwellTask({
      source: 'trellis',
      workspace: t.workspace,
      assignedToId: typeof t.assigned_to_id === 'string' ? t.assigned_to_id : null,
      assignedToName: typeof t.assigned_to_name === 'string' ? t.assigned_to_name : null,
      assignees: t.assignees,
    }, tendwellMemberIds),
  }
}

// ─── Roster deactivation ───────────────────────────────────────────────────
//
// The nightly sync used to upsert whoever came back and never deactivate
// anyone, so trellis_roster grew to 61 rows against 44 live members. Rules
// (plan review, 2026-10-14): only after a COMPLETE workforce pull (pagination
// exhausted, count == total); only after a member is missed on 2 consecutive
// complete pulls; never more than ~10% of active members in one run (a bad
// Trellis response must not wipe the roster). Rows are never deleted.

export const ROSTER_MISSES_BEFORE_REMOVAL = 2
export const ROSTER_MAX_REMOVAL_FRACTION = 0.1

export interface RosterRowState {
  user_id: string
  is_active: boolean
  missed_runs: number | null
  last_seen_at?: string | null
}

export interface RosterPlan {
  /** Members not seen this pull: new missed_runs value (still active). */
  missed: Array<{ user_id: string; missed_runs: number }>
  /** Members to set is_active=false, removed_at=now. */
  deactivate: string[]
  /** Eligible for deactivation but held back by the per-run cap. */
  deferred: string[]
}

export function planRosterDeactivation(
  existing: ReadonlyArray<RosterRowState>,
  seenIds: ReadonlySet<string>,
  pullComplete: boolean,
  opts: { missesBeforeRemoval?: number; maxFraction?: number } = {},
): RosterPlan {
  const plan: RosterPlan = { missed: [], deactivate: [], deferred: [] }
  if (!pullComplete) return plan
  const misses = opts.missesBeforeRemoval ?? ROSTER_MISSES_BEFORE_REMOVAL
  const fraction = opts.maxFraction ?? ROSTER_MAX_REMOVAL_FRACTION
  const active = existing.filter(r => r.is_active)
  const cap = Math.max(1, Math.floor(active.length * fraction))
  const candidates: Array<{ user_id: string; missed_runs: number; last_seen_at: string }> = []
  for (const r of active) {
    if (seenIds.has(r.user_id)) continue
    const missed = (r.missed_runs ?? 0) + 1
    if (missed >= misses) candidates.push({ user_id: r.user_id, missed_runs: missed, last_seen_at: r.last_seen_at ?? '' })
    else plan.missed.push({ user_id: r.user_id, missed_runs: missed })
  }
  // Longest-missing first (then least recently seen), so the cap drains the
  // oldest ghosts first.
  candidates.sort((a, b) => b.missed_runs - a.missed_runs || a.last_seen_at.localeCompare(b.last_seen_at) || a.user_id.localeCompare(b.user_id))
  for (const { last_seen_at: _seen, ...c } of candidates) {
    if (plan.deactivate.length < cap) plan.deactivate.push(c.user_id)
    else {
      plan.deferred.push(c.user_id)
      plan.missed.push(c)
    }
  }
  return plan
}

/** Whether a workforce pull saw everyone: pagination exhausted and the rows
 *  received match the total Trellis reported (when it reports one). */
export function workforcePullComplete(received: number, reportedTotal: number | null, exhausted: boolean): boolean {
  if (!exhausted || received === 0) return false
  return reportedTotal == null || received >= reportedTotal
}

// ─── Cleaner sync ──────────────────────────────────────────────────────────

export const TRELLIS_NIL_USER = '00000000-0000-0000-0000-000000000000'
export const CLEANER_DEPARTMENTS = ['cleaning', 'quality control', 'inspection']
export const SYNC_OFFBOARDED_BY = 'trellis-sync'

export interface RosterMember {
  user_id: string
  name: string | null
  email: string | null
  role: string | null
  departments: string[] | null
  is_active: boolean
  /** Last time a complete-or-not workforce pull returned this member. */
  last_seen_at?: string | null
}

/** Auto-create only members seen by a pull this recently (ghost rows that
 *  are still waiting out the deactivation cap must not become cleaners). */
export const CREATE_SEEN_WITHIN_DAYS = 3

export interface CleanerRow {
  id: string
  full_name: string
  email: string | null
  alt_email: string | null
  trellis_user_id: string | null
  status: string | null
  offboarded_by: string | null
}

export function normalizeEmail(e: string | null | undefined): string | null {
  const v = (e ?? '').trim().toLowerCase()
  return v && v.includes('@') ? v : null
}

export function normalizePersonName(n: string | null | undefined): string {
  return (n ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** Why a roster member must never become (or be matched by name to) a cleaner. */
export function rosterExclusionReason(m: RosterMember): string | null {
  if (m.user_id === TRELLIS_NIL_USER || /^ai agent$/i.test((m.name ?? '').trim())) return 'ai_agent'
  if (!m.name || !m.name.trim()) return 'no_name'
  if (m.name.trim().toLowerCase() === 'tendwell cleaning co.') return 'vendor_account'
  const email = normalizeEmail(m.email) ?? ''
  if (/\.test$/.test(email) || /@trellistech\.com$/.test(email) || /\btest\b/i.test(m.name)) return 'test_or_trellis_staff'
  if ((m.role ?? '').toUpperCase() === 'ADMIN') return 'admin'
  const depts = (m.departments ?? []).map(d => d.toLowerCase())
  if (!depts.some(d => CLEANER_DEPARTMENTS.includes(d))) return 'not_cleaning_department'
  return null
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return dp[b.length]
}

/** Two spellings of one person ("Yeimi Munguia" / "Yeymi munguia"): same
 *  normalized name or within 2 edits on a name of 8+ characters. */
export function likelySamePerson(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizePersonName(a)
  const y = normalizePersonName(b)
  if (!x || !y) return false
  if (x === y) return true
  return Math.min(x.length, y.length) >= 8 && editDistance(x, y) <= 2
}

export interface CleanerSyncPlan {
  links: Array<{ cleaner_id: string; user_id: string; via: 'email' | 'name' }>
  creates: Array<{ user_id: string; full_name: string; email: string | null }>
  offboard: string[]
  reactivate: string[]
  skipped: Array<{ user_id?: string; cleaner_id?: string; name: string | null; reason: string }>
}

/**
 * Link existing cleaners to roster members (email / alt_email first, then an
 * exact normalized name that is unique on both sides), optionally create
 * cleaners for unlinked eligible members (gated by app_settings
 * trellis_cleaner_sync_enabled), and offboard / reactivate linked cleaners as
 * their roster row goes inactive / comes back. Reactivation only undoes an
 * offboarding the sync itself did (`offboarded_by = 'trellis-sync'`), never a
 * manual one. A roster user id is never linked twice (unique index).
 */
export function planCleanerSync(
  roster: ReadonlyArray<RosterMember>,
  cleaners: ReadonlyArray<CleanerRow>,
  opts: { autoCreate: boolean; dismissedUserIds?: ReadonlySet<string>; now?: Date },
): CleanerSyncPlan {
  const plan: CleanerSyncPlan = { links: [], creates: [], offboard: [], reactivate: [], skipped: [] }
  const byUser = new Map(roster.map(m => [m.user_id, m]))
  const taken = new Set(cleaners.map(c => c.trellis_user_id).filter((v): v is string => !!v))
  const linkedCleaners = new Set(cleaners.filter(c => c.trellis_user_id).map(c => c.id))

  // Email matches: any roster row except the AI agent / vendor / nameless.
  const emailIndex = new Map<string, RosterMember[]>()
  for (const m of roster) {
    const reason = rosterExclusionReason(m)
    if (reason === 'ai_agent' || reason === 'vendor_account' || reason === 'no_name') continue
    const e = normalizeEmail(m.email)
    if (!e) continue
    emailIndex.set(e, [...(emailIndex.get(e) ?? []), m])
  }
  const link = (c: CleanerRow, m: RosterMember, via: 'email' | 'name') => {
    plan.links.push({ cleaner_id: c.id, user_id: m.user_id, via })
    taken.add(m.user_id)
    linkedCleaners.add(c.id)
  }
  for (const c of cleaners) {
    if (c.trellis_user_id) continue
    const emails = [normalizeEmail(c.email), normalizeEmail(c.alt_email)].filter((e): e is string => !!e)
    const hits = Array.from(new Set(emails.flatMap(e => emailIndex.get(e) ?? [])))
    if (hits.length === 0) continue
    const free = hits.filter(m => !taken.has(m.user_id))
    if (free.length === 1) link(c, free[0], 'email')
    else if (free.length > 1) plan.skipped.push({ cleaner_id: c.id, name: c.full_name, reason: 'email_matches_several_members' })
    else plan.skipped.push({ cleaner_id: c.id, name: c.full_name, reason: 'email_member_already_linked' })
  }
  // Exact normalized name, unique on both sides, eligible members only.
  const eligible = roster.filter(m => rosterExclusionReason(m) == null)
  for (const c of cleaners) {
    if (linkedCleaners.has(c.id)) continue
    const n = normalizePersonName(c.full_name)
    if (!n) continue
    const hits = eligible.filter(m => normalizePersonName(m.name) === n)
    const sameNameCleaners = cleaners.filter(o => normalizePersonName(o.full_name) === n)
    if (hits.length !== 1 || sameNameCleaners.length !== 1) {
      if (hits.length > 0) plan.skipped.push({ cleaner_id: c.id, name: c.full_name, reason: 'name_not_unique' })
      continue
    }
    if (taken.has(hits[0].user_id)) {
      plan.skipped.push({ cleaner_id: c.id, user_id: hits[0].user_id, name: c.full_name, reason: 'name_member_already_linked' })
      continue
    }
    link(c, hits[0], 'name')
  }

  // Create cleaners for unlinked, active, eligible members (gated).
  if (opts.autoCreate) {
    const seenCutoff = (opts.now ?? new Date()).getTime() - CREATE_SEEN_WITHIN_DAYS * 86_400_000
    const unlinked = eligible.filter(m => m.is_active && !taken.has(m.user_id))
    for (const m of unlinked) {
      const seen = m.last_seen_at ? Date.parse(m.last_seen_at) : NaN
      if (!(seen >= seenCutoff)) { plan.skipped.push({ user_id: m.user_id, name: m.name, reason: 'not_seen_recently' }); continue }
      if (opts.dismissedUserIds?.has(m.user_id)) { plan.skipped.push({ user_id: m.user_id, name: m.name, reason: 'dismissed' }); continue }
      const dupMember = eligible.some(o => o.user_id !== m.user_id && likelySamePerson(o.name, m.name))
      if (dupMember) { plan.skipped.push({ user_id: m.user_id, name: m.name, reason: 'possible_duplicate_member' }); continue }
      const dupCleaner = cleaners.some(c => likelySamePerson(c.full_name, m.name))
      if (dupCleaner) { plan.skipped.push({ user_id: m.user_id, name: m.name, reason: 'similar_cleaner_exists' }); continue }
      plan.creates.push({ user_id: m.user_id, full_name: m.name!.trim(), email: normalizeEmail(m.email) })
    }
  }

  // Offboard / reactivate by roster state (linked before or in this plan).
  const finalLinks = new Map<string, string>()
  for (const c of cleaners) if (c.trellis_user_id) finalLinks.set(c.id, c.trellis_user_id)
  for (const l of plan.links) finalLinks.set(l.cleaner_id, l.user_id)
  for (const c of cleaners) {
    const uid = finalLinks.get(c.id)
    if (!uid) continue
    const m = byUser.get(uid)
    if (!m) continue
    const status = c.status ?? 'active'
    if (!m.is_active && status === 'active') plan.offboard.push(c.id)
    else if (m.is_active && status === 'offboarded' && c.offboarded_by === SYNC_OFFBOARDED_BY) plan.reactivate.push(c.id)
  }
  return plan
}

// ─── Reviews ───────────────────────────────────────────────────────────────

export interface TrellisReview {
  id?: unknown
  overall_rating?: unknown
  max_rating?: unknown
  normalized_rating?: unknown
  content?: unknown
  title?: unknown
  host_response?: unknown
  source?: unknown
  reviewer_name?: unknown
  review_date?: unknown
  property_id?: unknown
  property_name?: unknown
  category_ratings?: unknown
  reservation_id?: unknown
  reservation?: unknown
}

const numOrNull = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const dateOrNull = (v: unknown): string | null => {
  const s = strOrNull(v)
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null
}

/**
 * Map a read_reviews row to trellis_review_snapshot. Ratings are stored on
 * the review's own scale (`max_rating`, 5 for every channel Trellis returns
 * today, Booking.com included); `normalized_rating` is Trellis's 0..1 value
 * (overall / max), and the table derives `cleanliness_5` = cleanliness on a
 * 0..5 scale. No money: the reservation's amounts are never stored.
 */
export function reviewRow(r: TrellisReview, workspace: 'A' | 'B', syncedAt: string): Record<string, unknown> | null {
  const id = strOrNull(r.id)
  if (!id) return null
  const overall = numOrNull(r.overall_rating)
  const max = numOrNull(r.max_rating)
  const cats = r.category_ratings && typeof r.category_ratings === 'object' && !Array.isArray(r.category_ratings)
    ? r.category_ratings as Record<string, unknown> : null
  let normalized = numOrNull(r.normalized_rating)
  if (normalized == null && overall != null && max != null && max > 0) normalized = Math.round((overall / max) * 1000) / 1000
  const res = r.reservation && typeof r.reservation === 'object' ? r.reservation as Record<string, unknown> : null
  return {
    trellis_review_id: id,
    workspace,
    trellis_property_id: strOrNull(r.property_id),
    property_name: strOrNull(r.property_name),
    reservation_id: strOrNull(r.reservation_id),
    checkin_date: res ? dateOrNull(res.checkin_date) : null,
    checkout_date: res ? dateOrNull(res.checkout_date) : null,
    guest_name: res ? strOrNull(res.guest_name) : null,
    reviewer_name: strOrNull(r.reviewer_name),
    overall_rating: overall,
    max_rating: max,
    normalized_rating: normalized,
    cleanliness_rating: cats ? numOrNull(cats.cleanliness) : null,
    category_ratings: cats,
    content: strOrNull(r.content),
    title: strOrNull(r.title),
    source: strOrNull(r.source),
    review_date: strOrNull(r.review_date),
    host_response_status: r.host_response == null || r.host_response === '' ? 'none' : 'responded',
    synced_at: syncedAt,
  }
}

// ─── Attribution (TS mirror of the SQL in 20261014c / 20261014d) ───────────

export const ATTRIBUTION_WINDOW_DAYS = 14

export interface CompletedClean {
  trellis_task_id: string
  trellis_property_id: string
  scheduled_date: string // YYYY-MM-DD
  completed_at?: string | null
  is_tendwell: boolean
}

function dayNumber(d: string): number {
  return Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000
}

/**
 * The clean a review or inspection rates: the last completed clean BY ANYONE
 * at the property on or before `anchor` (a review's check-in date, an
 * inspection's inspected_at ?? scheduled_for) and no more than 14 days
 * before it. Ties on the same day go to the latest completed_at. Whether
 * Tendwell / a cleaner gets credit is the caller's business (is_tendwell).
 */
export function pickRatedClean<T extends CompletedClean>(
  cleans: ReadonlyArray<T>,
  trellisPropertyId: string,
  anchor: string | null,
  windowDays = ATTRIBUTION_WINDOW_DAYS,
): T | null {
  if (!anchor) return null
  const a = dayNumber(anchor)
  let best: T | null = null
  for (const c of cleans) {
    if (c.trellis_property_id !== trellisPropertyId) continue
    const d = dayNumber(c.scheduled_date)
    if (d > a || d < a - windowDays) continue
    if (!best) { best = c; continue }
    const bd = dayNumber(best.scheduled_date)
    if (d > bd || (d === bd && (c.completed_at ?? '') > (best.completed_at ?? ''))) best = c
  }
  return best
}
