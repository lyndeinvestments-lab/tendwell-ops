// scripts/trellis-sync-poller.mjs
// Runs every 1–2 min via cron. If a `requested` sync row exists, fire the
// wrapper (which runs Claude headless). Uses the Supabase service role key so
// it can read the sync log without an interactive session.
import { createClient } from '@supabase/supabase-js'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required'); process.exit(1) }

const supabase = createClient(url, key)
const { data, error } = await supabase
  .from('trellis_sync_log').select('id').eq('status', 'requested').limit(1)
if (error) { console.error(error.message); process.exit(1) }
if (!data || data.length === 0) { process.exit(0) }

const here = dirname(fileURLToPath(import.meta.url))
execFile(join(here, 'trellis-sync.sh'), (err) => {
  if (err) console.error('[poller] wrapper failed:', err.message)
})
