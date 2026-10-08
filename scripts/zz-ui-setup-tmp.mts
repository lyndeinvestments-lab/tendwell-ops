// Temp UI fixture: creates (or with "cleanup" removes) a supervisor login linked to a throwaway vendor and prints a session JSON.
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
for (const line of readFileSync('/Users/jordanlynde/tendwell-ops/.env.local', 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim()); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
}
const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const anon = createClient(process.env.SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!, { auth: { persistSession: false } })
const STATE = '/private/tmp/claude-501/ui-state.json'
if (process.argv[2] === 'cleanup') {
  const st = JSON.parse(readFileSync(STATE, 'utf8'))
  const { data: runs } = await admin.from('invoice_runs').select('id').eq('vendor_id', st.vendorId)
  for (const r of runs ?? []) {
    const prefix = `vendor-portal/${st.vendorId}/${r.id}`
    const { data: files } = await admin.storage.from('vendor-invoices').list(prefix)
    if (files?.length) await admin.storage.from('vendor-invoices').remove(files.map(f => `${prefix}/${f.name}`))
  }
  await admin.from('invoice_runs').delete().eq('vendor_id', st.vendorId)
  await admin.from('vendor_users').delete().eq('email', st.email)
  await admin.from('app_users').delete().eq('google_email', st.email)
  await admin.auth.admin.deleteUser(st.userId)
  await admin.from('vendors').delete().eq('id', st.vendorId)
  console.log('cleaned'); process.exit(0)
}
const stamp = Date.now()
const email = `zz-portal-ui-${stamp}@example.com`, password = `Ui-${stamp}-x9`
const { data: v } = await admin.from('vendors').insert({ name: 'ZZ UI Test Cleaning', active: true }).select('id').single()
const { data: u } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
await admin.from('app_users').insert({ google_email: email, role: 'supervisor', label: 'ZZ UI Tester' })
await admin.from('vendor_users').insert({ vendor_id: v!.id, email, created_by: 'ui-test' })
const { data: s } = await anon.auth.signInWithPassword({ email, password })
writeFileSync(STATE, JSON.stringify({ vendorId: v!.id, userId: u.user!.id, email }))
writeFileSync('/private/tmp/claude-501/ui-session.json', JSON.stringify(s.session))
console.log('ready', email)
