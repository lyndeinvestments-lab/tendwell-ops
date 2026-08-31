// Shared internals for the MCP server (api/mcp/*).
//
// Speaks MCP over Streamable HTTP / JSON-RPC 2.0 directly rather than pulling
// in @modelcontextprotocol/sdk — the surface needed (initialize, tools/list,
// tools/call) is small, and the serverless bundle stays lean. Note this is the
// SERVER side; api/trellis/_sync-core.ts is the same protocol in the other
// direction, with Tendwell as a client of Trellis.
//
// Auth is OAuth 2.1 with PKCE and Dynamic Client Registration, because that is
// the only credential a claude.ai / Cowork custom connector can be given: the
// connector UI has no bearer-token field. Tokens are stored sha256-hashed only,
// exactly like api_keys.
//
// Protocol reference: https://modelcontextprotocol.io

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { sbFetch } from '../issues/_lib.js'

// ─── Protocol version ───────────────────────────────────────────────────────
//
// MCP has two eras (spec 2026-07-28 "Versioning and Compatibility"):
//   • LEGACY  — a session established by an `initialize` handshake. Revisions
//               2025-11-25 and earlier. This is what we implement.
//   • MODERN  — stateless, with the version declared per request in `_meta`
//               under `io.modelcontextprotocol/protocolVersion`. 2026-07-28+.
//
// We are a legacy-era server and say so honestly: `supportedVersions` lists
// only revisions we actually serve, so a dual-era client negotiates DOWN to one
// of them rather than being told we speak a modern revision we haven't built.
//
// Critically, an unrecognised version must NEVER fail the request on the header
// alone. A blanket 400 here is what broke Claude's connector: the probe never
// reached the 401 that advertises our OAuth metadata, so "Connect to the
// server" failed and discovery was skipped entirely. A legacy server that
// rejects a newer header also denies a dual-era client its documented fallback
// path, which is to send `initialize` after a non-modern 4xx.
export const MCP_SUPPORTED_PROTOCOL_VERSIONS = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
] as const

/** Newest revision we serve — what `initialize` answers with when the client asks for something we don't know. */
export const MCP_DEFAULT_PROTOCOL_VERSION = '2025-11-25'

/** `_meta` key carrying the per-request protocol version in the modern era. */
export const META_PROTOCOL_VERSION_KEY = 'io.modelcontextprotocol/protocolVersion'

export function isSupportedProtocolVersion(v: string | undefined | null): boolean {
  if (!v) return false
  return (MCP_SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(v)
}

/**
 * Pull the declared protocol version out of a request's `_meta`, which is how
 * modern clients version each call.
 */
export function protocolVersionFromParams(params: unknown): string | undefined {
  if (!params || typeof params !== 'object') return undefined
  const meta = (params as { _meta?: unknown })._meta
  if (!meta || typeof meta !== 'object') return undefined
  const v = (meta as Record<string, unknown>)[META_PROTOCOL_VERSION_KEY]
  return typeof v === 'string' ? v : undefined
}

export const MCP_SERVER_NAME = 'tendwell-ops-crm'
export const MCP_SERVER_VERSION = '1.0.0'

// ─── JSON-RPC 2.0 ───────────────────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: unknown
}

export interface JsonRpcSuccess {
  jsonrpc: '2.0'
  id: string | number | null
  result: unknown
}

export interface JsonRpcError {
  jsonrpc: '2.0'
  id: string | number | null
  error: { code: number; message: string; data?: unknown }
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError

export const JSON_RPC_ERRORS = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  // Spec-defined: UnsupportedProtocolVersionError. Carries
  // `data: { supported, requested }` so a client can retry on a mutually
  // supported revision instead of giving up.
  unsupportedProtocolVersion: -32022,
  // App-defined
  unauthorized: -32001,
  forbidden: -32002,
} as const

// ─── Scopes ─────────────────────────────────────────────────────────────────
// Two scopes, not ten. This connector exists to read the CRM and write
// interactions/stages; slicing it finer would be ceremony for a single-operator
// business. `crm:read` is the default when a client requests nothing.

export const MCP_SCOPES = ['crm:read', 'crm:write'] as const
export type McpScope = (typeof MCP_SCOPES)[number]
const MCP_SCOPE_SET = new Set<string>(MCP_SCOPES)

export const MCP_SCOPE_DESCRIPTIONS: Record<McpScope, string> = {
  'crm:read':
    'Read your clients, their properties and value, interaction history, and what needs attention.',
  'crm:write':
    'Log meetings and calls, move clients and properties between stages, and set follow-ups.',
}

/**
 * Parse a space-separated scope string. Unknown scopes are dropped rather than
 * rejected (RFC 6749 §3.3 lets the server issue a narrower set than asked for).
 *
 * When a client asks for nothing, we default to the FULL set rather than
 * read-only. That looks like the less cautious choice and isn't, because the
 * real gate is the consent screen: it renders the scopes out of the signed
 * state, so whatever we default to is enumerated for the user before they press
 * Allow — there is no silent escalation. Defaulting to read-only instead
 * produced a connector that added successfully and then failed the first time
 * it tried to log a meeting, with no scope field anywhere in Claude's UI for
 * the user to correct it. A client that genuinely wants read-only can still ask
 * for exactly `crm:read` and we honour it.
 */
export function parseScopeParam(raw: string | null | undefined): McpScope[] {
  if (!raw) return [...MCP_SCOPES]
  const accepted = raw
    .split(/\s+/)
    .map(s => s.trim())
    .filter((s): s is McpScope => MCP_SCOPE_SET.has(s))
  return accepted.length > 0 ? Array.from(new Set(accepted)) : [...MCP_SCOPES]
}

// ─── Secrets: generation, hashing, PKCE ─────────────────────────────────────

export const ACCESS_PREFIX = 'twl_mcp_'
export const REFRESH_PREFIX = 'twl_mcp_ref_'
export const CODE_PREFIX = 'twl_mcp_code_'
export const CLIENT_PREFIX = 'twl_mcp_client_'

export function hashSecret(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

function generate(prefix: string, bytes = 32): { raw: string; hash: string } {
  const raw = `${prefix}${randomBytes(bytes).toString('base64url')}`
  return { raw, hash: hashSecret(raw) }
}

export const generateAccessToken = () => generate(ACCESS_PREFIX)
export const generateRefreshToken = () => generate(REFRESH_PREFIX)
export const generateAuthorizationCode = () => generate(CODE_PREFIX)
export const generateClientId = () => `${CLIENT_PREFIX}${randomBytes(16).toString('base64url')}`

/**
 * True iff the bearer is shaped like one of our access tokens. Cheap shape
 * check before touching the database. Order matters: the refresh/code/client
 * prefixes all begin with ACCESS_PREFIX, so they must be excluded explicitly.
 */
export function looksLikeAccessToken(raw: string): boolean {
  if (!raw.startsWith(ACCESS_PREFIX)) return false
  if (raw.startsWith(REFRESH_PREFIX)) return false
  if (raw.startsWith(CODE_PREFIX)) return false
  if (raw.startsWith(CLIENT_PREFIX)) return false
  return /^[A-Za-z0-9_-]{30,90}$/.test(raw.slice(ACCESS_PREFIX.length))
}

/** PKCE S256: base64url(sha256(verifier)) === challenge, compared in constant time. */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  if (!verifier || !challenge) return false
  const computed = createHash('sha256').update(verifier).digest('base64url')
  const a = Buffer.from(computed)
  const b = Buffer.from(challenge)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

// ─── Signed consent state ───────────────────────────────────────────────────
// The consent screen round-trips the authorization request through the browser.
// Signing it means the client_id, redirect_uri, scopes, and PKCE challenge
// cannot be tampered with between display and approval.

const CONSENT_STATE_TTL_MS = 10 * 60 * 1000

function consentSigningKey(): Buffer {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  // Never fall back to a constant — refuse to sign rather than mint a
  // forgeable consent state.
  if (!k) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — cannot sign MCP consent state')
  return Buffer.from(k)
}

export interface ConsentState {
  /** client_id */
  c: string
  /** redirect_uri */
  r: string
  /** scopes */
  s: McpScope[]
  /** PKCE code_challenge (S256) */
  cc: string
  /** the client's `state`, echoed back verbatim */
  st: string | null
  /** issued-at, ms */
  iat: number
}

export function signConsentState(payload: Omit<ConsentState, 'iat'>): string {
  const body: ConsentState = { ...payload, iat: Date.now() }
  const b64 = Buffer.from(JSON.stringify(body)).toString('base64url')
  const sig = createHmac('sha256', consentSigningKey()).update(b64).digest('base64url')
  return `${b64}.${sig}`
}

export function verifyConsentState(token: string | undefined | null): ConsentState | null {
  if (!token || typeof token !== 'string') return null
  const [b64, sig] = token.split('.')
  if (!b64 || !sig) return null
  const expected = createHmac('sha256', consentSigningKey()).update(b64).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const parsed = JSON.parse(Buffer.from(b64, 'base64url').toString('utf-8')) as ConsentState
    if (typeof parsed.iat !== 'number') return null
    if (Date.now() - parsed.iat > CONSENT_STATE_TTL_MS) return null
    return parsed
  } catch {
    return null
  }
}

// ─── Public origin ──────────────────────────────────────────────────────────
// Discovery metadata must advertise absolute URLs. Prefer an explicit env
// override; otherwise derive from the forwarded host Vercel sets.

export function publicOrigin(req: VercelRequest): string {
  const explicit = process.env.MCP_PUBLIC_ORIGIN || process.env.PUBLIC_ORIGIN
  if (explicit) return explicit.replace(/\/+$/, '')
  const host =
    (req.headers['x-forwarded-host'] as string | undefined) ||
    (req.headers.host as string | undefined) ||
    'localhost:3000'
  const proto =
    (req.headers['x-forwarded-proto'] as string | undefined) ||
    (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

// ─── OAuth store (service-role REST) ───────────────────────────────────────

export interface OauthClient {
  id: string
  client_id: string
  client_name: string | null
  redirect_uris: string[]
  scopes: string[]
  token_endpoint_auth_method: string
  revoked_at: string | null
}

export interface OauthCode {
  id: string
  client_id: string
  subject_email: string
  scopes: string[]
  redirect_uri: string
  code_challenge: string
  code_challenge_method: string
  expires_at: string
  consumed_at: string | null
}

export interface OauthToken {
  id: string
  token_type: 'access' | 'refresh'
  client_id: string
  subject_email: string
  scopes: string[]
  paired_token_id: string | null
  expires_at: string
  revoked_at: string | null
}

const AUTH_CODE_TTL_MS = 5 * 60 * 1000
export const ACCESS_TTL_SEC = 60 * 60           // 1 hour
const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000 // 90 days

export async function insertClient(input: {
  client_id: string
  client_name: string | null
  redirect_uris: string[]
  scopes: McpScope[]
}): Promise<OauthClient | null> {
  const rows = await sbFetch<OauthClient[]>('mcp_oauth_clients', {
    method: 'POST',
    body: JSON.stringify({ ...input, token_endpoint_auth_method: 'none' }),
  })
  return rows?.[0] ?? null
}

export async function loadClient(clientId: string): Promise<OauthClient | null> {
  if (!clientId) return null
  const rows = await sbFetch<OauthClient[]>(
    `mcp_oauth_clients?client_id=eq.${encodeURIComponent(clientId)}&limit=1`,
  )
  const c = rows?.[0]
  if (!c || c.revoked_at) return null
  return c
}

export async function insertAuthorizationCode(input: {
  rawCode: string
  client_id: string
  subject_email: string
  scopes: McpScope[]
  redirect_uri: string
  code_challenge: string
}): Promise<boolean> {
  try {
    await sbFetch('mcp_oauth_authorization_codes', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        code_hash: hashSecret(input.rawCode),
        client_id: input.client_id,
        subject_email: input.subject_email,
        scopes: input.scopes,
        redirect_uri: input.redirect_uri,
        code_challenge: input.code_challenge,
        code_challenge_method: 'S256',
        expires_at: new Date(Date.now() + AUTH_CODE_TTL_MS).toISOString(),
      }),
    })
    return true
  } catch {
    return false
  }
}

/**
 * Single-use consume. The `consumed_at=is.null` filter makes the UPDATE itself
 * the gate: a replayed code updates zero rows and returns null, so a stolen
 * code cannot be exchanged twice.
 */
export async function consumeAuthorizationCode(rawCode: string): Promise<OauthCode | null> {
  const hash = hashSecret(rawCode)
  let rows: OauthCode[]
  try {
    rows = await sbFetch<OauthCode[]>(
      `mcp_oauth_authorization_codes?code_hash=eq.${hash}&consumed_at=is.null`,
      { method: 'PATCH', body: JSON.stringify({ consumed_at: new Date().toISOString() }) },
    )
  } catch {
    return null
  }
  const code = rows?.[0]
  if (!code) return null
  if (new Date(code.expires_at).getTime() < Date.now()) return null
  return code
}

export async function issueTokenPair(input: {
  client_id: string
  subject_email: string
  scopes: string[]
}): Promise<{ access: string; refresh: string; expires_in: number } | null> {
  const access = generateAccessToken()
  const refresh = generateRefreshToken()
  const now = Date.now()
  try {
    // Refresh first so the access row can point at it. If the second insert
    // fails, the orphan refresh token is harmless — it grants nothing on its
    // own and the purge function collects it.
    const refreshRows = await sbFetch<OauthToken[]>('mcp_oauth_tokens', {
      method: 'POST',
      body: JSON.stringify({
        token_hash: refresh.hash,
        token_type: 'refresh',
        client_id: input.client_id,
        subject_email: input.subject_email,
        scopes: input.scopes,
        expires_at: new Date(now + REFRESH_TTL_MS).toISOString(),
      }),
    })
    const refreshId = refreshRows?.[0]?.id ?? null
    await sbFetch('mcp_oauth_tokens', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        token_hash: access.hash,
        token_type: 'access',
        client_id: input.client_id,
        subject_email: input.subject_email,
        scopes: input.scopes,
        paired_token_id: refreshId,
        expires_at: new Date(now + ACCESS_TTL_SEC * 1000).toISOString(),
      }),
    })
    return { access: access.raw, refresh: refresh.raw, expires_in: ACCESS_TTL_SEC }
  } catch {
    return null
  }
}

export async function loadToken(
  raw: string,
  type: 'access' | 'refresh',
): Promise<OauthToken | null> {
  let rows: OauthToken[]
  try {
    rows = await sbFetch<OauthToken[]>(
      `mcp_oauth_tokens?token_hash=eq.${hashSecret(raw)}&token_type=eq.${type}&limit=1`,
    )
  } catch {
    return null
  }
  const t = rows?.[0]
  if (!t || t.revoked_at) return null
  if (new Date(t.expires_at).getTime() < Date.now()) return null
  return t
}

/** Revoke a token and its pair. Best-effort — never throws into the response. */
export async function revokeToken(raw: string): Promise<void> {
  const hash = hashSecret(raw)
  const at = new Date().toISOString()
  try {
    const rows = await sbFetch<OauthToken[]>(`mcp_oauth_tokens?token_hash=eq.${hash}`, {
      method: 'PATCH',
      body: JSON.stringify({ revoked_at: at }),
    })
    const tok = rows?.[0]
    if (!tok) return
    // RFC 7009: revoking a refresh token SHOULD revoke the paired access token.
    // Cover both directions of the pairing.
    if (tok.paired_token_id) {
      await sbFetch(`mcp_oauth_tokens?id=eq.${tok.paired_token_id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ revoked_at: at }),
      })
    }
    await sbFetch(`mcp_oauth_tokens?paired_token_id=eq.${tok.id}&revoked_at=is.null`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ revoked_at: at }),
    })
  } catch {
    /* revocation is best-effort; RFC 7009 says respond 200 regardless */
  }
}

function touchToken(id: string): void {
  // Fire-and-forget: last_used_at is telemetry, not a gate.
  sbFetch(`mcp_oauth_tokens?id=eq.${id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ last_used_at: new Date().toISOString() }),
  }).catch(() => {})
}

// ─── Staff identity ─────────────────────────────────────────────────────────

export interface StaffUser {
  email: string
  role: string
  label: string | null
}

/**
 * Resolve a staff user by email. Called on every MCP request rather than
 * trusted from the token, so removing someone in Settings → Users kills their
 * connector immediately instead of at token expiry.
 */
export async function loadStaff(email: string): Promise<StaffUser | null> {
  if (!email) return null
  try {
    const rows = await sbFetch<Array<{ google_email: string | null; role: string; label: string | null }>>(
      `app_users?google_email=eq.${encodeURIComponent(email)}&select=google_email,role,label&limit=1`,
    )
    const u = rows?.[0]
    if (!u || !u.google_email) return null
    return { email: u.google_email, role: u.role, label: u.label }
  } catch {
    return null
  }
}

// ─── Request authentication ─────────────────────────────────────────────────

export interface McpContext {
  subjectEmail: string
  role: string
  label: string | null
  scopes: string[]
  clientId: string
}

export type AuthOutcome =
  | { ok: true; ctx: McpContext }
  | { ok: false; status: number; error: string; description: string }

function bearerFrom(req: VercelRequest): string | null {
  const h = req.headers.authorization
  if (!h || typeof h !== 'string') return null
  if (!h.startsWith('Bearer ')) return null
  const raw = h.slice(7).trim()
  return raw || null
}

export async function authenticate(req: VercelRequest): Promise<AuthOutcome> {
  const raw = bearerFrom(req)
  if (!raw) {
    return { ok: false, status: 401, error: 'invalid_token', description: 'Missing bearer token' }
  }
  if (!looksLikeAccessToken(raw)) {
    return { ok: false, status: 401, error: 'invalid_token', description: 'Malformed access token' }
  }
  const tok = await loadToken(raw, 'access')
  if (!tok) {
    return {
      ok: false,
      status: 401,
      error: 'invalid_token',
      description: 'Access token is unknown, expired, or revoked',
    }
  }
  // Identity is re-resolved every call — see loadStaff.
  const staff = await loadStaff(tok.subject_email)
  if (!staff) {
    return {
      ok: false,
      status: 403,
      error: 'insufficient_scope',
      description: 'The user this token was issued to is no longer an active staff account',
    }
  }
  // The CRM is admin/viewer territory in this app (see VIEW_ACCESS for
  // `contacts`), so a cleaner's or inspector's token must not drive it.
  if (staff.role !== 'admin' && staff.role !== 'viewer') {
    return {
      ok: false,
      status: 403,
      error: 'insufficient_scope',
      description: `Role "${staff.role}" cannot access the CRM`,
    }
  }
  touchToken(tok.id)
  return {
    ok: true,
    ctx: {
      subjectEmail: staff.email,
      role: staff.role,
      label: staff.label,
      scopes: tok.scopes ?? [],
      clientId: tok.client_id,
    },
  }
}

export function hasScope(ctx: McpContext, needed: McpScope): boolean {
  if (ctx.scopes.includes(needed)) return true
  // crm:write implies crm:read — a connector granted write should not have to
  // ask for both just to read back what it wrote.
  if (needed === 'crm:read' && ctx.scopes.includes('crm:write')) return true
  return false
}

// ─── CORS ───────────────────────────────────────────────────────────────────
// Claude's remote MCP client opens the connection from the browser, so CORS is
// required. Mirror the request Origin rather than sending `*` so browsers will
// actually attach the Authorization header. Mcp-Session-Id and
// MCP-Protocol-Version are part of the Streamable HTTP handshake and must be
// both accepted on requests and exposed on responses.

const ALLOWED_HEADERS =
  'Authorization, Content-Type, Accept, Mcp-Session-Id, MCP-Session-Id, MCP-Protocol-Version, Last-Event-ID'
const EXPOSED_HEADERS =
  'Mcp-Session-Id, MCP-Session-Id, MCP-Protocol-Version, WWW-Authenticate'

export function applyCors(req: VercelRequest, res: VercelResponse): void {
  const origin = (req.headers.origin as string | undefined) ?? '*'
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS)
  res.setHeader('Access-Control-Expose-Headers', EXPOSED_HEADERS)
  res.setHeader('Access-Control-Max-Age', '600')
  res.setHeader('Vary', 'Origin')
}

/**
 * 401 with the WWW-Authenticate hint pointing at our protected-resource
 * metadata. This is what makes a Claude connector discover the OAuth endpoints
 * and start the flow rather than simply failing.
 */
export function unauthorized(
  req: VercelRequest,
  res: VercelResponse,
  error: string,
  description: string,
  status = 401,
): void {
  const origin = publicOrigin(req)
  res.setHeader(
    'WWW-Authenticate',
    `Bearer realm="${MCP_SERVER_NAME}", error="${error}", error_description="${description}", ` +
      `resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
  )
  res.status(status).json({ error, error_description: description })
}
