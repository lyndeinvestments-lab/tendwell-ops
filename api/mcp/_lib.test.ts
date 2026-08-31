import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ACCESS_PREFIX,
  JSON_RPC_ERRORS,
  MCP_DEFAULT_PROTOCOL_VERSION,
  MCP_SUPPORTED_PROTOCOL_VERSIONS,
  META_PROTOCOL_VERSION_KEY,
  isSupportedProtocolVersion,
  protocolVersionFromParams,
  CLIENT_PREFIX,
  CODE_PREFIX,
  MCP_SCOPES,
  REFRESH_PREFIX,
  generateAccessToken,
  generateAuthorizationCode,
  generateClientId,
  generateRefreshToken,
  hasScope,
  hashSecret,
  looksLikeAccessToken,
  parseScopeParam,
  signConsentState,
  verifyConsentState,
  verifyPkceS256,
  type McpContext,
} from './_lib.js'

const ctx = (scopes: string[]): McpContext => ({
  subjectEmail: 'someone@example.com',
  role: 'admin',
  label: 'Someone',
  scopes,
  clientId: 'twl_mcp_client_TEST',
})

const s256 = (v: string) => createHash('sha256').update(v).digest('base64url')

afterEach(() => {
  vi.useRealTimers()
})

describe('parseScopeParam', () => {
  it('falls back to read-only, never write, when nothing is asked for', () => {
    expect(parseScopeParam(undefined)).toEqual(['crm:read'])
    expect(parseScopeParam(null)).toEqual(['crm:read'])
    expect(parseScopeParam('')).toEqual(['crm:read'])
  })

  it('drops unknown scopes rather than rejecting the request (RFC 6749 §3.3)', () => {
    expect(parseScopeParam('crm:read platform:full hr:read')).toEqual(['crm:read'])
  })

  it('falls back to read-only when every requested scope is unknown', () => {
    // The dangerous failure would be defaulting to write here.
    expect(parseScopeParam('admin:everything')).toEqual(['crm:read'])
  })

  it('keeps write when asked for, and de-duplicates', () => {
    expect(parseScopeParam('crm:write')).toEqual(['crm:write'])
    expect(parseScopeParam('crm:read crm:write crm:read')).toEqual(['crm:read', 'crm:write'])
  })

  it('tolerates arbitrary whitespace', () => {
    expect(parseScopeParam('  crm:read\t crm:write \n')).toEqual(['crm:read', 'crm:write'])
  })

  it('only ever returns catalogued scopes', () => {
    for (const s of parseScopeParam('crm:read crm:write nonsense')) {
      expect(MCP_SCOPES as readonly string[]).toContain(s)
    }
  })
})

describe('hasScope', () => {
  it('grants read to a write-only token — write implies read', () => {
    expect(hasScope(ctx(['crm:write']), 'crm:read')).toBe(true)
  })

  it('does NOT grant write to a read-only token', () => {
    expect(hasScope(ctx(['crm:read']), 'crm:write')).toBe(false)
  })

  it('denies everything to a token with no scopes', () => {
    expect(hasScope(ctx([]), 'crm:read')).toBe(false)
    expect(hasScope(ctx([]), 'crm:write')).toBe(false)
  })
})

describe('secret generation and hashing', () => {
  it('hashes deterministically to 64 hex chars', () => {
    expect(hashSecret('abc')).toBe(hashSecret('abc'))
    expect(hashSecret('abc')).toMatch(/^[0-9a-f]{64}$/)
    expect(hashSecret('abc')).not.toBe(hashSecret('abd'))
  })

  it('returns a raw secret alongside its hash, and never the hash as the raw', () => {
    const t = generateAccessToken()
    expect(t.raw.startsWith(ACCESS_PREFIX)).toBe(true)
    expect(t.hash).toBe(hashSecret(t.raw))
    expect(t.hash).not.toBe(t.raw)
  })

  it('never repeats a token', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateAccessToken().raw))
    expect(seen.size).toBe(200)
  })

  it('uses a distinct prefix per secret kind', () => {
    expect(generateRefreshToken().raw.startsWith(REFRESH_PREFIX)).toBe(true)
    expect(generateAuthorizationCode().raw.startsWith(CODE_PREFIX)).toBe(true)
    expect(generateClientId().startsWith(CLIENT_PREFIX)).toBe(true)
  })
})

describe('looksLikeAccessToken', () => {
  it('accepts a real access token', () => {
    expect(looksLikeAccessToken(generateAccessToken().raw)).toBe(true)
  })

  // Every other prefix begins with ACCESS_PREFIX, so a naive startsWith check
  // would let a refresh token or an authorization code be used as a bearer.
  it('rejects the other secret kinds even though they share the prefix', () => {
    expect(looksLikeAccessToken(generateRefreshToken().raw)).toBe(false)
    expect(looksLikeAccessToken(generateAuthorizationCode().raw)).toBe(false)
    expect(looksLikeAccessToken(generateClientId())).toBe(false)
  })

  it('rejects junk', () => {
    expect(looksLikeAccessToken('')).toBe(false)
    expect(looksLikeAccessToken('Bearer something')).toBe(false)
    expect(looksLikeAccessToken('hvn_pat_abc')).toBe(false)
    expect(looksLikeAccessToken(`${ACCESS_PREFIX}short`)).toBe(false)
    expect(
      looksLikeAccessToken(`${ACCESS_PREFIX}has spaces in it aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`),
    ).toBe(false)
  })
})

describe('verifyPkceS256', () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'

  it('accepts a matching verifier/challenge pair', () => {
    expect(verifyPkceS256(verifier, s256(verifier))).toBe(true)
  })

  it('rejects a wrong verifier', () => {
    expect(verifyPkceS256('not-the-verifier', s256(verifier))).toBe(false)
  })

  it('rejects the plain verifier used as its own challenge', () => {
    // i.e. never silently accept code_challenge_method=plain.
    expect(verifyPkceS256(verifier, verifier)).toBe(false)
  })

  it('rejects empty input on either side', () => {
    expect(verifyPkceS256('', s256(verifier))).toBe(false)
    expect(verifyPkceS256(verifier, '')).toBe(false)
  })

  it('rejects a challenge of the wrong length without throwing', () => {
    expect(verifyPkceS256(verifier, 'AAAA')).toBe(false)
  })
})

describe('consent state signing', () => {
  const payload = {
    c: 'twl_mcp_client_TEST',
    r: 'https://claude.ai/api/mcp/auth_callback',
    s: ['crm:read', 'crm:write'] as Array<'crm:read' | 'crm:write'>,
    cc: s256('some-verifier'),
    st: 'client-state-xyz',
  }

  it('round-trips every field', () => {
    const out = verifyConsentState(signConsentState(payload))
    expect(out).not.toBeNull()
    expect(out!.c).toBe(payload.c)
    expect(out!.r).toBe(payload.r)
    expect(out!.s).toEqual(payload.s)
    expect(out!.cc).toBe(payload.cc)
    expect(out!.st).toBe(payload.st)
    expect(typeof out!.iat).toBe('number')
  })

  it('rejects a tampered payload', () => {
    const token = signConsentState(payload)
    const [, sig] = token.split('.')
    // Swap the redirect for an attacker-controlled host, keeping the signature.
    const evil = Buffer.from(
      JSON.stringify({ ...payload, r: 'https://evil.example/callback', iat: Date.now() }),
    ).toString('base64url')
    expect(verifyConsentState(`${evil}.${sig}`)).toBeNull()
  })

  it('rejects a tampered signature', () => {
    const [b64] = signConsentState(payload).split('.')
    expect(verifyConsentState(`${b64}.deadbeef`)).toBeNull()
  })

  it('rejects malformed input', () => {
    expect(verifyConsentState(null)).toBeNull()
    expect(verifyConsentState('')).toBeNull()
    expect(verifyConsentState('nodot')).toBeNull()
    expect(verifyConsentState('.')).toBeNull()
    expect(verifyConsentState('not-base64.not-a-sig')).toBeNull()
  })

  it('expires after 10 minutes', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-31T12:00:00Z'))
    const token = signConsentState(payload)
    expect(verifyConsentState(token)).not.toBeNull()

    vi.setSystemTime(new Date('2026-08-31T12:09:30Z'))
    expect(verifyConsentState(token)).not.toBeNull()

    vi.setSystemTime(new Date('2026-08-31T12:10:30Z'))
    expect(verifyConsentState(token)).toBeNull()
  })
})

// Regression: a stale hardcoded version allowlist that hard-400'd anything
// outside it broke Claude's connector entirely. The 400 landed before
// authentication, so the probe never reached the 401 that advertises our OAuth
// metadata — the connector reported "Connect to the server — 400" and skipped
// discovery. Version handling must therefore be (a) permissive at the transport
// layer and (b) answered with a negotiable error at the JSON-RPC layer.
describe('protocol version negotiation', () => {
  it('advertises only revisions we actually serve, newest first', () => {
    expect([...MCP_SUPPORTED_PROTOCOL_VERSIONS]).toEqual([
      '2025-11-25',
      '2025-06-18',
      '2025-03-26',
    ])
  })

  it('defaults to a version that is itself in the supported list', () => {
    // A default outside the list would make `initialize` answer with a revision
    // we just told the client we do not support.
    expect(isSupportedProtocolVersion(MCP_DEFAULT_PROTOCOL_VERSION)).toBe(true)
  })

  it('recognises supported revisions and rejects others without throwing', () => {
    for (const v of MCP_SUPPORTED_PROTOCOL_VERSIONS) {
      expect(isSupportedProtocolVersion(v), v).toBe(true)
    }
    // Modern-era and future revisions we do not implement.
    for (const v of ['2026-07-28', '2026-01-01', '2025-11-05', 'nonsense', '']) {
      expect(isSupportedProtocolVersion(v), v).toBe(false)
    }
    expect(isSupportedProtocolVersion(null)).toBe(false)
    expect(isSupportedProtocolVersion(undefined)).toBe(false)
  })

  it('reads the per-request version out of _meta the way modern clients send it', () => {
    expect(
      protocolVersionFromParams({ _meta: { [META_PROTOCOL_VERSION_KEY]: '2026-07-28' } }),
    ).toBe('2026-07-28')
  })

  it('returns undefined rather than throwing for every malformed shape', () => {
    expect(protocolVersionFromParams(undefined)).toBeUndefined()
    expect(protocolVersionFromParams(null)).toBeUndefined()
    expect(protocolVersionFromParams('string')).toBeUndefined()
    expect(protocolVersionFromParams({})).toBeUndefined()
    expect(protocolVersionFromParams({ _meta: null })).toBeUndefined()
    expect(protocolVersionFromParams({ _meta: 'nope' })).toBeUndefined()
    expect(protocolVersionFromParams({ _meta: {} })).toBeUndefined()
    // Non-string value must not be passed through as a version.
    expect(protocolVersionFromParams({ _meta: { [META_PROTOCOL_VERSION_KEY]: 42 } })).toBeUndefined()
  })

  it('uses the spec-assigned error code for unsupported versions', () => {
    // -32022 is UnsupportedProtocolVersionError. A generic -32600 gives the
    // client nothing to negotiate with.
    expect(JSON_RPC_ERRORS.unsupportedProtocolVersion).toBe(-32022)
  })
})
