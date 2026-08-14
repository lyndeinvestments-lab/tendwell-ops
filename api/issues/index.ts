// /api/issues
// GET  → list issues (filterable via query params)
// POST → create a new issue
//
// Auth: x-api-key header (or Authorization: Bearer <key>) matching
// ISSUES_API_KEY env var. Service-role Supabase access is server-side only;
// callers never see the Supabase key.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  API_SCOPES,
  ISSUES_TABLE,
  buildListQuery,
  jsonError,
  requireApiKey,
  sanitizeIssueBody,
  sbFetch,
  validateIssuePayload,
} from './_lib.js'
import {
  composeBodyHtml,
  filterRecipients,
  getAllPreferences,
  getAllUsersWithViews,
  getSupabaseConfig,
  logNotification,
  renderEmailLayout,
  sendEmail,
} from '../notify/_lib.js'
import { ensureIssueSpanish, withSoftBudget } from './_translate-core.js'

// Best-effort "issue logged" email to opted-in staff. Bot-created issues used
// to be silent (only the in-app form notified); this closes that gap. Never
// throws — a notify failure must not fail the 201.
async function notifyIssueLogged(issue: Record<string, unknown>): Promise<void> {
  try {
    const sb = getSupabaseConfig()
    const [users, prefs] = await Promise.all([getAllUsersWithViews(sb), getAllPreferences(sb)])
    const eventType = 'issue_logged'
    const recipients = filterRecipients(users, prefs, eventType)
    if (recipients.length === 0) return
    const title = `New issue logged: ${issue.property_name || 'Unknown property'}`
    const lines = [
      `Category: ${issue.category || '—'}`,
      `Type: ${issue.issue_type === 'guest_feedback' ? 'Guest Feedback' : 'Needs Attention'}`,
      `Priority: ${issue.priority || 'normal'}`,
      ...(issue.due_date ? [`Due: ${issue.due_date}`] : []),
      `Source: API (${issue.created_by || 'api'})`,
    ]
    const bodyHtml = composeBodyHtml({ lines, quote: typeof issue.details === 'string' ? issue.details : null })
    const html = renderEmailLayout({ title, bodyHtml, ctaUrl: 'https://app.tendwellcleaningco.com/issues', ctaLabel: 'Open Issues Tracker' })
    for (const r of recipients) {
      const result = await sendEmail({ to: r.google_email, subject: title, html })
      await logNotification(sb, {
        recipient_email: r.google_email,
        recipient_user_id: r.id,
        event_type: eventType,
        subject: title,
        status: result.ok ? 'sent' : 'failed',
        error: result.ok ? undefined : result.error,
        meta: { source: 'api', property: issue.property_name ?? null, category: issue.category ?? null },
      })
    }
  } catch (e) {
    console.error('notifyIssueLogged failed (non-fatal):', e)
  }
}

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Scope required per operation: listing reads, creating an issue writes.
  // Accept the uniform view/edit scopes plus the legacy granular aliases.
  const scope =
    req.method === 'POST' ? [API_SCOPES.ISSUES_EDIT, API_SCOPES.ISSUES_CREATE]
    : req.method === 'GET' ? [API_SCOPES.ISSUES_VIEW, API_SCOPES.ISSUES_READ]
    : null
  if (scope) {
    if (!(await requireApiKey(req, res, scope))) return
  }

  if (req.method === 'GET') {
    try {
      const qs = buildListQuery(req.query as Record<string, string | string[] | undefined>)
      const limitRaw = req.query.limit
      const limitNum = Math.min(
        Math.max(parseInt(typeof limitRaw === 'string' ? limitRaw : '', 10) || DEFAULT_LIMIT, 1),
        MAX_LIMIT,
      )
      const path = `${ISSUES_TABLE}?${qs}&limit=${limitNum}`
      const data = await sbFetch<unknown[]>(path)
      res.status(200).json({ data, count: Array.isArray(data) ? data.length : 0 })
    } catch (e) {
      const err = e as Error & { status?: number; body?: string }
      jsonError(res, err.status && err.status >= 400 && err.status < 600 ? err.status : 500, err.message || 'List failed')
    }
    return
  }

  if (req.method === 'POST') {
    const payload = sanitizeIssueBody(req.body)
    // Required columns from the table definition. Default report_date to
    // today (UTC) so bots don't have to compute it themselves; status
    // defaults to "Needs Attention" (the UI's open state — 'Open' is not in
    // the status vocabulary). Category has no sensible default — bots must
    // pass one. issue_type defaults to needs_attention (actionable) —
    // guest feedback must be flagged explicitly.
    if (!payload.category || typeof payload.category !== 'string') {
      jsonError(res, 400, 'category is required (e.g. "Damage", "Missing Item", "Maintenance")')
      return
    }
    if (!payload.report_date) payload.report_date = new Date().toISOString().slice(0, 10)
    if (!payload.status) payload.status = 'Needs Attention'
    if (!payload.issue_type) payload.issue_type = 'needs_attention'
    if (!payload.created_by) payload.created_by = 'api'
    const invalid = validateIssuePayload(payload)
    if (invalid) {
      jsonError(res, 400, invalid)
      return
    }
    try {
      const inserted = await sbFetch<unknown[]>(ISSUES_TABLE, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      const row = Array.isArray(inserted) ? inserted[0] : inserted
      if (row) {
        await notifyIssueLogged(row as Record<string, unknown>)
        // Warm the ES translation cache before responding (soft-budgeted —
        // never adds more than ~10s, and never fails the create). Bot/API
        // creates have no other path to trigger this, unlike in-app creates
        // which fire the client-side equivalent (`triggerIssueTranslate`).
        const rowId = (row as Record<string, unknown>).id
        if (typeof rowId === 'string') {
          await withSoftBudget(() => ensureIssueSpanish(getSupabaseConfig(), rowId), 10_000)
        }
      }
      res.status(201).json({ data: row })
    } catch (e) {
      const err = e as Error & { status?: number; body?: string }
      jsonError(res, err.status && err.status >= 400 && err.status < 600 ? err.status : 500, err.message || 'Create failed')
    }
    return
  }

  res.setHeader('Allow', 'GET, POST')
  jsonError(res, 405, `Method ${req.method} not allowed`)
}
