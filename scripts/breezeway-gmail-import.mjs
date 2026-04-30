#!/usr/bin/env node
// Breezeway daily CSV import — Gmail agent
//
// Searches Gmail for today's two Breezeway export emails, downloads the CSV
// attachments, and POSTs them to the Tendwell import endpoint.
//
// Usage (manual):
//   GMAIL_CLIENT_ID=... GMAIL_CLIENT_SECRET=... GMAIL_REFRESH_TOKEN=... \
//   BREEZEWAY_IMPORT_KEY=... node scripts/breezeway-gmail-import.mjs
//
// Set DRY_RUN=true to search + log without posting or marking as read.
//
// Required env vars:
//   GMAIL_CLIENT_ID       — Google OAuth2 client ID
//   GMAIL_CLIENT_SECRET   — Google OAuth2 client secret
//   GMAIL_REFRESH_TOKEN   — Offline OAuth2 refresh token for the Gmail account
//   BREEZEWAY_IMPORT_KEY  — Shared secret header for the import endpoint
//
// Optional:
//   IMPORT_BASE           — Override Tendwell base URL (default: https://www.tendwellcleaning.com)
//   DRY_RUN               — Set to "true" to skip posting and marking as read

const BASE = process.env.IMPORT_BASE || 'https://www.tendwellcleaning.com'
const IMPORT_KEY = process.env.BREEZEWAY_IMPORT_KEY
const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET
const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN
const DRY_RUN = process.env.DRY_RUN === 'true'

const REQUIRED = { BREEZEWAY_IMPORT_KEY: IMPORT_KEY, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN }
for (const [k, v] of Object.entries(REQUIRED)) {
  if (!v) { console.error(`[FATAL] Missing required env var: ${k}`); process.exit(1) }
}

const TARGETS = [
  { subject: 'Daily Task Export for Ops Site Current Month', label: 'current_month' },
  { subject: 'Daily Task Export for Ops Site Next Month',   label: 'next_month'    },
]

// ── Gmail helpers ────────────────────────────────────────────────────────────

async function getAccessToken() {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GMAIL_CLIENT_ID,
      client_secret: GMAIL_CLIENT_SECRET,
      refresh_token: GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  })
  if (!resp.ok) throw new Error(`OAuth token refresh failed ${resp.status}: ${await resp.text()}`)
  const { access_token } = await resp.json()
  return access_token
}

async function gmailGet(token, path) {
  const resp = await fetch(`https://gmail.googleapis.com/gmail/v1/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!resp.ok) throw new Error(`Gmail GET ${path} → ${resp.status}: ${await resp.text()}`)
  return resp.json()
}

async function gmailModify(token, messageId, body) {
  const resp = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!resp.ok) throw new Error(`Gmail modify ${messageId} → ${resp.status}: ${await resp.text()}`)
}

/** Returns today in YYYY/MM/DD format for Gmail `after:` queries. */
function todayGmailDate() {
  const d = new Date()
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

/** Returns the Gmail message ID of the first unread email matching subject today, or null. */
async function findEmail(token, subject) {
  const q = `subject:"${subject}" after:${todayGmailDate()} is:unread`
  const data = await gmailGet(token, `users/me/messages?q=${encodeURIComponent(q)}`)
  return data.messages?.[0]?.id ?? null
}

/** Walks a MIME part tree depth-first looking for a CSV attachment. */
function findCsvPart(part) {
  if (!part) return null
  if (
    part.mimeType === 'text/csv' ||
    (part.filename && part.filename.toLowerCase().endsWith('.csv'))
  ) return part
  for (const child of part.parts ?? []) {
    const hit = findCsvPart(child)
    if (hit) return hit
  }
  return null
}

/** Downloads the CSV attachment from a Gmail message and returns it as a string. */
async function getAttachmentCsv(token, messageId) {
  const msg = await gmailGet(token, `users/me/messages/${messageId}?format=full`)
  const csvPart = findCsvPart(msg.payload)
  if (!csvPart) throw new Error(`No CSV attachment found in message ${messageId}`)

  let base64url
  if (csvPart.body?.data) {
    base64url = csvPart.body.data
  } else if (csvPart.body?.attachmentId) {
    const att = await gmailGet(token, `users/me/messages/${messageId}/attachments/${csvPart.body.attachmentId}`)
    base64url = att.data
  } else {
    throw new Error(`CSV part has no data or attachmentId in message ${messageId}`)
  }

  return Buffer.from(base64url, 'base64url').toString('utf-8')
}

// ── Import endpoint ──────────────────────────────────────────────────────────

async function postCsv(csvText, label) {
  const url = `${BASE}/api/tasks/breezeway-import?source=${label}`
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/csv', 'x-tendwell-import-key': IMPORT_KEY },
    body: csvText,
  })
  const json = await resp.json().catch(() => null)
  if (!resp.ok || !json?.ok) {
    throw new Error(`Import API ${resp.status}: ${JSON.stringify(json)}`)
  }
  return json
}

/** Retries fn up to maxAttempts times with exponential backoff (2s, 4s, 8s…). */
async function withRetry(fn, maxAttempts = 3) {
  let lastErr
  for (let i = 0; i < maxAttempts; i++) {
    try { return await fn() } catch (err) {
      lastErr = err
      if (i + 1 < maxAttempts) await new Promise(r => setTimeout(r, 2 ** (i + 1) * 1000))
    }
  }
  throw lastErr
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (DRY_RUN) console.log('[DRY RUN] Will not post or mark emails as read.')

  let token
  try {
    token = await getAccessToken()
  } catch (err) {
    console.error(`[FATAL] Gmail auth failed: ${err.message}`)
    process.exit(1)
  }

  const results = []
  let anyFailure = false

  for (const { subject, label } of TARGETS) {
    // Find email
    let messageId
    try {
      messageId = await findEmail(token, subject)
    } catch (err) {
      console.error(`[ERROR] Gmail search for "${subject}": ${err.message}`)
      results.push({ label, status: 'error', error: err.message })
      anyFailure = true
      continue
    }

    if (!messageId) {
      console.warn(`[WARN] No unread email found today for: "${subject}"`)
      results.push({ label, status: 'missing' })
      anyFailure = true
      continue
    }

    // Download attachment
    let csvText
    try {
      csvText = await getAttachmentCsv(token, messageId)
    } catch (err) {
      console.error(`[ERROR] Downloading CSV (msg ${messageId}): ${err.message}`)
      results.push({ label, status: 'error', error: err.message })
      anyFailure = true
      continue
    }

    if (DRY_RUN) {
      const lines = csvText.split('\n').length
      console.log(`[DRY RUN] ${label}: found message ${messageId}, CSV has ${lines} lines`)
      results.push({ label, status: 'dry_run', lines })
      continue
    }

    // POST to import endpoint (up to 3 attempts)
    let importResult
    try {
      importResult = await withRetry(() => postCsv(csvText, label))
    } catch (err) {
      console.error(`[ERROR] Import failed for ${label} after 3 attempts: ${err.message}`)
      results.push({ label, status: 'error', error: err.message })
      anyFailure = true
      continue
    }

    // Mark as read
    try {
      await gmailModify(token, messageId, { removeLabelIds: ['UNREAD'] })
    } catch (err) {
      console.warn(`[WARN] Could not mark message ${messageId} as read: ${err.message}`)
    }

    const { rows_upserted, cleans_in_batch, unmatched_addresses_count, sample_unmatched_addresses } = importResult
    console.log(`[OK] ${label}: ${rows_upserted} upserted, ${cleans_in_batch} cleans`)

    if (unmatched_addresses_count > 0) {
      console.warn(`[WARN] ${label}: ${unmatched_addresses_count} unmatched address(es): ${sample_unmatched_addresses.join(', ')}`)
    }

    results.push({ label, status: 'ok', rows_upserted, cleans_in_batch })
  }

  // One-line summary (mirrors the format in the runbook)
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 16)
  const summary = results.map(r => {
    if (r.status === 'ok')      return `${r.label}: ${r.rows_upserted} upserted, ${r.cleans_in_batch} cleans`
    if (r.status === 'dry_run') return `${r.label}: dry run (${r.lines} CSV lines)`
    if (r.status === 'missing') return `${r.label}: MISSING`
    return `${r.label}: ERROR — ${r.error}`
  }).join('; ')
  console.log(`[${ts}] ${summary}`)

  if (anyFailure) process.exit(1)
}

main().catch(err => { console.error('[FATAL]', err); process.exit(1) })
