// Service detail for an invoice line: what the task behind a charge actually
// was. Pure (no I/O) so the invoice page, the API and tests share one reading.
//
// Why (Jordan, 2026-10-12): line 679 on I261009823 read "Trip Fee $50" and
// nothing else. The Trellis task behind it said "Please reset the lockbox code
// …", Urgent, requested 12:48 PM, done 11:13 PM by the Runner — everything a
// reviewer needs, and none of it reached the invoice.
//
// Access codes must never reach an invoice screen or file: task descriptions
// routinely carry them ("reset the lockbox code 1234"), so every text that
// leaves this module goes through redactCodes().

export interface TaskInput {
  source: 'trellis' | 'breezeway'
  ref: string // trellis task uuid or breezeway external id
  title: string | null
  description: string | null
  department: string | null
  priority: string | null
  status: string | null
  requestedAt: string | null // ISO timestamp (Trellis created_at)
  requestedDate: string | null // yyyy-mm-dd (Breezeway created date) when no timestamp
  scheduledDate: string | null
  scheduledTime: string | null
  completedAt: string | null // ISO timestamp
  completedDate: string | null // yyyy-mm-dd when no timestamp
  doneBy: string[]
  checklistTotal: number | null
  checklistCompleted: number | null
  linkedIssueCount: number | null
  noCharge: boolean | null
  reservationId: string | null
}

export interface StayInput {
  reservationId: string
  guestName: string | null
  checkin: string | null // yyyy-mm-dd
  checkout: string | null
  channel: string | null
  ownerBlock: boolean
  status: string | null
}

export type DayRelation = 'mid_stay' | 'checkout_day' | 'checkin_day' | 'turnover_day' | 'vacant' | 'unknown'

export interface ServiceDetail {
  /** Short, code-free statement of the work ("Reset the lockbox code"). */
  headline: string | null
  task: TaskInput | null
  /** True when a Breezeway-matched line borrowed its detail from the same
   *  task's Trellis copy (same property, same day). */
  fromTrellisTwin: boolean
  /** The stay Trellis linked the task to — often the PREVIOUS guest. */
  linkedStay: StayInput | null
  /** Who was there on the service day. */
  dayRelation: DayRelation
  onSite: StayInput | null
  lastOut: StayInput | null
  nextIn: StayInput | null
  /** Things a reviewer should look at before billing. */
  warnings: string[]
}

// ─── Redaction ────────────────────────────────────────────────────────────────

const MASK = '••••'

/** Masks door / lockbox / gate / keypad / Wi-Fi codes and passwords. Errs on
 *  the side of masking: a hidden digit costs nothing on an invoice, a leaked
 *  door code is a security incident. */
export function redactCodes(text: string | null | undefined): string | null {
  if (text == null) return null
  let out = text
  // "password: Smoky123", "wifi pw - abc", "passcode 4471"
  out = out.replace(/\b(pass(?:word|code)|pwd?|wi-?fi\s+(?:password|pw|key))\b(\s*(?:is|=|:|-)?\s*)([^\s,.;]+)/gi, `$1$2${MASK}`)
  // "lockbox code 7928", "gate code is #4521", "door: 12-34", "keypad 1234"
  out = out.replace(
    /\b(codes?|pin|combo|combination|keypad|lock\s?box|gate|door|garage|key\s?safe)\b([^\d\n]{0,24}?)#?(\d[\d\s-]{1,10}\d|\d{3,})/gi,
    `$1$2${MASK}`,
  )
  return out
}

// ─── Headline ─────────────────────────────────────────────────────────────────

/** One clause saying what was done: the description's first sentence (code
 *  masked, "Please" dropped), else the task title. */
export function headlineFor(task: Pick<TaskInput, 'title' | 'description'> | null, fallback: string | null = null): string | null {
  const desc = redactCodes(task?.description)?.trim()
  if (desc) {
    const first = desc.split(/(?<=[.!?])\s+|\n/)[0].trim()
    const tidied = first
      .replace(/^(please|pls|kindly)\s+/i, '')
      .replace(/^(can|could)\s+(you|someone|we)\s+(please\s+)?/i, '')
      .replace(/[.!?]+$/, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (tidied.length >= 3) {
      const cap = tidied[0].toUpperCase() + tidied.slice(1)
      return cap.length > 90 ? `${cap.slice(0, 87).trimEnd()}…` : cap
    }
  }
  const title = task?.title?.trim() || fallback?.trim()
  return title ? redactCodes(title) : null
}

// ─── Stay context ─────────────────────────────────────────────────────────────

/** Where the service day falls against the property's stays. `stays` must be
 *  ALL known stays for the property (cancelled ones are ignored here); when
 *  there are none at all the answer is 'unknown', never 'vacant'. */
export function stayContext(date: string | null, stays: ReadonlyArray<StayInput>): {
  dayRelation: DayRelation
  onSite: StayInput | null
  lastOut: StayInput | null
  nextIn: StayInput | null
} {
  const live = stays.filter(s => s.checkin && s.checkout && !/cancel/i.test(s.status ?? ''))
  if (!date || live.length === 0) return { dayRelation: 'unknown', onSite: null, lastOut: null, nextIn: null }
  const leaving = live.find(s => s.checkout === date) ?? null
  const arriving = live.find(s => s.checkin === date) ?? null
  const staying = live.find(s => s.checkin! < date && date < s.checkout!) ?? null
  const lastOut = [...live].filter(s => s.checkout! <= date).sort((a, b) => b.checkout!.localeCompare(a.checkout!))[0] ?? null
  const nextIn = [...live].filter(s => s.checkin! >= date).sort((a, b) => a.checkin!.localeCompare(b.checkin!))[0] ?? null
  if (staying) return { dayRelation: 'mid_stay', onSite: staying, lastOut, nextIn }
  if (leaving && arriving) return { dayRelation: 'turnover_day', onSite: leaving, lastOut, nextIn }
  if (leaving) return { dayRelation: 'checkout_day', onSite: leaving, lastOut, nextIn }
  if (arriving) return { dayRelation: 'checkin_day', onSite: arriving, lastOut, nextIn }
  return { dayRelation: 'vacant', onSite: null, lastOut, nextIn }
}

// ─── Assembly ─────────────────────────────────────────────────────────────────

export interface BuildInput {
  serviceType: string | null
  serviceDate: string | null
  clientCharge: number | null
  /** The line says it was built from / matched to a task. */
  expectsTask: boolean
  /** An add-on (hot tub, trip fee, extra cleaning…), not a regular clean:
   *  the charge itself needs a stated reason. */
  isExtra: boolean
  task: TaskInput | null
  fromTrellisTwin: boolean
  /** Every known stay at the property (for the day relation). */
  stays: ReadonlyArray<StayInput>
  linkedStay: StayInput | null
}

const DONE_STATUSES = /^(completed|closed|done|finished)$/i

/** Postgres / Trellis timestamps ("2026-10-09 16:48:22.35+00:00") to strict
 *  ISO, which every browser parses (Safari rejects the space form). */
export function toIso(v: string | null | undefined): string | null {
  if (!v) return null
  const d = new Date(v.includes('T') ? v : v.replace(' ', 'T'))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function buildServiceDetail(input: BuildInput): ServiceDetail {
  const { task } = input
  const ctx = stayContext(input.serviceDate, input.stays)
  const warnings: string[] = []
  const charged = (input.clientCharge ?? 0) > 0

  if (input.expectsTask && !task) warnings.push('The matched task is no longer in the synced task data')
  if (task) {
    if (task.status && !DONE_STATUSES.test(task.status)) warnings.push(`Task status is ${task.status.toLowerCase()}, not completed`)
    if (task.noCharge && charged) warnings.push('Trellis marks this task "no charge", but the client is charged')
    // requestedAt is only present once the detailed sync has stored this
    // task, so a task synced before 20261012a is not called "undescribed".
    if (input.isExtra && charged && !task.description && task.source === 'trellis' && task.requestedAt) warnings.push('The task has no description: nothing says why this was needed')
    if (task.source === 'breezeway' && !input.fromTrellisTwin) warnings.push('Only the Breezeway export row was found: no description or request time')
    // An unticked checklist is shown as a fact (the UI prints the count), not
    // a warning: crews often skip ticking routine clean checklists, and a
    // warning on every such clean would bury the ones that matter.
  }

  return {
    headline: headlineFor(task, input.serviceType),
    task: task ? { ...task, title: redactCodes(task.title), description: redactCodes(task.description), requestedAt: toIso(task.requestedAt), completedAt: toIso(task.completedAt) } : null,
    fromTrellisTwin: input.fromTrellisTwin,
    linkedStay: input.linkedStay,
    ...ctx,
    warnings,
  }
}

/** Plain-language reading of the day, for the compact row. */
export function dayRelationLabel(d: Pick<ServiceDetail, 'dayRelation' | 'onSite'>): string | null {
  const who = (s: StayInput | null) => (s ? (s.ownerBlock ? 'owner stay' : s.guestName ?? 'guest') : 'guest')
  switch (d.dayRelation) {
    case 'mid_stay': return d.onSite?.ownerBlock ? 'During an owner stay' : `During ${who(d.onSite)}'s stay`
    case 'checkout_day': return `Checkout day (${who(d.onSite)})`
    case 'checkin_day': return `Check-in day (${who(d.onSite)})`
    case 'turnover_day': return 'Turnover day'
    case 'vacant': return 'Vacant that day'
    default: return null
  }
}
