import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  backoffMs, syncStatusFor, taskRow, makeRunContext, callTrellisTool, SyncDeadlineError, queryAll,
} from './_sync-core'

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('backoffMs', () => {
  it('doubles from 2 s with up to 1 s of jitter', () => {
    expect(backoffMs(0, () => 0)).toBe(2000)
    expect(backoffMs(1, () => 0)).toBe(4000)
    expect(backoffMs(3, () => 0.999)).toBe(16999)
  })
})

describe('syncStatusFor', () => {
  it('records a deadline stop honestly', () => {
    expect(syncStatusFor({ partial: true })).toBe('partial')
    expect(syncStatusFor({ partial: false })).toBe('done')
    expect(syncStatusFor({})).toBe('done')
  })
})

describe('taskRow', () => {
  it('adds the classification columns', () => {
    const row = taskRow({ id: 't1', title: 'Turn Clean', assigned_to_name: 'Tendwell Cleaning Co.', status: 'COMPLETED' }, 'B', new Set())
    expect(row).toMatchObject({ trellis_task_id: 't1', workspace: 'B', clean_kind: 'turn', is_tendwell: true, task_category: 'clean' })
    expect(row).not.toHaveProperty('assignees') // bulk rows never blank cached detail
  })
})

describe('run deadline', () => {
  it('never starts a Trellis call past the deadline', async () => {
    vi.stubEnv('TRELLIS_WORKSPACE_A_KEY', 'a')
    vi.stubEnv('TRELLIS_WORKSPACE_B_KEY', 'b')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const ctx = makeRunContext(Date.now() + 1_000)
    await expect(callTrellisTool('B', 'trellisql_query', {}, ctx)).rejects.toBeInstanceOf(SyncDeadlineError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('keeps the rows already fetched when the deadline stops a query', async () => {
    const page = (rows: unknown[], hasMore: boolean, next: number) => new Response(JSON.stringify({
      jsonrpc: '2.0', id: 1, result: { structuredContent: { ok: true, rows, pagination: { has_more: hasMore, next_offset: next } } },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
    let calls = 0
    const ctx = makeRunContext(Date.now() + 60_000, { minGapMs: 0, jitterMs: 1 })
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++
      if (calls === 2) ctx.deadlineMs = Date.now() // deadline passes after page 2 arrives
      return page([{ id: `t${calls}` }], true, calls)
    }))
    const out: Array<Record<string, unknown>> = []
    await expect(queryAll('k', 'tasks', ['id'], null, 1, ctx, out)).rejects.toBeInstanceOf(SyncDeadlineError)
    expect(out.map(r => r.id)).toEqual(['t1', 't2'])
  })

  it('throws on a tool-level failure instead of reading it as no rows', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      jsonrpc: '2.0', id: 1, result: { structuredContent: { ok: false, error_type: 'MCP_TRELLISQL_VALIDATION', error: "Unsupported TrellisQL filter operator 'neq'." } },
    }), { status: 200, headers: { 'content-type': 'application/json' } })))
    await expect(queryAll('k', 'tasks', ['id'], { x: { neq: 1 } }, 10)).rejects.toThrow(/Unsupported TrellisQL filter operator/)
  })

  it('backs off on 429 but gives up at the deadline instead of sleeping past it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Rate limit exceeded', { status: 429 })))
    const ctx = makeRunContext(Date.now() + 6_000, { minGapMs: 0, jitterMs: 1 })
    const t0 = Date.now()
    await expect(queryAll('k', 'tasks', ['id'], null, 10, ctx)).rejects.toBeInstanceOf(SyncDeadlineError)
    expect(Date.now() - t0).toBeLessThan(1_000)
    expect(ctx.retries429).toBe(1)
  })
})
