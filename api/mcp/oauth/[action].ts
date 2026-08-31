// OAuth 2.1 authorization server for the MCP endpoint.
//
// One function, five actions (Vercel dynamic segment):
//   POST /api/mcp/oauth/register    RFC 7591 Dynamic Client Registration
//   GET  /api/mcp/oauth/authorize   → redirects to the in-app consent screen
//   POST /api/mcp/oauth/decision    ← consent screen approves/denies
//   POST /api/mcp/oauth/token       authorization_code + refresh_token grants
//   POST /api/mcp/oauth/revoke      RFC 7009
//
// Public clients only (token_endpoint_auth_method = "none") with mandatory
// PKCE S256, which is what OAuth 2.1 requires of a public client and means
// there is no client secret to store or leak.
//
// Note the direction: here Tendwell is the authorization SERVER. api/qbo/callback.ts
// is the opposite — Tendwell as a client of QuickBooks.
//
// The consent step deliberately runs in the app's own UI rather than here: it
// needs the signed-in staff identity, which lives in the browser's Supabase
// session. The signed `state` blob carries the authorization request across
// that hop so nothing in it can be tampered with in between.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  ACCESS_TTL_SEC,
  MCP_SCOPES,
  applyCors,
  consumeAuthorizationCode,
  generateAuthorizationCode,
  generateClientId,
  insertAuthorizationCode,
  insertClient,
  issueTokenPair,
  loadClient,
  loadStaff,
  loadToken,
  parseScopeParam,
  publicOrigin,
  revokeToken,
  signConsentState,
  verifyConsentState,
  verifyPkceS256,
} from '../_lib.js'

// ─── helpers ────────────────────────────────────────────────────────────────

const first = (v: string | string[] | undefined): string | undefined =>
  (Array.isArray(v) ? v[0] : v)?.trim() || undefined

function oauthError(
  res: VercelResponse,
  status: number,
  error: string,
  description: string,
): void {
  res.status(status).json({ error, error_description: description })
}

/**
 * Redirect URIs must be an exact string match against what was registered —
 * no prefix matching, no wildcards. This is the control that stops an attacker
 * who knows a client_id from having a code redirected to their own host.
 */
function redirectAllowed(registered: string[], candidate: string): boolean {
  return registered.some(u => u === candidate)
}

function isSafeRedirect(uri: string): boolean {
  try {
    const u = new URL(uri)
    if (u.protocol === 'https:') return true
    // Loopback over http is permitted for native/dev clients (RFC 8252).
    if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) {
      return true
    }
    return false
  } catch {
    return false
  }
}

function bodyOf(req: VercelRequest): Record<string, unknown> {
  const b = req.body
  if (!b) return {}
  if (typeof b === 'string') {
    // The token endpoint is form-encoded per RFC 6749, but clients vary and
    // some send JSON. Accept either.
    try {
      return JSON.parse(b) as Record<string, unknown>
    } catch {
      return Object.fromEntries(new URLSearchParams(b))
    }
  }
  return b as Record<string, unknown>
}

/** Resolve the consenting user from their Supabase session JWT. */
async function emailFromUserJwt(jwt: string): Promise<string | null> {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey || !jwt) return null
  try {
    const r = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${jwt}` },
    })
    if (!r.ok) return null
    const u = (await r.json()) as { email?: string }
    return u?.email?.toLowerCase() ?? null
  } catch {
    return null
  }
}

// ─── handler ────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res)
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  const action = first(req.query.action as string | string[] | undefined)
  const origin = publicOrigin(req)

  switch (action) {
    // ─── Dynamic Client Registration ──────────────────────────────────────
    // Unauthenticated by design (RFC 7591 open registration). A registration
    // grants nothing until a human approves a consent screen, so an unwanted
    // client row is inert — and this is what lets Claude add the connector
    // without anyone hand-configuring a client id.
    case 'register': {
      if (req.method !== 'POST') return oauthError(res, 405, 'invalid_request', 'POST required')
      const body = bodyOf(req)
      const uris = Array.isArray(body.redirect_uris)
        ? (body.redirect_uris as unknown[]).filter((u): u is string => typeof u === 'string')
        : []
      if (!uris.length) {
        return oauthError(res, 400, 'invalid_redirect_uri', 'redirect_uris is required')
      }
      const bad = uris.filter(u => !isSafeRedirect(u))
      if (bad.length) {
        return oauthError(
          res,
          400,
          'invalid_redirect_uri',
          `redirect_uris must be https (or http loopback): ${bad.join(', ')}`,
        )
      }
      const scopes = parseScopeParam(typeof body.scope === 'string' ? body.scope : null)
      const clientId = generateClientId()
      const created = await insertClient({
        client_id: clientId,
        client_name: typeof body.client_name === 'string' ? body.client_name : null,
        redirect_uris: uris,
        scopes,
      })
      if (!created) return oauthError(res, 500, 'server_error', 'Could not register client')
      res.status(201).json({
        client_id: created.client_id,
        client_name: created.client_name,
        redirect_uris: created.redirect_uris,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        scope: scopes.join(' '),
        client_id_issued_at: Math.floor(Date.now() / 1000),
      })
      return
    }

    // ─── Authorization request → consent screen ───────────────────────────
    case 'authorize': {
      if (req.method !== 'GET') return oauthError(res, 405, 'invalid_request', 'GET required')
      const q = req.query as Record<string, string | string[] | undefined>
      const responseType = first(q.response_type)
      const clientId = first(q.client_id)
      const redirectUri = first(q.redirect_uri)
      const challenge = first(q.code_challenge)
      const challengeMethod = first(q.code_challenge_method) ?? 'plain'
      const state = first(q.state) ?? null
      const scopes = parseScopeParam(first(q.scope))

      if (!clientId) return oauthError(res, 400, 'invalid_request', 'client_id is required')
      const client = await loadClient(clientId)
      if (!client) return oauthError(res, 400, 'invalid_client', 'Unknown or revoked client_id')

      // redirect_uri is validated BEFORE any error is redirected anywhere —
      // otherwise the error response itself becomes an open redirect.
      if (!redirectUri || !redirectAllowed(client.redirect_uris, redirectUri)) {
        return oauthError(
          res,
          400,
          'invalid_redirect_uri',
          'redirect_uri does not exactly match a registered value',
        )
      }

      // From here on, protocol errors go back to the client via the redirect,
      // as RFC 6749 §4.1.2.1 requires.
      const bounce = (error: string, description: string) => {
        const u = new URL(redirectUri)
        u.searchParams.set('error', error)
        u.searchParams.set('error_description', description)
        if (state) u.searchParams.set('state', state)
        res.redirect(302, u.toString())
      }
      if (responseType !== 'code') {
        return bounce('unsupported_response_type', 'Only response_type=code is supported')
      }
      if (!challenge) return bounce('invalid_request', 'PKCE code_challenge is required')
      if (challengeMethod !== 'S256') {
        return bounce('invalid_request', 'code_challenge_method must be S256')
      }

      const signed = signConsentState({
        c: clientId,
        r: redirectUri,
        s: scopes,
        cc: challenge,
        st: state,
      })
      const consent = new URL(`${origin}/mcp/consent`)
      consent.searchParams.set('state', signed)
      res.redirect(302, consent.toString())
      return
    }

    // ─── Consent decision (from the in-app screen) ────────────────────────
    case 'decision': {
      if (req.method !== 'POST') return oauthError(res, 405, 'invalid_request', 'POST required')
      const body = bodyOf(req)
      const parsed = verifyConsentState(typeof body.state === 'string' ? body.state : null)
      if (!parsed) {
        return oauthError(res, 400, 'invalid_request', 'Consent request is invalid or has expired')
      }

      const client = await loadClient(parsed.c)
      if (!client || !redirectAllowed(client.redirect_uris, parsed.r)) {
        return oauthError(res, 400, 'invalid_client', 'Client or redirect_uri is no longer valid')
      }

      // Who is approving? Trust the Supabase session, never the request body.
      const jwt =
        typeof body.access_token === 'string'
          ? body.access_token
          : (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
      const email = await emailFromUserJwt(jwt)
      if (!email) return oauthError(res, 401, 'access_denied', 'Not signed in')
      const staff = await loadStaff(email)
      if (!staff || (staff.role !== 'admin' && staff.role !== 'viewer')) {
        return oauthError(
          res,
          403,
          'access_denied',
          'Your account cannot grant CRM access to a connector',
        )
      }

      const target = new URL(parsed.r)
      if (parsed.st) target.searchParams.set('state', parsed.st)

      if (body.approve !== true) {
        target.searchParams.set('error', 'access_denied')
        target.searchParams.set('error_description', 'The user declined')
        res.status(200).json({ redirect: target.toString() })
        return
      }

      const code = generateAuthorizationCode()
      const stored = await insertAuthorizationCode({
        rawCode: code.raw,
        client_id: parsed.c,
        subject_email: email,
        scopes: parsed.s,
        redirect_uri: parsed.r,
        code_challenge: parsed.cc,
      })
      if (!stored) return oauthError(res, 500, 'server_error', 'Could not issue authorization code')

      target.searchParams.set('code', code.raw)
      res.status(200).json({ redirect: target.toString() })
      return
    }

    // ─── Token endpoint ───────────────────────────────────────────────────
    case 'token': {
      if (req.method !== 'POST') return oauthError(res, 405, 'invalid_request', 'POST required')
      const body = bodyOf(req)
      const grant = typeof body.grant_type === 'string' ? body.grant_type : ''
      res.setHeader('Cache-Control', 'no-store')

      if (grant === 'authorization_code') {
        const rawCode = typeof body.code === 'string' ? body.code : ''
        const verifier = typeof body.code_verifier === 'string' ? body.code_verifier : ''
        const clientId = typeof body.client_id === 'string' ? body.client_id : ''
        const redirectUri = typeof body.redirect_uri === 'string' ? body.redirect_uri : ''
        if (!rawCode || !verifier) {
          return oauthError(res, 400, 'invalid_request', 'code and code_verifier are required')
        }
        // Consume first: the code is single-use even if a later check fails, so
        // a leaked code cannot be retried against different parameters.
        const code = await consumeAuthorizationCode(rawCode)
        if (!code) {
          return oauthError(res, 400, 'invalid_grant', 'Code is unknown, expired, or already used')
        }
        if (clientId && clientId !== code.client_id) {
          return oauthError(res, 400, 'invalid_grant', 'client_id does not match the code')
        }
        if (redirectUri && redirectUri !== code.redirect_uri) {
          return oauthError(res, 400, 'invalid_grant', 'redirect_uri does not match the code')
        }
        if (!verifyPkceS256(verifier, code.code_challenge)) {
          return oauthError(res, 400, 'invalid_grant', 'PKCE verification failed')
        }
        const pair = await issueTokenPair({
          client_id: code.client_id,
          subject_email: code.subject_email,
          scopes: code.scopes,
        })
        if (!pair) return oauthError(res, 500, 'server_error', 'Could not issue tokens')
        res.status(200).json({
          access_token: pair.access,
          refresh_token: pair.refresh,
          token_type: 'Bearer',
          expires_in: pair.expires_in,
          scope: code.scopes.join(' '),
        })
        return
      }

      if (grant === 'refresh_token') {
        const raw = typeof body.refresh_token === 'string' ? body.refresh_token : ''
        if (!raw) return oauthError(res, 400, 'invalid_request', 'refresh_token is required')
        const tok = await loadToken(raw, 'refresh')
        if (!tok) {
          return oauthError(
            res,
            400,
            'invalid_grant',
            'Refresh token is unknown, expired, or revoked',
          )
        }
        // The user must still be active staff — a refresh must not outlive
        // someone's removal from Settings → Users.
        const staff = await loadStaff(tok.subject_email)
        if (!staff || (staff.role !== 'admin' && staff.role !== 'viewer')) {
          await revokeToken(raw)
          return oauthError(res, 400, 'invalid_grant', 'The user is no longer authorized')
        }
        const pair = await issueTokenPair({
          client_id: tok.client_id,
          subject_email: tok.subject_email,
          scopes: tok.scopes,
        })
        if (!pair) return oauthError(res, 500, 'server_error', 'Could not issue tokens')
        // Rotate: the presented refresh token dies along with its old access token.
        await revokeToken(raw)
        res.status(200).json({
          access_token: pair.access,
          refresh_token: pair.refresh,
          token_type: 'Bearer',
          expires_in: pair.expires_in,
          scope: tok.scopes.join(' '),
        })
        return
      }

      return oauthError(
        res,
        400,
        'unsupported_grant_type',
        'Supported grants: authorization_code, refresh_token',
      )
    }

    // ─── Revocation (RFC 7009) ────────────────────────────────────────────
    case 'revoke': {
      if (req.method !== 'POST') return oauthError(res, 405, 'invalid_request', 'POST required')
      const body = bodyOf(req)
      const raw = typeof body.token === 'string' ? body.token : ''
      // RFC 7009: respond 200 whether or not the token existed, so revocation
      // cannot be used to probe which tokens are valid.
      if (raw) await revokeToken(raw)
      res.status(200).json({ ok: true })
      return
    }

    default:
      res.status(404).json({
        error: 'not_found',
        error_description: 'Unknown OAuth action',
        actions: ['register', 'authorize', 'decision', 'token', 'revoke'],
        metadata: `${origin}/.well-known/oauth-authorization-server`,
        scopes_supported: MCP_SCOPES,
        access_token_lifetime_seconds: ACCESS_TTL_SEC,
      })
      return
  }
}
