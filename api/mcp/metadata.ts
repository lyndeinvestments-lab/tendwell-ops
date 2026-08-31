// OAuth discovery documents. Reads and writes nothing — everything here is
// derived from the request's own origin.
//
// Served at two well-known paths via rewrites in vercel.json:
//   /.well-known/oauth-authorization-server   (RFC 8414)
//   /.well-known/oauth-protected-resource     (RFC 9728)
//
// Rewrites are required rather than relying on the SPA catch-all: that rule is
// `/((?!api/|assets/|.*\..*).*)`, which excludes any path containing a dot, so
// `.well-known` would 404 without an explicit mapping.
//
// This document is the whole reason a Claude connector can be added by pasting
// one URL: the 401 from /api/mcp advertises the protected-resource doc, that
// points at the authorization-server doc, and the connector registers itself
// via `registration_endpoint` and runs the flow.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { MCP_SCOPES, applyCors, publicOrigin } from './_lib.js'

export default function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res)
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  const origin = publicOrigin(req)
  // The `doc` query param is set by the rewrite so one function can serve both
  // documents; the URL check is a fallback for a direct hit.
  const doc = (Array.isArray(req.query.doc) ? req.query.doc[0] : req.query.doc) ?? ''
  const wantsResource =
    doc === 'protected-resource' || (req.url ?? '').includes('oauth-protected-resource')

  // Cacheable: these documents only change when the deployment does.
  res.setHeader('Cache-Control', 'public, max-age=300')

  if (wantsResource) {
    res.status(200).json({
      resource: `${origin}/api/mcp`,
      authorization_servers: [origin],
      scopes_supported: MCP_SCOPES,
      bearer_methods_supported: ['header'],
      resource_documentation: `${origin}/api/mcp`,
    })
    return
  }

  res.status(200).json({
    issuer: origin,
    authorization_endpoint: `${origin}/api/mcp/oauth/authorize`,
    token_endpoint: `${origin}/api/mcp/oauth/token`,
    registration_endpoint: `${origin}/api/mcp/oauth/register`,
    revocation_endpoint: `${origin}/api/mcp/oauth/revoke`,
    scopes_supported: MCP_SCOPES,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    // OAuth 2.1: public clients, PKCE S256 only. No secret to store.
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    service_documentation: `${origin}/api/mcp`,
  })
}
