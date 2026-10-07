/**
 * Pure logic behind the admin onboarding hub (`/onboarding-queue`): turning an
 * `onboarding_submissions` row into property writes, deciding what the client
 * told us that has no home on the property, and grading how ready an
 * Onboarding-stage property is to go Active.
 *
 * Kept free of React and Supabase so every rule is unit-tested. The one rule
 * that matters most: NOTHING a client typed may be silently dropped. Anything
 * that does not map onto a `properties` column is surfaced to the admin
 * (`submissionExtras`) and preserved in a property note (`buildOnboardingNote`).
 */

export const ONBOARDING_STAGE_ID = 3
export const ACTIVE_STAGE_ID = 4

// ─── Submission row ─────────────────────────────────────────────────────────

export interface OnboardingSubmission {
  id: string
  source: 'token' | 'public' | 'owner'
  status: 'pending' | 'approved' | 'rejected' | 'converted'
  token: string | null
  client_name: string | null
  contact_email: string | null
  contact_phone: string | null
  invoice_email: string | null
  property_name: string | null
  address: string | null
  bedrooms: number | null
  number_of_beds: number | null
  full_baths: number | null
  half_baths: number | null
  square_footage: number | null
  bed_sizes: string | null
  guest_count: number | null
  kitchens: number | null
  pet_friendly: string | null
  hot_tub: boolean | null
  pool: boolean | null
  linen_program: boolean | null
  onboarding_deep_clean: boolean | null
  door_code: string | null
  auto_code: string | null
  other_codes: string | null
  wifi_info: string | null
  filter_size: string | null
  ical_url: string | null
  api_client_id: string | null
  api_key: string | null
  check_in_time: string | null
  check_out_time: string | null
  notes: string | null
  photos: string[]
  submitted_at: string
  approved_at: string | null
  approved_by: string | null
  property_id: number | null
  owner_id: string | null
}

// ─── Small value helpers ────────────────────────────────────────────────────

export const isBlank = (v: unknown): boolean =>
  v == null || (typeof v === 'string' && v.trim() === '')

export const normalizeEmail = (v: string | null | undefined): string | null => {
  const e = (v ?? '').trim().toLowerCase()
  return e === '' ? null : e
}

/** `webcal://` is how calendar apps label an iCal feed; it is plain https underneath. */
export function normalizeUrlInput(v: string | null | undefined): string {
  const s = (v ?? '').trim()
  return s.replace(/^webcal:\/\//i, 'https://')
}

/** True for a full http(s) URL with a dotted host. Blank is NOT valid here; callers decide if blank is allowed. */
export function isHttpUrl(v: string | null | undefined): boolean {
  const s = (v ?? '').trim()
  if (!/^https?:\/\//i.test(s)) return false
  try {
    const u = new URL(s)
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.')
  } catch {
    return false
  }
}

const URL_RE = /(?:https?|webcal):\/\/[^\s<>"'`]+/gi

/**
 * Calendar-feed links hiding in free text. Clients paste their Airbnb / VRBO /
 * Guesty iCal links into the Notes box when the iCal field only fits one (real
 * case: Michael Baradell's VRBO link, 2026-09). A link counts when it contains
 * "ical" (icalendar, /ical/) or ".ics". Trailing punctuation from a sentence is
 * trimmed; duplicates are removed; `webcal://` is normalised to https.
 */
export function extractIcalUrls(text: string | null | undefined): string[] {
  if (!text) return []
  const out: string[] = []
  const re = new RegExp(URL_RE.source, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const url = normalizeUrlInput(m[0].replace(/[)\].,;:!?]+$/, ''))
    if (/ical|\.ics/i.test(url) && !out.includes(url)) out.push(url)
  }
  return out
}

// ─── Field map: submission column -> properties column ─────────────────────

export type FieldType = 'text' | 'number' | 'bool'
export interface FieldDef {
  key: string // submission column
  prop: string // properties column
  /** Full i18n key (so fields can live in different dictionary namespaces). */
  labelKey: string
  type: FieldType
  /** Only validated as an http(s) URL. */
  url?: boolean
  /** Columns only the old token form collected; shown when they carry information. */
  legacy?: boolean
}

const L = (k: string) => `onboarding.review.fields.${k}`
const A = (k: string) => `onboardingAdmin.fields.${k}`

export const SUBMISSION_FIELDS: FieldDef[] = [
  { key: 'property_name', prop: 'name', labelKey: L('propertyName'), type: 'text' },
  { key: 'address', prop: 'address', labelKey: L('address'), type: 'text' },
  { key: 'bedrooms', prop: 'bedrooms', labelKey: L('bedrooms'), type: 'number' },
  { key: 'number_of_beds', prop: 'number_of_beds', labelKey: L('numberOfBeds'), type: 'number' },
  { key: 'full_baths', prop: 'full_baths', labelKey: L('fullBaths'), type: 'number' },
  { key: 'half_baths', prop: 'half_baths', labelKey: L('halfBaths'), type: 'number' },
  { key: 'square_footage', prop: 'square_footage', labelKey: L('squareFootage'), type: 'number' },
  { key: 'hot_tub', prop: 'hot_tub', labelKey: L('hotTub'), type: 'bool' },
  { key: 'pool', prop: 'pool', labelKey: A('pool'), type: 'bool' },
  { key: 'linen_program', prop: 'linen_program', labelKey: L('linenProgram'), type: 'bool' },
  { key: 'door_code', prop: 'door_code', labelKey: L('frontDoorCode'), type: 'text' },
  { key: 'other_codes', prop: 'other_codes', labelKey: L('otherCodes'), type: 'text' },
  { key: 'wifi_info', prop: 'wifi_info', labelKey: L('wifi'), type: 'text' },
  { key: 'filter_size', prop: 'filter_size', labelKey: L('acFilterSize'), type: 'text' },
  { key: 'check_in_time', prop: 'check_in_time', labelKey: L('checkInTime'), type: 'text' },
  { key: 'check_out_time', prop: 'check_out_time', labelKey: L('checkOutTime'), type: 'text' },
  { key: 'ical_url', prop: 'ical_url', labelKey: A('icalUrl'), type: 'text', url: true },
  { key: 'guest_count', prop: 'guest_count', labelKey: A('guestCount'), type: 'number', legacy: true },
  { key: 'kitchens', prop: 'kitchens', labelKey: A('kitchens'), type: 'number', legacy: true },
  { key: 'pet_friendly', prop: 'pet_friendly', labelKey: A('petFriendly'), type: 'text', legacy: true },
]

/** What a brand-new `properties` row holds for the legacy columns, so a form answer equal to it is not news. */
const LEGACY_COLUMN_DEFAULTS: Record<string, unknown> = { guest_count: 0, kitchens: 1, pet_friendly: 'No' }

function sameValue(a: unknown, b: unknown, type: FieldType): boolean {
  if (isBlank(a) && isBlank(b)) return true
  if (isBlank(a) || isBlank(b)) return false
  if (type === 'bool') return a === b
  if (type === 'number') return Number(a) === Number(b)
  return String(a).trim() === String(b).trim()
}

/**
 * The fields to show in the review dialog. Everything the questionnaire maps
 * onto a column is always listed; the three legacy columns (guest count,
 * kitchens, pet friendly) only appear when the client's answer actually
 * differs from what the property already has (merge) or would default to
 * (create), so a routine submission is not padded with three no-op rows.
 */
export function visibleFields(
  submission: Partial<OnboardingSubmission>,
  existing: Record<string, any> | null,
): FieldDef[] {
  return SUBMISSION_FIELDS.filter(f => {
    if (!f.legacy) return true
    const sub = (submission as Record<string, any>)[f.key]
    if (isBlank(sub)) return false
    const base = existing ? existing[f.prop] : LEGACY_COLUMN_DEFAULTS[f.prop]
    return !sameValue(sub, base, f.type)
  })
}

// ─── Beds ───────────────────────────────────────────────────────────────────

export const BED_COLS = [
  { key: 'king', col: 'king_beds', labelKey: 'king' },
  { key: 'queen', col: 'queen_beds', labelKey: 'queen' },
  { key: 'full', col: 'full_beds', labelKey: 'full' },
  { key: 'twin', col: 'twin_beds', labelKey: 'twin' },
] as const

export type Beds = { king: number; queen: number; full: number; twin: number }

/**
 * Best-effort parse of the free-text bed sizes string into structured counts,
 * as a starting suggestion the admin can correct. Captures an optional leading
 * quantity right before each keyword ("2 Twins" -> 2, "King" -> 1). Room numbers
 * ("Bedroom 3") are ignored because they aren't adjacent to a bed keyword.
 */
export function parseBeds(text: string | null | undefined): Beds {
  const res: Beds = { king: 0, queen: 0, full: 0, twin: 0 }
  if (!text) return res
  const tally = (words: string) => {
    const re = new RegExp(`(?:(\\d+)\\s*)?\\b(?:${words})s?\\b`, 'gi')
    let total = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) total += m[1] ? parseInt(m[1], 10) : 1
    return total
  }
  res.king = tally('king')
  res.queen = tally('queen')
  res.full = tally('full|double')
  res.twin = tally('twin|single')
  return res
}

// ─── Merge into an existing property ───────────────────────────────────────

export type Pick = 'current' | 'submitted'

/** The value the client submitted for a field, unless the admin swapped in another (e.g. an iCal link found in notes). */
export function submittedValue(
  f: FieldDef,
  submission: Partial<OnboardingSubmission>,
  overrides: Record<string, unknown> = {},
): unknown {
  return f.prop in overrides ? overrides[f.prop] : (submission as Record<string, any>)[f.key]
}

/** Default per-field choice: take the submitted value only where the listing has nothing yet. */
export function defaultChoices(
  existing: Record<string, any>,
  submission: Partial<OnboardingSubmission>,
  overrides: Record<string, unknown> = {},
): Record<string, Pick> {
  const next: Record<string, Pick> = {}
  for (const f of SUBMISSION_FIELDS) {
    const sub = submittedValue(f, submission, overrides)
    next[f.prop] = isBlank(existing[f.prop]) && !isBlank(sub) ? 'submitted' : 'current'
  }
  return next
}

/** A smart-lock code on the form implies the property has the auto code installed. */
export function defaultHasAutoCode(
  submission: Partial<OnboardingSubmission>,
  existing?: Record<string, any> | null,
): boolean {
  return !!existing?.has_auto_code || !isBlank(submission.auto_code)
}

/** The columns that would change on `existing` if the admin saves. Pure so the "what gets written" rule is testable. */
export function buildMergePatch(args: {
  submission: Partial<OnboardingSubmission>
  existing: Record<string, any>
  choices: Record<string, Pick>
  beds: Beds
  hasAutoCode: boolean
  overrides?: Record<string, unknown>
}): Record<string, any> {
  const { submission, existing, choices, beds, hasAutoCode, overrides = {} } = args
  const patch: Record<string, any> = {}
  for (const f of SUBMISSION_FIELDS) {
    if (choices[f.prop] !== 'submitted') continue
    let v = submittedValue(f, submission, overrides)
    if (f.url) v = isBlank(v) ? null : normalizeUrlInput(String(v))
    if (!sameValue(v, existing[f.prop], f.type)) patch[f.prop] = isBlank(v) ? null : v
  }
  // Structured beds always come from the admin-entered inputs.
  for (const b of BED_COLS) {
    if ((existing[b.col] ?? 0) !== beds[b.key]) patch[b.col] = beds[b.key]
  }
  if (!isBlank(submission.bed_sizes) && existing.bed_sizes_text !== submission.bed_sizes) {
    patch.bed_sizes_text = submission.bed_sizes
  }
  if ((existing.has_auto_code ?? false) !== hasAutoCode) patch.has_auto_code = hasAutoCode
  return patch
}

// ─── Create a new property ──────────────────────────────────────────────────

export function initialCreateValues(
  submission: Partial<OnboardingSubmission>,
  overrides: Record<string, unknown> = {},
): Record<string, any> {
  const vals: Record<string, any> = {}
  for (const f of SUBMISSION_FIELDS) vals[f.prop] = submittedValue(f, submission, overrides)
  return vals
}

/** The `properties` insert payload. Nulls are stripped so NOT NULL columns (check-in/out time) take their defaults. */
export function buildCreatePayload(args: {
  submission: Partial<OnboardingSubmission>
  values: Record<string, any>
  beds: Beds
  hasAutoCode: boolean
  contactId?: string | null
}): Record<string, any> {
  const { submission, values, beds, hasAutoCode, contactId } = args
  const payload: Record<string, any> = {
    name:
      (values.name || '').toString().trim() ||
      submission.property_name ||
      submission.address ||
      submission.client_name ||
      'New Property',
    stage_id: ONBOARDING_STAGE_ID,
    king_beds: beds.king,
    queen_beds: beds.queen,
    full_beds: beds.full,
    twin_beds: beds.twin,
    bed_sizes_text: submission.bed_sizes ?? null,
    has_auto_code: hasAutoCode,
  }
  for (const f of SUBMISSION_FIELDS) {
    if (f.prop === 'name') continue
    const v = values[f.prop]
    payload[f.prop] = f.url ? (isBlank(v) ? null : normalizeUrlInput(String(v))) : isBlank(v) && f.type === 'text' ? null : v
  }
  if (contactId) payload.contact_id = contactId
  for (const k of Object.keys(payload)) if (payload[k] == null) delete payload[k]
  return payload
}

/** Inline validation for the URL-typed fields. Returns the problem, or null when fine (blank is fine). */
export function urlProblem(v: unknown): 'invalid_url' | null {
  if (isBlank(v)) return null
  return isHttpUrl(normalizeUrlInput(String(v))) ? null : 'invalid_url'
}

// ─── What the form collected that the property has no column for ───────────

export interface ExtraItem {
  id: 'invoice_email' | 'onboarding_deep_clean' | 'auto_code' | 'api_client_id' | 'api_key' | 'pdfs'
  value: string
  /** Masked in the UI until revealed. */
  secret?: boolean
  /** invoice_email only: it matches the contact email, so it is not a different address. */
  sameAsContact?: boolean
}

export const isImagePath = (p: string): boolean => /\.(jpe?g|png|webp|heic|heif|gif)$/i.test(p.split('?')[0])

/**
 * The submitted answers with no `properties` column. The review dialog lists
 * them so the admin sees everything the client filled out, and the property
 * note records the non-secret ones. API credentials are flagged `secret`: they
 * stay on the submission row and are never copied into a note.
 */
export function submissionExtras(sub: Partial<OnboardingSubmission>): ExtraItem[] {
  const out: ExtraItem[] = []
  if (!isBlank(sub.invoice_email)) {
    out.push({
      id: 'invoice_email',
      value: sub.invoice_email!.trim(),
      sameAsContact: normalizeEmail(sub.invoice_email) === normalizeEmail(sub.contact_email),
    })
  }
  if (sub.onboarding_deep_clean != null) {
    out.push({ id: 'onboarding_deep_clean', value: sub.onboarding_deep_clean ? 'yes' : 'no' })
  }
  if (!isBlank(sub.auto_code)) out.push({ id: 'auto_code', value: sub.auto_code!.trim() })
  if (!isBlank(sub.api_client_id)) out.push({ id: 'api_client_id', value: sub.api_client_id!.trim(), secret: true })
  if (!isBlank(sub.api_key)) out.push({ id: 'api_key', value: sub.api_key!.trim(), secret: true })
  const pdfs = (sub.photos ?? []).filter(p => !isImagePath(p))
  if (pdfs.length > 0) out.push({ id: 'pdfs', value: String(pdfs.length) })
  return out
}

// ─── The onboarding property note ───────────────────────────────────────────

const trimAll = (s: string) => s.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '')

/**
 * The staff note written on the property when a submission is applied. Returns
 * null when there is nothing to preserve. `key` is the leading text used to
 * detect that the note already exists (re-applying must not duplicate it); for
 * a submission with notes it is the same "head" the migration backfill writes.
 * The API secret itself is never included, only the fact that one was given.
 */
export function buildOnboardingNote(
  sub: Partial<OnboardingSubmission>,
  urlFor?: (path: string) => string,
): { content: string; key: string } | null {
  const who = trimAll(sub.client_name ?? '') || 'client'
  const notes = trimAll(sub.notes ?? '')
  const lines: string[] = []
  let key: string

  if (notes) {
    key = `Onboarding form notes from ${who}: ${notes}`
    lines.push(key)
  } else {
    const date = sub.submitted_at ? sub.submitted_at.slice(0, 10) : ''
    key = `Onboarding form details from ${who}${date ? ` (submitted ${date})` : ''}:`
  }

  const detail: string[] = []
  const extras = submissionExtras(sub)
  const inv = extras.find(e => e.id === 'invoice_email')
  if (inv && !inv.sameAsContact) detail.push(`Invoice email: ${inv.value}`)
  if (extras.some(e => e.id === 'onboarding_deep_clean' && e.value === 'yes')) {
    detail.push('Client requested an onboarding deep clean.')
  }
  const auto = extras.find(e => e.id === 'auto_code')
  if (auto) detail.push(`Auto code entered by client: ${auto.value}`)
  if (extras.some(e => e.id === 'api_key' || e.id === 'api_client_id')) {
    detail.push('Booking API credentials provided (kept on the onboarding submission, not copied here).')
  }
  if (urlFor) {
    const pdfs = (sub.photos ?? []).filter(p => !isImagePath(p))
    if (pdfs.length > 0) detail.push(`Attached documents: ${pdfs.map(urlFor).join(' ')}`)
  }

  if (!notes && detail.length === 0) return null
  if (!notes) lines.push(key)
  lines.push(...detail)
  return { content: lines.join('\n'), key }
}

/** True when `existingContents` already hold a note this submission produced. */
export function noteAlreadyExists(existingContents: string[], key: string): boolean {
  return existingContents.some(c => c.startsWith(key))
}

// ─── Photos ─────────────────────────────────────────────────────────────────

/**
 * Rows to insert into `property_photos` for a submission's uploads. Images
 * only (PDFs are not gallery photos; they are linked from the note), skipping
 * any URL the property already has so applying twice adds nothing.
 */
export function planPhotoInserts(
  paths: string[],
  existingUrls: string[],
  urlFor: (path: string) => string,
  startOrder = 0,
): { photo_url: string; sort_order: number }[] {
  const seen = new Set(existingUrls)
  const out: { photo_url: string; sort_order: number }[] = []
  for (const p of paths) {
    if (!isImagePath(p)) continue
    const url = urlFor(p)
    if (seen.has(url)) continue
    seen.add(url)
    out.push({ photo_url: url, sort_order: startOrder + out.length })
  }
  return out
}

// ─── Queue labels ───────────────────────────────────────────────────────────

export type SourceLabel = 'owner' | 'website' | 'link'
export function sourceLabel(source: string): SourceLabel {
  return source === 'owner' ? 'owner' : source === 'token' ? 'link' : 'website'
}

export type StatusLabel = 'new' | 'applied' | 'rejected'
export function statusLabel(status: string): StatusLabel {
  if (status === 'pending') return 'new'
  if (status === 'rejected') return 'rejected'
  return 'applied' // converted (and the never-used 'approved')
}

// ─── Readiness: can this Onboarding property go Active? ────────────────────

export interface ReadinessProperty {
  id: number
  name: string
  address?: string | null
  door_code: string | null
  has_auto_code: boolean | null
  ical_url: string | null
  trellis_id: string | null
  contact_id: string | null
}
export interface ReadinessOwner {
  id: string
  name: string | null
  email: string | null
  active: boolean | null
  trellis_portal_url: string | null
}
export interface ReadinessAgreement {
  owner_id: string
  status: string
  owner_signed_at: string | null
  created_at: string | null
}
export interface ReadinessSubmission {
  id: string
  property_id: number | null
  status: string
  source: string
  submitted_at: string | null
}

export type ReadinessItemId = 'portal' | 'agreement' | 'intake' | 'access' | 'calendar' | 'trellis'
/** `optional` items are shown but never block "Ready to activate". */
export type ReadinessState = 'done' | 'todo' | 'optional'
export interface ReadinessItem {
  id: ReadinessItemId
  state: ReadinessState
  /** i18n suffix describing exactly what is true (`readiness.detail.<id>.<code>`). */
  code: string
  name?: string
  date?: string | null
  count?: number
}
export interface ReadinessResult {
  items: ReadinessItem[]
  ready: boolean
  /** Required items still not done. */
  remaining: number
}

export function onboardingReadiness(input: {
  property: ReadinessProperty
  /** Owners linked to the property through `owner_properties`. */
  owners: ReadinessOwner[]
  /** Agreements belonging to those owners. */
  agreements: ReadinessAgreement[]
  /** Submissions filed against this property. */
  submissions: ReadinessSubmission[]
  /** Some submission for this property carries an API key (booking calendar via API). */
  hasApiKey: boolean
}): ReadinessResult {
  const { property, owners, agreements, submissions, hasApiKey } = input
  const items: ReadinessItem[] = []
  const activeOwners = owners.filter(o => o.active !== false)
  const ownerNames = (rows: ReadinessOwner[]) => rows.map(o => o.name || o.email || '').filter(Boolean).join(', ')

  // Owner portal
  if (activeOwners.length > 0) {
    items.push({ id: 'portal', state: 'done', code: 'linked', name: ownerNames(activeOwners) })
  } else if (owners.length > 0) {
    items.push({ id: 'portal', state: 'todo', code: 'inactive', name: ownerNames(owners) })
  } else {
    items.push({ id: 'portal', state: 'todo', code: 'none' })
  }

  // Agreement. Void agreements do not count; one signed agreement from any linked owner is enough.
  const live = agreements.filter(a => a.status !== 'void' && owners.some(o => o.id === a.owner_id))
  const signed = live.filter(a => a.status === 'signed')
  const sent = live.filter(a => a.status === 'sent')
  const newest = <T,>(rows: T[], pick: (r: T) => string | null) =>
    rows.map(pick).filter((d): d is string => !!d).sort().pop() ?? null
  if (owners.length === 0) {
    items.push({ id: 'agreement', state: 'todo', code: 'needs_portal' })
  } else if (signed.length > 0) {
    items.push({ id: 'agreement', state: 'done', code: 'signed', date: newest(signed, a => a.owner_signed_at ?? a.created_at) })
  } else if (sent.length > 0) {
    items.push({ id: 'agreement', state: 'todo', code: 'sent', date: newest(sent, a => a.created_at) })
  } else {
    items.push({ id: 'agreement', state: 'todo', code: 'not_sent' })
  }

  // Intake form. Applied is green; one waiting for review blocks; none at all is fine
  // (staff can enter the details directly), so it is optional rather than red.
  const applied = submissions.filter(s => s.status === 'converted' || s.status === 'approved')
  const waiting = submissions.filter(s => s.status === 'pending')
  if (waiting.length > 0) {
    items.push({ id: 'intake', state: 'todo', code: 'pending', count: waiting.length })
  } else if (applied.length > 0) {
    items.push({ id: 'intake', state: 'done', code: 'applied', date: newest(applied, s => s.submitted_at) })
  } else {
    items.push({ id: 'intake', state: 'optional', code: 'none' })
  }

  // Access: a door code, or the shared smart-lock auto code.
  if (!isBlank(property.door_code)) items.push({ id: 'access', state: 'done', code: 'door_code' })
  else if (property.has_auto_code) items.push({ id: 'access', state: 'done', code: 'auto_code' })
  else items.push({ id: 'access', state: 'todo', code: 'missing' })

  // Calendar: an iCal link, or an API key the client submitted.
  if (!isBlank(property.ical_url)) items.push({ id: 'calendar', state: 'done', code: 'ical' })
  else if (hasApiKey) items.push({ id: 'calendar', state: 'done', code: 'api_key' })
  else items.push({ id: 'calendar', state: 'todo', code: 'missing' })

  // Trellis: the property is linked in Trellis AND the owner has their portal link.
  const propertyLinked = !isBlank(property.trellis_id)
  const ownerLinked = activeOwners.some(o => !isBlank(o.trellis_portal_url))
  items.push({
    id: 'trellis',
    state: propertyLinked && ownerLinked ? 'done' : 'todo',
    code: propertyLinked && ownerLinked ? 'ok' : propertyLinked ? 'missing_owner' : ownerLinked ? 'missing_property' : 'missing_both',
  })

  const remaining = items.filter(i => i.state === 'todo').length
  return { items, ready: remaining === 0, remaining }
}

/** Whole days between an ISO timestamp and `now`; null when unknown. */
export function daysSince(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000))
}

/** Ready-to-activate first (quick wins), then oldest in Onboarding first. */
export function sortReadiness<T extends { result: ReadinessResult; days: number | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.result.ready !== b.result.ready) return a.result.ready ? -1 : 1
    return (b.days ?? -1) - (a.days ?? -1)
  })
}
