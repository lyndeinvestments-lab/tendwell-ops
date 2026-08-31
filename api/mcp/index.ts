// MCP endpoint — a single HTTPS URL speaking MCP over Streamable HTTP /
// JSON-RPC 2.0, so Claude (Cowork, claude.ai, Claude Code) can use the Tendwell
// CRM without a local proxy.
//
//   POST   /api/mcp   JSON-RPC requests + notifications
//   GET    /api/mcp   capability probe (405 to SSE clients — see below)
//   DELETE /api/mcp   session teardown; we're stateless, so just acknowledge
//
// Auth: `Authorization: Bearer twl_mcp_…`, an OAuth 2.1 access token minted by
// api/mcp/oauth/[action].ts. A 401 from here carries the WWW-Authenticate hint
// pointing a connector at our discovery document, which is what kicks off the
// OAuth flow rather than just failing.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { randomUUID } from 'node:crypto'
import {
  JSON_RPC_ERRORS,
  MCP_SERVER_NAME,
  MCP_SUPPORTED_PROTOCOL_VERSIONS,
  applyCors,
  authenticate,
  publicOrigin,
  unauthorized,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from './_lib.js'
import { dispatch } from './_tools.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res)

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  // Per the Streamable HTTP spec, GET is how a client opens a server-initiated
  // SSE stream. We never push, so say so explicitly and let the client fall
  // back to POST-only mode instead of hanging on a stream that never emits.
  if (req.method === 'GET') {
    const accept = (req.headers.accept as string | undefined) ?? ''
    if (accept.includes('text/event-stream')) {
      res.setHeader('Allow', 'POST, OPTIONS')
      res.status(405).end()
      return
    }
    res.status(200).json({
      server: MCP_SERVER_NAME,
      transport: 'streamable-http',
      protocolVersions: MCP_SUPPORTED_PROTOCOL_VERSIONS,
      authorization: `${publicOrigin(req)}/.well-known/oauth-authorization-server`,
      message:
        'POST JSON-RPC 2.0 here with `Authorization: Bearer twl_mcp_…`. ' +
        'Add this URL as a custom connector in Claude and the OAuth flow runs automatically.',
    })
    return
  }

  if (req.method === 'DELETE') {
    res.status(204).end()
    return
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, GET, DELETE, OPTIONS')
    res.status(405).json({ error: 'method_not_allowed' })
    return
  }

  // NOTE: the MCP-Protocol-Version header is deliberately NOT used to reject the
  // request. This used to 400 on any version outside our list, which broke
  // Claude's connector outright: the 400 landed before authentication, so the
  // probe never saw the 401 that advertises our OAuth metadata and the connector
  // reported "Connect to the server — 400" with discovery skipped.
  //
  // Version handling belongs at the JSON-RPC layer instead (see dispatch), where
  // an unsupported revision returns a spec-shaped UnsupportedProtocolVersionError
  // listing what we do support, so the client can retry on a mutually supported
  // revision. Rejecting on the header alone also denies a dual-era client its
  // documented fallback, which is to send `initialize` after a non-modern 4xx.
  const auth = await authenticate(req)
  if (!auth.ok) {
    unauthorized(req, res, auth.error, auth.description, auth.status)
    return
  }

  // Vercel parses JSON bodies for us, but a client may send text/plain.
  let body: unknown = req.body
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      res.status(400).json({
        jsonrpc: '2.0',
        id: null,
        error: { code: JSON_RPC_ERRORS.parseError, message: 'Invalid JSON' },
      })
      return
    }
  }

  // JSON-RPC 2.0 permits a batch.
  const isBatch = Array.isArray(body)
  const requests = (isBatch ? body : [body]) as JsonRpcRequest[]
  if (!requests.length) {
    res.status(400).json({
      jsonrpc: '2.0',
      id: null,
      error: { code: JSON_RPC_ERRORS.invalidRequest, message: 'Empty batch' },
    })
    return
  }

  const responses: JsonRpcResponse[] = []
  let sawInitialize = false

  for (const r of requests) {
    if (!r || typeof r !== 'object' || r.jsonrpc !== '2.0' || typeof r.method !== 'string') {
      responses.push({
        jsonrpc: '2.0',
        id: (r && typeof r === 'object' && 'id' in r ? (r as JsonRpcRequest).id : null) ?? null,
        error: { code: JSON_RPC_ERRORS.invalidRequest, message: 'Invalid JSON-RPC request' },
      })
      continue
    }
    if (r.method === 'initialize') sawInitialize = true
    try {
      const out = await dispatch(r, auth.ctx)
      if (out) responses.push(out)
    } catch (e) {
      responses.push({
        jsonrpc: '2.0',
        id: r.id ?? null,
        error: {
          code: JSON_RPC_ERRORS.internalError,
          message: e instanceof Error ? e.message : 'Internal error',
        },
      })
    }
  }

  // Notification-only body: the spec wants 202 Accepted with no content. Claude
  // sends `notifications/initialized` as a bare POST and may treat a JSON-RPC
  // reply as a protocol violation.
  if (responses.length === 0) {
    res.status(202).end()
    return
  }

  // Issue an Mcp-Session-Id on initialize. We're stateless, so any opaque UUID
  // works — clients echo it back and we don't validate it — but returning one
  // matters for clients that branch on whether the server declared a session.
  if (sawInitialize) {
    const sid = (req.headers['mcp-session-id'] as string | undefined) ?? randomUUID()
    res.setHeader('Mcp-Session-Id', sid)
  }

  res.status(200).json(isBatch ? responses : responses[0])
}
