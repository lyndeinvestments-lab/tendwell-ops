// Browser sweep of every page a CREW login can open, as real cleaning /
// inspector / supervisor sessions against a deployment. Proves the crew data
// lockdown (migrations 20261008g/h) from the client side:
//   1. no crew page READS a finance-only relation (properties, contacts,
//      money views, logs…) — so phase 2 cannot break a page, and nothing a
//      crew browser loads carries client money or client contact data;
//   2. no API/REST request fails and no page shows an error state.
//
//   npx tsx scripts/verify-crew-lockdown.ts https://<deployment-host>
//
// VERCEL_COOKIE=_vercel_jwt=… for protected previews. Creates temporary auth
// users + app_users rows and ALWAYS deletes them. Exits non-zero on failure.

import { readFileSync, existsSync } from 'node:fs'
import { chromium, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

for (const f of ['.env.local', '../../../.env.local']) {
  if (!existsSync(f)) continue
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
  }
}

const BASE = (process.argv[2] ?? '').replace(/\/$/, '')
if (!/^https:\/\//.test(BASE)) throw new Error('usage: verify-crew-lockdown.ts https://<host>')
const SB_URL = process.env.SUPABASE_URL!
const admin = createClient(SB_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const anon = createClient(SB_URL, process.env.VITE_SUPABASE_ANON_KEY!, { auth: { persistSession: false } })

// Relations a crew browser must never READ.
const FORBIDDEN = new Set([
  'properties', 'operational_properties', 'contacts', 'organizations', 'contact_interactions', 'contact_notes',
  'client_stage_transitions', 'pipeline_view', 'property_proforma', 'property_month_financials',
  'financial_monthly_cleans', 'financial_task_load', 'monthly_financial_snapshot', 'proforma_months',
  'qbo_pl_months', 'qbo_class_pl_months', 'website_leads', 'onboarding_submissions', 'owner_agreements',
  'owner_referrals', 'owner_feedback', 'owner_testimonials', 'property_owners', 'amenity_costs',
  'cleaning_history', 'north_star_metrics', 'north_star_values', 'trellis_reservation_snapshot',
  'activity_log', 'property_edit_log', 'invoice_lines', 'invoice_runs', 'client_fee_overrides',
])
// auth.tsx probes property_owners BY OWN EMAIL to detect a dual staff+owner
// login; the policy only ever returns the caller's own row, so it is allowed.
const ALLOWED_FORBIDDEN_READ = (rel: string, url: string) => rel === 'property_owners' && /email=eq\./.test(url)

const PAGES: Record<string, string[]> = {
  cleaning: ['/linen-tracker', '/access-codes', '/ac-filters', '/account'],
  inspector: ['/linen-tracker', '/linen-inventory', '/damaged-linens', '/access-codes', '/ac-filters', '/property-verifications',
    '/inspections', '/lost-items', '/incoming-shipments', '/laundry-weigh-ins', '/tasks', '/issues', '/cleaners', '/account'],
  supervisor: ['/property-list', '/linen-tracker', '/linen-inventory', '/damaged-linens', '/access-codes', '/ac-filters',
    '/property-verifications', '/inspections', '/lost-items', '/incoming-shipments', '/laundry-weigh-ins', '/tasks',
    '/issues', '/cleaners', '/cleaner-metrics', '/alerts', '/vendor-invoicing', '/account'],
  // Control group: finance staff must keep EVERYTHING (money pages load, the
  // modal shows money). Forbidden-read checks don't apply to this role.
  operations: ['/property-list', '/pipeline', '/contacts', '/quote-sheet', '/master-list', '/dashboard', '/alerts',
    '/linen-tracker', '/access-codes', '/inspections', '/invoicing'],
}
const FINANCE_ROLES = new Set(['operations'])
const ROLES = (process.env.ROLES ?? Object.keys(PAGES).join(',')).split(',')

let failures = 0
function fail(msg: string) { console.log(`FAIL  ${msg}`); failures++ }

async function sweep(role: string, page: Page, propertyId: number) {
  const reads: string[] = []
  const errors: string[] = []
  page.on('response', res => {
    const url = res.url()
    const m = /\/rest\/v1\/([a-z_]+)/.exec(url)
    if (m && res.request().method() === 'GET') {
      reads.push(m[1])
      if (!FINANCE_ROLES.has(role) && FORBIDDEN.has(m[1]) && !ALLOWED_FORBIDDEN_READ(m[1], url)) fail(`${role}: browser read finance-only "${m[1]}" (${new URL(url).pathname}${new URL(url).search.slice(0, 120)})`)
    }
    if ((m || /\/api\//.test(url)) && res.status() >= 400 && !/\/api\/vendor-invoices\/runs/.test(url)) {
      errors.push(`${res.status()} ${res.request().method()} ${new URL(url).pathname}`)
    }
  })
  for (const path of PAGES[role]) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => {})
    await page.waitForTimeout(1500)
    const body = await page.locator('body').innerText().catch(() => '')
    if (/Couldn't load|Something went wrong|No se pudo cargar/i.test(body)) fail(`${role} ${path}: page shows an error state`)
    if (/Access denied|Acceso denegado/i.test(body)) fail(`${role} ${path}: access denied`)
    console.log(`  ${role} ${path} ok`)
  }
  // The universal property modal, opened by deep link from a crew page.
  await page.goto(`${BASE}${role === 'supervisor' ? '/property-list' : '/access-codes'}?property=${propertyId}`, { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => {})
  await page.waitForTimeout(2500)
  const modal = await page.locator('[role="dialog"]').innerText().catch(() => '')
  const showsMoney = /Client Charged|Profit|Cobrado al cliente|Ganancia/i.test(modal)
  if (!modal) fail(`${role}: property modal did not open`)
  else if (!FINANCE_ROLES.has(role) && showsMoney) fail(`${role}: property modal shows money`)
  else if (FINANCE_ROLES.has(role) && !showsMoney) fail(`${role}: finance staff lost the money in the property modal`)
  else console.log(`  ${role} property modal ok (${showsMoney ? 'shows money' : 'no money'})`)
  // The command palette (Cmd+K) searches properties.
  await page.keyboard.press('Meta+k')
  await page.waitForTimeout(1500)
  for (const e of [...new Set(errors)]) fail(`${role}: request failed — ${e}`)
  console.log(`${role}: ${reads.length} reads over ${[...new Set(reads)].length} relations: ${[...new Set(reads)].sort().join(', ')}`)
}

const stamp = Date.now()
const created: Array<{ id: string; email: string }> = []
// CHROMIUM_PATH: use an already-installed browser when the package's pinned
// build isn't downloaded (e.g. ~/Library/Caches/ms-playwright/chromium_headless_shell-1243/…).
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
try {
  const { data: prop } = await admin.from('properties').select('id').is('deleted_at', null).not('stage_id', 'is', null).limit(1).single()
  for (const role of ROLES) {
    const email = `zz-crew-${role}-${stamp}@example.com`
    const password = `Crew-${stamp}-${Math.random().toString(36).slice(2)}`
    const { data: u, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (error || !u.user) throw new Error(`createUser ${role}: ${error?.message}`)
    created.push({ id: u.user.id, email })
    await admin.from('app_users').insert({ google_email: email, role, label: `ZZ ${role}` })
    const { data: s } = await anon.auth.signInWithPassword({ email, password })
    const ctx = await browser.newContext()
    if (process.env.VERCEL_COOKIE) {
      const name = process.env.VERCEL_COOKIE.split('=')[0]
      await ctx.addCookies([{ name, value: process.env.VERCEL_COOKIE.slice(name.length + 1), domain: new URL(BASE).hostname, path: '/' }])
    }
    const page = await ctx.newPage()
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
    await page.evaluate(([session]) => {
      localStorage.setItem('tendwell-sb-auth', session)
      localStorage.setItem('tendwell-locale', 'en')
    }, [JSON.stringify(s.session)])
    await sweep(role, page, prop!.id)
    await ctx.close()
  }
} finally {
  await browser.close()
  for (const c of created) {
    await admin.from('app_users').delete().eq('google_email', c.email)
    await admin.auth.admin.deleteUser(c.id)
  }
  console.log('cleaned up crew test logins')
}
console.log(failures ? `\n${failures} problem(s)` : '\nall crew pages clean')
process.exit(failures ? 1 : 0)
