#!/usr/bin/env node
// Starter bot for the Tendwell Ops Issues API.
// Demonstrates list / create / get-by-id / update against the
// API-key-authenticated /api/issues endpoints.
//
// Usage:
//   ISSUES_API_KEY=... node scripts/issues-bot-example.mjs list
//   ISSUES_API_KEY=... node scripts/issues-bot-example.mjs list --status=Open
//   ISSUES_API_KEY=... node scripts/issues-bot-example.mjs create --category=Damage --details="Broken lamp"
//   ISSUES_API_KEY=... node scripts/issues-bot-example.mjs get <uuid>
//   ISSUES_API_KEY=... node scripts/issues-bot-example.mjs update <uuid> --status=Resolved --resolution="Replaced"
//
// Defaults to the prod app at https://www.tendwellcleaning.com — override
// with API_BASE=http://localhost:5000 (or any Vercel preview URL) for tests.

const BASE = process.env.API_BASE || 'https://www.tendwellcleaning.com'
const API_KEY = process.env.ISSUES_API_KEY
if (!API_KEY) {
  console.error('Set ISSUES_API_KEY in your environment first.')
  process.exit(1)
}

// Parse `--key=value` and `--key value` flags from argv.
function parseFlags(argv) {
  const out = {}
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq !== -1) {
        out[a.slice(2, eq)] = a.slice(eq + 1)
      } else {
        const next = argv[i + 1]
        if (next && !next.startsWith('--')) { out[a.slice(2)] = next; i++ }
        else out[a.slice(2)] = true
      }
    } else {
      positional.push(a)
    }
  }
  return { flags: out, positional }
}

async function call(method, path, body) {
  const url = new URL(BASE + path)
  const r = await fetch(url, {
    method,
    headers: {
      'x-api-key': API_KEY,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  if (!r.ok) {
    console.error(`HTTP ${r.status}:`, data)
    process.exit(2)
  }
  return data
}

async function main() {
  const [, , cmd, ...rest] = process.argv
  const { flags, positional } = parseFlags(rest)

  if (cmd === 'list') {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(flags)) {
      if (typeof v === 'string') params.set(k, v)
    }
    const qs = params.toString()
    const data = await call('GET', `/api/issues${qs ? `?${qs}` : ''}`)
    console.log(JSON.stringify(data, null, 2))
    return
  }

  if (cmd === 'create') {
    const data = await call('POST', '/api/issues', flags)
    console.log(JSON.stringify(data, null, 2))
    return
  }

  if (cmd === 'get') {
    const id = positional[0]
    if (!id) throw new Error('get requires a uuid: get <uuid>')
    const data = await call('GET', `/api/issues/${encodeURIComponent(id)}`)
    console.log(JSON.stringify(data, null, 2))
    return
  }

  if (cmd === 'update') {
    const id = positional[0]
    if (!id) throw new Error('update requires a uuid: update <uuid> --field=value …')
    const data = await call('PATCH', `/api/issues/${encodeURIComponent(id)}`, flags)
    console.log(JSON.stringify(data, null, 2))
    return
  }

  console.error('Unknown command. Use one of: list, create, get, update')
  process.exit(1)
}

main().catch(e => { console.error(e); process.exit(2) })
