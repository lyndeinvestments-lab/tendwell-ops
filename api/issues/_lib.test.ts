import { afterEach, describe, expect, it, vi } from 'vitest'
import { sbFetch } from './_lib.js'

// Regression: sbFetch used to call r.json() unconditionally. A write sent with
// `Prefer: return=minimal` makes PostgREST answer 204 No Content with an empty
// body, and r.json() throws SyntaxError on that — while r.ok is true for 204,
// so the status check above it never fires. The write had actually SUCCEEDED.
//
// This surfaced as the MCP OAuth consent screen failing with "Could not issue
// authorization code": the row was inserted, then parsing the empty response
// threw and the handler reported failure. The same bug silently broke
// logApiWrite in api/data/_lib.ts, where a try/catch hid it.
function mockFetch(res: { status: number; body: string; ok?: boolean }) {
  const spy = vi.fn(async () => ({
    ok: res.ok ?? (res.status >= 200 && res.status < 300),
    status: res.status,
    json: async () => JSON.parse(res.body),
    text: async () => res.body,
  }))
  vi.stubGlobal('fetch', spy)
  return spy
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('sbFetch response handling', () => {
  it('returns undefined for 204 No Content instead of throwing', async () => {
    mockFetch({ status: 204, body: '' })
    await expect(
      sbFetch('mcp_oauth_authorization_codes', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: '{}',
      }),
    ).resolves.toBeUndefined()
  })

  it('returns undefined for a 200 with an empty body', async () => {
    mockFetch({ status: 200, body: '' })
    await expect(sbFetch('anything')).resolves.toBeUndefined()
  })

  it('still parses a normal JSON body', async () => {
    mockFetch({ status: 200, body: '[{"id":"abc"}]' })
    await expect(sbFetch('contacts?select=id')).resolves.toEqual([{ id: 'abc' }])
  })

  it('still parses a 201 representation from an insert', async () => {
    mockFetch({ status: 201, body: '[{"client_id":"twl_mcp_client_x"}]' })
    await expect(sbFetch('mcp_oauth_clients', { method: 'POST', body: '{}' })).resolves.toEqual([
      { client_id: 'twl_mcp_client_x' },
    ])
  })

  it('still throws with the status and body on a non-2xx', async () => {
    mockFetch({ status: 409, body: 'duplicate key value violates unique constraint' })
    await expect(sbFetch('mcp_oauth_clients', { method: 'POST', body: '{}' })).rejects.toThrow(
      /409/,
    )
  })
})
