import { describe, it, expect } from 'vitest'
import { fetchAllRows } from './_lib.js'

// The bug this guards: PostgREST caps responses at db-max-rows (1000 on
// Supabase) and signals it only in a header, so an unpaginated select returns
// a truncated body with error === null. loadEngineContext hit this on invoice
// run "Test 1" — its ±14d task window held 2,254 breezeway_tasks, the engine
// received 1,000, and 103 lines were flagged `unmatched_task` against cleans
// that were sitting in the table the whole time.

interface Row {
  n: number
}

/** Stands in for a PostgREST query builder: serves `total` rows, never more
 *  than `cap` per request — exactly how the real cap behaves. */
function fakeTable(total: number, cap = 1000) {
  const calls: Array<[number, number]> = []
  const build = () => ({
    range: (from: number, to: number) => {
      calls.push([from, to])
      const end = Math.min(to, from + cap - 1, total - 1)
      const rows: Row[] = []
      for (let i = from; i <= end; i++) rows.push({ n: i })
      return Promise.resolve({ data: rows, error: null })
    },
  })
  return { build, calls }
}

describe('fetchAllRows', () => {
  it('returns every row when the table exceeds one page', async () => {
    const { build, calls } = fakeTable(2254)
    const rows = await fetchAllRows<Row>('t', build, 'n')
    expect(rows).toHaveLength(2254)
    expect(rows[0].n).toBe(0)
    expect(rows[2253].n).toBe(2253)
    // No duplicates or gaps — the failure mode of an unstable sort.
    expect(new Set(rows.map(r => r.n)).size).toBe(2254)
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
  })

  it('stops after one request when the table fits in a page', async () => {
    const { build, calls } = fakeTable(367)
    expect(await fetchAllRows<Row>('t', build, 'n')).toHaveLength(367)
    expect(calls).toHaveLength(1)
  })

  it('handles an empty table', async () => {
    const { build, calls } = fakeTable(0)
    expect(await fetchAllRows<Row>('t', build, 'n')).toEqual([])
    expect(calls).toHaveLength(1)
  })

  it('makes a second request on an exact-multiple boundary', async () => {
    // 1000 rows is indistinguishable from "1000 and truncated" without asking
    // again, so the extra empty request is required for correctness.
    const { build, calls } = fakeTable(2000)
    expect(await fetchAllRows<Row>('t', build, 'n')).toHaveLength(2000)
    expect(calls).toHaveLength(3)
  })

  it('surfaces an error instead of returning a short result', async () => {
    const build = () => ({
      range: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
    })
    await expect(fetchAllRows<Row>('breezeway_tasks', build, 'external_id')).rejects.toThrow(
      /Failed to load breezeway_tasks: boom/,
    )
  })

  it('refuses to loop forever if pages never shorten', async () => {
    // A server that always returns a full page (misconfigured cap, buggy view)
    // would otherwise spin until the function times out.
    const build = () => ({
      range: (from: number, to: number) => {
        const rows: Row[] = []
        for (let i = from; i <= to; i++) rows.push({ n: i })
        return Promise.resolve({ data: rows, error: null })
      },
    })
    await expect(fetchAllRows<Row>('t', build, 'n')).rejects.toThrow(/Refusing to page past/)
  })
})
