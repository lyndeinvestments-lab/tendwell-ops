// OAuth consent screen for the MCP connector.
//
// api/mcp/oauth/authorize redirects here with a signed `state` blob carrying the
// authorization request. The consent step lives in the app rather than in the
// serverless function because it needs the signed-in staff identity, which is
// in the browser's Supabase session — and because a human approving a grant
// should see the app they're granting access to, not a bare API response.
//
// This page persists nothing. It reads `state` (opaque to it), reads the
// current session, and POSTs the decision to /api/mcp/oauth/decision, which
// mints the authorization code and hands back the redirect to follow.

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { usePageTitle } from '@/hooks/use-page-title'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Loader2, ShieldCheck, TriangleAlert } from 'lucide-react'

interface ConsentPreview {
  scopes: string[]
  redirect_host: string
}

const SCOPE_COPY: Record<string, string> = {
  'crm:read':
    'Read your clients, their properties and value, interaction history, and what needs attention.',
  'crm:write':
    'Log meetings and calls, move clients and properties between stages, and set follow-ups.',
}

/**
 * The state blob is signed, not encrypted — decoding it here is only for
 * display. The server re-verifies the signature before acting, so a tampered
 * payload shown on screen cannot turn into a real grant.
 */
function preview(state: string | null): ConsentPreview | null {
  if (!state) return null
  try {
    const [b64] = state.split('.')
    const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'))
    const json = JSON.parse(
      decodeURIComponent(
        bin
          .split('')
          .map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
          .join(''),
      ),
    ) as { c: string; r: string; s: string[] }
    let host = json.r
    try {
      host = new URL(json.r).host
    } catch {
      /* show the raw value if it isn't a parseable URL */
    }
    return { scopes: json.s ?? [], redirect_host: host }
  } catch {
    return null
  }
}

export default function McpConsentPage() {
  usePageTitle('Connect Claude')
  const { user } = useAuth()

  const params = new URLSearchParams(window.location.search)
  const state = params.get('state')
  const info = preview(state)

  const [submitting, setSubmitting] = useState<'approve' | 'deny' | null>(null)
  const [error, setError] = useState<string | null>(null)
  // AuthUser carries a display label, not the email. Which account is being
  // granted access is security-relevant, so read the real address off the
  // session rather than showing a friendly name.
  const [sessionEmail, setSessionEmail] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setSessionEmail(data.session?.user?.email ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function decide(approve: boolean) {
    setError(null)
    setSubmitting(approve ? 'approve' : 'deny')
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) {
        setError('Your session expired. Reload the page and sign in again.')
        setSubmitting(null)
        return
      }
      const r = await fetch('/api/mcp/oauth/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state, approve, access_token: token }),
      })
      const body = (await r.json()) as {
        redirect?: string
        error_description?: string
        error?: string
      }
      if (!r.ok || !body.redirect) {
        setError(body.error_description || body.error || 'Could not complete the connection.')
        setSubmitting(null)
        return
      }
      // Hand control back to Claude with the code (or the denial).
      window.location.replace(body.redirect)
    } catch {
      setError('Network error — try again.')
      setSubmitting(null)
    }
  }

  // AppLayout already gates the app behind login, so this is belt-and-braces
  // rather than the real guard — but it must not silently render an Allow
  // button for someone with no session to grant.
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="max-w-md w-full border-card-border">
          <CardContent className="p-6 space-y-2">
            <p className="font-medium">Sign in first</p>
            <p className="text-sm text-muted-foreground">
              Sign in to Tendwell Ops, then start the connection again from Claude.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!state || !info) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="max-w-md w-full border-card-border">
          <CardContent className="p-6 space-y-3">
            <div className="flex items-center gap-2 text-warning">
              <TriangleAlert className="w-5 h-5" />
              <p className="font-medium">This link is not valid</p>
            </div>
            <p className="text-sm text-muted-foreground">
              Connection requests expire after 10 minutes. Start again from Claude and you'll be
              sent back here with a fresh link.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Card className="max-w-md w-full border-card-border">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <h1 className="text-lg font-semibold">Connect Claude to Tendwell Ops</h1>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm text-muted-foreground">
            Claude is asking to use your CRM as{' '}
            <span className="font-medium text-foreground">
              {sessionEmail ?? user.label ?? 'your account'}
            </span>
            . It will be able to:
          </p>

          <ul className="space-y-2">
            {info.scopes.map(s => (
              <li key={s} className="text-sm flex gap-2">
                <span className="text-primary mt-0.5">•</span>
                <span>{SCOPE_COPY[s] ?? s}</span>
              </li>
            ))}
          </ul>

          <p className="text-2xs text-muted-foreground">
            Redirects to <span className="font-mono">{info.redirect_host}</span>. Access lasts one
            hour at a time and refreshes automatically; you can revoke it any time by removing the
            connector in Claude. Removing your account in Settings → Users also cuts it off
            immediately.
          </p>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-2 pt-1">
            <Button
              className="flex-1"
              onClick={() => decide(true)}
              disabled={submitting !== null}
              data-testid="mcp-consent-approve"
            >
              {submitting === 'approve' && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Allow
            </Button>
            <Button
              variant="outline"
              onClick={() => decide(false)}
              disabled={submitting !== null}
              data-testid="mcp-consent-deny"
            >
              {submitting === 'deny' && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Deny
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
