// One-time backfill: download every object in the `laundry-weigh-ins`
// bucket, resize with macOS `sips` (longest side 1280 px, JPEG q=80),
// and re-upload to the SAME path so existing photo_url references stay
// valid. Skips anything already small enough.
//
// Run with:
//   set -a; source .env.compress-laundry; set +a; npx tsx scripts/compress-laundry-photos.ts

import { createClient } from '@supabase/supabase-js'
import { spawn } from 'node:child_process'
import { writeFile, readFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const BUCKET = 'laundry-weigh-ins'
const MAX_DIM = 1280
const QUALITY = 80
const SKIP_BELOW_BYTES = 600_000

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env')
  process.exit(1)
}

const supabase = createClient(url, key, { auth: { persistSession: false } })

function fmtBytes(n: number): string {
  if (n > 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`
  if (n > 1_000) return `${(n / 1_000).toFixed(0)} KB`
  return `${n} B`
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'ignore' })
    p.on('exit', code => (code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}`))))
    p.on('error', reject)
  })
}

async function listAll(prefix = ''): Promise<string[]> {
  const out: string[] = []
  const stack = [prefix]
  while (stack.length) {
    const dir = stack.pop()!
    let offset = 0
    while (true) {
      const { data, error } = await supabase.storage.from(BUCKET).list(dir, {
        limit: 1000,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      })
      if (error) throw error
      if (!data || data.length === 0) break
      for (const item of data) {
        const path = dir ? `${dir}/${item.name}` : item.name
        if (item.id === null) {
          stack.push(path)
        } else {
          out.push(path)
        }
      }
      if (data.length < 1000) break
      offset += data.length
    }
  }
  return out
}

async function processOne(path: string, work: string): Promise<{ before: number; after: number; skipped: boolean }> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path)
  if (error || !data) throw new Error(`download ${path}: ${error?.message}`)
  const buf = Buffer.from(await data.arrayBuffer())
  const before = buf.length

  if (before < SKIP_BELOW_BYTES) {
    return { before, after: before, skipped: true }
  }

  const ext = (path.split('.').pop() || 'jpg').toLowerCase()
  const isImage = ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp'].includes(ext)
  if (!isImage) return { before, after: before, skipped: true }

  const inPath = join(work, `in-${randomUUID()}.${ext}`)
  const outPath = join(work, `out-${randomUUID()}.jpg`)
  await writeFile(inPath, buf)

  await run('sips', [
    '-s', 'format', 'jpeg',
    '-s', 'formatOptions', String(QUALITY),
    '-Z', String(MAX_DIM),
    inPath,
    '--out', outPath,
  ])

  const resized = await readFile(outPath)
  await rm(inPath, { force: true })
  await rm(outPath, { force: true })

  if (resized.length >= before) {
    return { before, after: before, skipped: true }
  }

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, resized, {
      contentType: 'image/jpeg',
      upsert: true,
      cacheControl: '3600',
    })
  if (upErr) throw new Error(`upload ${path}: ${upErr.message}`)

  return { before, after: resized.length, skipped: false }
}

async function main() {
  const work = join(tmpdir(), `laundry-resize-${randomUUID()}`)
  await mkdir(work, { recursive: true })

  console.log(`Listing objects in bucket "${BUCKET}"...`)
  const paths = await listAll()
  console.log(`Found ${paths.length} objects.`)

  let totalBefore = 0
  let totalAfter = 0
  let resizedCount = 0
  let skippedCount = 0
  const failures: Array<{ path: string; err: string }> = []

  for (let i = 0; i < paths.length; i++) {
    const path = paths[i]
    try {
      const { before, after, skipped } = await processOne(path, work)
      totalBefore += before
      totalAfter += after
      if (skipped) {
        skippedCount++
      } else {
        resizedCount++
      }
      const tag = skipped ? 'skip' : `${fmtBytes(before)} -> ${fmtBytes(after)}`
      console.log(`[${i + 1}/${paths.length}] ${path}  ${tag}`)
    } catch (e: any) {
      failures.push({ path, err: e.message })
      console.error(`[${i + 1}/${paths.length}] ${path}  FAIL ${e.message}`)
    }
  }

  await rm(work, { recursive: true, force: true })

  console.log('\n— SUMMARY —')
  console.log(`Resized: ${resizedCount}`)
  console.log(`Skipped: ${skippedCount}`)
  console.log(`Failed:  ${failures.length}`)
  console.log(`Before:  ${fmtBytes(totalBefore)}`)
  console.log(`After:   ${fmtBytes(totalAfter)}`)
  console.log(`Saved:   ${fmtBytes(totalBefore - totalAfter)}`)
  if (failures.length) {
    console.log('\nFailures:')
    for (const f of failures) console.log(`  ${f.path}  ${f.err}`)
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
