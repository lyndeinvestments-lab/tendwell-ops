import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  getSupabaseConfig, getAllUsersWithViews, getAllPreferences,
  filterRecipients, sendEmail, logNotification, renderEmailLayout, escapeHtml,
} from './_lib.js'

// GET /api/notify/digest — invoked by Vercel cron daily at 8am ET (12:00 UTC)
// Auth: requires CRON_SECRET in Authorization header (Vercel cron sets this).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.authorization
    if (auth !== `Bearer ${cronSecret}`) return res.status(401).json({ error: 'Unauthorized' })
  }

  let sb
  try { sb = getSupabaseConfig() } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }

  try {
    const today = new Date().toISOString().slice(0, 10)
    const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    // Fetch source data with service role
    const fetchTbl = async (path: string) => {
      const r = await fetch(`${sb.url}/rest/v1/${path}`, {
        headers: { apikey: sb.serviceKey, Authorization: `Bearer ${sb.serviceKey}` },
      })
      if (!r.ok) throw new Error(`${path}: ${r.status}`)
      return r.json()
    }

    const [tasks, properties, contacts] = await Promise.all([
      fetchTbl(`tasks?select=id,title,due_date,status,priority,assignee_name&status=neq.Done&due_date=lte.${today}`),
      fetchTbl(`operational_properties?select=id,name,stage_name`).catch(() => []),
      fetchTbl(`contacts?select=id,name,follow_up_date&follow_up_date=lte.${today}`).catch(() => []),
    ])

    // Verifications due — properties not verified in 6 months (best-effort)
    let verificationsDue: any[] = []
    try {
      const verifs = await fetchTbl(`property_verifications?select=property_id,verified_at&verified_at=not.is.null&order=verified_at.desc`)
      const lastByProp = new Map<string, string>()
      for (const v of verifs) if (!lastByProp.has(v.property_id)) lastByProp.set(v.property_id, v.verified_at)
      verificationsDue = (properties as any[])
        .filter((p: any) => p.stage_name === 'Active')
        .filter((p: any) => {
          const last = lastByProp.get(p.id)
          return !last || last < sixMonthsAgo
        })
        .slice(0, 25)
    } catch { /* table may not exist yet */ }

    const [users, prefs] = await Promise.all([
      getAllUsersWithViews(sb),
      getAllPreferences(sb),
    ])

    const sentResults: any[] = []

    // For each user with daily digest, build a personalized digest of items they can see
    const dailyUsers = users.filter(u => {
      const p = prefs.get(u.id)
      return u.google_email && p && p.email_enabled && p.digest_frequency === 'daily'
    })

    for (const u of dailyUsers) {
      const p = prefs.get(u.id)!
      const sections: string[] = []

      if (p.notify_task_overdue && u.allowedViews.includes('tasks') && tasks.length > 0) {
        const myTasks = tasks.filter((t: any) => !t.assignee_name || t.assignee_name === u.label || u.allowedViews.includes('tasks'))
        if (myTasks.length > 0) {
          sections.push(sectionHtml('Overdue / due today tasks', myTasks.slice(0, 15).map((t: any) =>
            `${escapeHtml(t.title)} <span style="color:#64748b;">— due ${t.due_date || '—'} (${escapeHtml(t.priority || '')})</span>`)))
        }
      }
      if (p.notify_verification_due && u.allowedViews.includes('inspections') && verificationsDue.length > 0) {
        sections.push(sectionHtml('Verifications due (6+ months)', verificationsDue.map((p: any) => escapeHtml(p.name))))
      }
      if (p.notify_follow_up_due && u.allowedViews.includes('contacts') && contacts.length > 0) {
        sections.push(sectionHtml('Follow-ups due', contacts.slice(0, 15).map((c: any) =>
          `${escapeHtml(c.name)} <span style="color:#64748b;">— ${c.follow_up_date}</span>`)))
      }

      if (sections.length === 0) continue // nothing to send today

      const html = renderEmailLayout({
        title: `Tendwell Ops — Daily digest`,
        bodyHtml: sections.join('\n'),
        ctaUrl: 'https://www.tendwellcleaning.com',
        ctaLabel: 'Open Tendwell Ops',
      })
      const r = await sendEmail({ to: u.google_email, subject: `Daily digest — ${today}`, html })
      await logNotification(sb, {
        recipient_email: u.google_email,
        recipient_user_id: u.id,
        event_type: 'daily_digest',
        subject: `Daily digest — ${today}`,
        status: r.ok ? 'sent' : 'failed',
        error: r.error,
      })
      sentResults.push({ to: u.google_email, status: r.ok ? 'sent' : 'failed' })
    }

    return res.json({ ok: true, sent: sentResults.length, results: sentResults })
  } catch (err: any) {
    console.error('Digest error:', err)
    return res.status(500).json({ error: err.message })
  }
}

function sectionHtml(title: string, items: string[]): string {
  if (items.length === 0) return ''
  const lis = items.map(i => `<li style="margin:4px 0;">${i}</li>`).join('')
  return `<h3 style="font-size:14px;font-weight:600;margin:16px 0 8px;color:#0f172a;">${escapeHtml(title)} <span style="color:#64748b;font-weight:400;">(${items.length})</span></h3><ul style="font-size:13px;line-height:1.6;padding-left:18px;margin:0;">${lis}</ul>`
}

export const config = { runtime: 'nodejs' }
