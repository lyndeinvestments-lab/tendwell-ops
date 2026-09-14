import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { requireAdminBearer } from '../qbo/_lib.js'
import { getSupabaseConfig, notifyStaff } from '../notify/_lib.js'
import { groupOwnerActivity, groupSubjectTarget, type OwnerActivityRow } from './_owner-activity.js'

// GET /api/cron/owner-activity
//
// Tells staff what owners have been doing in their portal. Two things:
//
//   1. Every owner-attributed activity_log row written since the last run,
//      grouped into one email per owner per sitting. Grouping is the whole
//      trick: the portal writes one activity_log row per changed field, so
//      Morgan Hogg's 2026-08-28 save wrote fourteen rows, and Robin Bulba's
//      2026-07-27 onboarding session touched eight cabins in twenty-five
//      minutes. Replayed against the real 61 rows of owner history, this
//      sends 16 emails rather than 61.
//   2. Owners signing in for the first time. Not every login, which would be
//      noise; the first one, which is the signal that a handoff landed.
//
// Runs on a schedule rather than firing from each write path because most of
// those writes happen inside Postgres (the guard trigger, the owner RPCs),
// where there is no way to send mail, and because grouping needs a window.
//
// Auth mirrors the other crons: the cron secret, or an admin session bearer
// for an on-demand run.

const WATERMARK_KEY = 'owner_activity_notified_through'
const SITE_URL = 'https://app.tendwellcleaningco.com'

// Never look further back than this, however stale the watermark is. A cron
// that has been off for a month should resume, not send a month of history.
const MAX_LOOKBACK_MS = 24 * 60 * 60 * 1000

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.authorization
  const headerSecret = (req.headers['x-cron-secret'] as string | undefined) ?? ''
  const cronOk = !!cronSecret && (authHeader === `Bearer ${cronSecret}` || headerSecret === cronSecret)
  if (!cronOk) {
    const admin = await requireAdminBearer(req, res)
    if (!admin) return
  }

  let cfg
  try {
    cfg = getSupabaseConfig()
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }
  const sb = createClient(cfg.url, cfg.serviceKey)

  try {
    const startedAt = new Date()

    const { data: wmRow } = await sb
      .from('app_settings')
      .select('value')
      .eq('key', WATERMARK_KEY)
      .maybeSingle()

    const parsed = wmRow?.value ? Date.parse(wmRow.value as string) : NaN
    const floor = startedAt.getTime() - MAX_LOOKBACK_MS
    const since = new Date(Number.isNaN(parsed) ? floor : Math.max(parsed, floor))

    // Read up to the moment the run started, not now(): anything written while
    // this handler is running belongs to the next sweep, or it would be skipped
    // when the watermark advances.
    const { data: rows, error } = await sb
      .from('activity_log')
      .select('entity_type, entity_id, entity_name, action, field_name, old_value, new_value, changed_by, created_at')
      // Deliberately '%owner%' and not '%(owner)': PostgREST parses
      // parentheses in a filter value as logical grouping, so the precise
      // suffix cannot go in the query. This narrows the read; ownerName() in
      // groupOwnerActivity does the exact ' (owner)' match and drops anything
      // else, so a staff row can never be reported as owner activity.
      .ilike('changed_by', '%owner%')
      .gt('created_at', since.toISOString())
      .lte('created_at', startedAt.toISOString())
      .order('created_at', { ascending: true })
      .limit(1000)
    if (error) throw new Error(`activity_log read: ${error.message}`)

    // Body lines are plain text with <strong> allowed: composeBodyHtml escapes
    // each line and then restores only <strong>/<em>, so pre-escaping here would
    // double-encode any name carrying an & or an apostrophe.
    const groups = groupOwnerActivity((rows ?? []) as OwnerActivityRow[])
    let activitySent = 0
    for (const g of groups) {
      const lines: string[] = [
        `<strong>${g.owner}</strong> made ${
          g.changeCount === 1 ? 'a change' : `${g.changeCount} changes`
        } in the owner portal.`,
      ]
      for (const rec of g.records) {
        // Name the record only when the sitting touched more than one, or the
        // heading repeats the subject line for no reason.
        if (g.records.length > 1) lines.push(`<strong>${rec.entityName || 'Their account'}</strong>`)
        for (const c of rec.changes) lines.push(describeChange(c))
      }

      const r = await notifyStaff(cfg, {
        eventType: 'owner_portal_activity',
        subject: `${g.owner} updated ${groupSubjectTarget(g)}`,
        lines,
        ctaUrl: `${SITE_URL}/activity`,
        ctaLabel: 'Open Activity',
        meta: {
          owner: g.owner,
          records: g.records.length,
          changes: g.changeCount,
        },
      })
      if (r.sent > 0) activitySent++
    }

    const firstLogins = await notifyFirstLogins(sb, cfg)

    // Advance the watermark only after the sends. If this handler dies halfway
    // the next run re-reads the same window and may repeat an email — a
    // duplicate is a far better failure than a silently skipped change.
    await sb.from('app_settings').upsert(
      { key: WATERMARK_KEY, value: startedAt.toISOString() },
      { onConflict: 'key' },
    )

    return res.status(200).json({
      ok: true,
      since: since.toISOString(),
      rows: rows?.length ?? 0,
      activity_groups: groups.length,
      activity_emails: activitySent,
      first_logins: firstLogins,
    })
  } catch (e: any) {
    console.error('owner-activity sweep failed:', e)
    return res.status(500).json({ error: e.message || 'Sweep failed' })
  }
}

function describeChange(c: { field: string; from: string | null; to: string | null; action: string }): string {
  const label = prettyField(c.field)
  switch (c.action) {
    case 'note_added':
      return `Added a note: ${truncate(c.to ?? '', 200)}`
    case 'quote_response':
      return `${c.to === 'approved' ? 'Approved' : 'Declined'} their quote`
    case 'referral_submitted':
      return `Referred someone: ${truncate(c.to ?? '', 160)}`
    case 'testimonial_submitted':
      return `Left a testimonial: ${truncate(c.to ?? '', 160)}`
    case 'feedback_submitted':
      return `Left feedback (${label}): ${truncate(c.to ?? '', 160)}`
    case 'photo_uploaded':
      return 'Uploaded a photo'
    default:
      // Field edits carry both sides, which is the whole point of the email:
      // you should be able to tell whether to act without opening the app.
      return c.from
        ? `${label}: ${truncate(c.from, 80)} → ${truncate(c.to ?? '(blank)', 80)}`
        : `${label}: ${truncate(c.to ?? '(blank)', 80)}`
  }
}

function prettyField(f: string): string {
  return f
    .replace(/_/g, ' ')
    .replace(/\b\w/g, m => m.toUpperCase())
    .replace(/\bWifi\b/i, 'Wi-Fi')
    .replace(/\bIcal\b/i, 'iCal')
    .replace(/\bAc\b/, 'A/C')
}

function truncate(s: string, n: number): string {
  const t = s.trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

// An owner whose auth user has signed in but who has never been reported as
// having done so. The real timestamp lives on auth.users; property_owners only
// records that we have said something, so a failed send is retried next run.
async function notifyFirstLogins(
  sb: ReturnType<typeof createClient>,
  cfg: { url: string; serviceKey: string },
): Promise<number> {
  const { data: pending, error } = await sb
    .from('property_owners')
    .select('id, name, email, active')
    .is('first_login_notified_at', null)
    .eq('active', true)
  if (error) {
    console.error('first-login read failed:', error.message)
    return 0
  }
  if (!pending?.length) return 0

  // auth.users is not reachable over PostgREST, so ask the Admin API. One page
  // covers this account comfortably; owners number in the dozens.
  let users: Array<{ email?: string; last_sign_in_at?: string | null }> = []
  try {
    const { data, error: uErr } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 })
    if (uErr) throw uErr
    users = (data?.users ?? []) as typeof users
  } catch (e: any) {
    console.error('listUsers failed:', e?.message || e)
    return 0
  }
  const signedIn = new Map(
    users
      .filter(u => u.email && u.last_sign_in_at)
      .map(u => [u.email!.toLowerCase(), u.last_sign_in_at!]),
  )

  let sent = 0
  for (const owner of pending as Array<{ id: string; name: string | null; email: string }>) {
    const at = signedIn.get((owner.email || '').toLowerCase())
    if (!at) continue

    const who = owner.name || owner.email
    await notifyStaff(cfg, {
      eventType: 'owner_portal_activity',
      subject: `${who} signed into the owner portal for the first time`,
      lines: [
        `<strong>${who}</strong> has logged into their owner portal for the first time.`,
        `Account: ${owner.email}`,
        'Worth a look at whether their property details and permissions are set the way you want them.',
      ],
      ctaUrl: `${SITE_URL}/settings`,
      ctaLabel: 'Open Settings',
      meta: { owner_id: owner.id, email: owner.email, first_sign_in_at: at },
    })
    // Marked regardless of send result: notifyStaff has already retried
    // nothing, and re-sending this same email every 15 minutes because Resend
    // is down would be worse than missing it once. The failure is in
    // notification_log either way.
    await sb
      .from('property_owners')
      .update({ first_login_notified_at: new Date().toISOString() })
      .eq('id', owner.id)
    sent++
  }
  return sent
}

export const config = { runtime: 'nodejs' }
