-- OAuth 2.1 authorization server for the MCP endpoint (/api/mcp).
--
-- Why OAuth and not the existing api_keys table: a claude.ai / Claude Cowork
-- custom connector has no field for a bearer token or API key. The only
-- credential the connector UI accepts is an OAuth Client ID + Secret, and it
-- performs Dynamic Client Registration (RFC 7591) against the server's
-- discovery document when none is supplied. So a remote MCP server that Cowork
-- can add must speak OAuth. (The `authorization_token` shortcut in Anthropic's
-- docs belongs to the Messages API MCP connector, which is a different,
-- programmatic surface — not the connector UI.)
--
-- Note this is the opposite direction from api/qbo/callback.ts, where Tendwell
-- is an OAuth *client* of QuickBooks. Here Tendwell is the *server*.
--
-- Design mirrors api_keys: only sha256 hashes are stored, never a raw secret.
-- Clients are public (token_endpoint_auth_method = 'none') and PKCE S256 is
-- mandatory, which is what OAuth 2.1 requires of a public client and removes
-- the need to store a client secret at all.
--
-- All three tables are service-role only. There is deliberately no RLS policy
-- granting `authenticated` any access: every read and write happens inside the
-- serverless OAuth endpoints using the service key. A signed-in user must never
-- be able to enumerate tokens, and an owner must never see this at all.

-- ─── Registered clients (one row per DCR registration) ──────────────────────
CREATE TABLE IF NOT EXISTS public.mcp_oauth_clients (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                  TEXT NOT NULL UNIQUE,
  client_name                TEXT,
  redirect_uris              TEXT[] NOT NULL DEFAULT '{}',
  scopes                     TEXT[] NOT NULL DEFAULT '{}',
  token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at                 TIMESTAMPTZ
);

-- ─── Authorization codes (short-lived, single-use) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.mcp_oauth_authorization_codes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash             TEXT NOT NULL UNIQUE,
  client_id             TEXT NOT NULL,
  -- The staff email the code was issued to. Email rather than a FK because
  -- that is the identity every other surface in this app resolves against
  -- (app_users.google_email <-> session email).
  subject_email         TEXT NOT NULL,
  scopes                TEXT[] NOT NULL DEFAULT '{}',
  redirect_uri          TEXT NOT NULL,
  code_challenge        TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL DEFAULT 'S256',
  expires_at            TIMESTAMPTZ NOT NULL,
  consumed_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mcp_oauth_codes_expiry_idx
  ON public.mcp_oauth_authorization_codes (expires_at);

-- ─── Access + refresh tokens ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mcp_oauth_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash      TEXT NOT NULL UNIQUE,
  token_type      TEXT NOT NULL CHECK (token_type IN ('access', 'refresh')),
  client_id       TEXT NOT NULL,
  subject_email   TEXT NOT NULL,
  scopes          TEXT[] NOT NULL DEFAULT '{}',
  -- Links an access token to the refresh token issued beside it, so revoking
  -- either kills the pair (RFC 7009: revoking a refresh token SHOULD revoke
  -- the associated access token).
  paired_token_id UUID,
  expires_at      TIMESTAMPTZ NOT NULL,
  last_used_at    TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mcp_oauth_tokens_subject_idx
  ON public.mcp_oauth_tokens (subject_email, token_type);
CREATE INDEX IF NOT EXISTS mcp_oauth_tokens_expiry_idx
  ON public.mcp_oauth_tokens (expires_at) WHERE revoked_at IS NULL;

-- ─── RLS: service role only, no authenticated access at all ─────────────────
ALTER TABLE public.mcp_oauth_clients              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_oauth_authorization_codes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_oauth_tokens               ENABLE ROW LEVEL SECURITY;

-- Deliberately no CREATE POLICY statements: with RLS enabled and no policy,
-- `authenticated` and `anon` get nothing, while the service role bypasses RLS
-- entirely. That is exactly the boundary we want.

REVOKE ALL ON public.mcp_oauth_clients             FROM anon, authenticated;
REVOKE ALL ON public.mcp_oauth_authorization_codes FROM anon, authenticated;
REVOKE ALL ON public.mcp_oauth_tokens              FROM anon, authenticated;

-- ─── Housekeeping: drop expired codes and dead tokens ───────────────────────
-- Codes are useless after 5 minutes and tokens after they expire; keeping them
-- is pure liability.
CREATE OR REPLACE FUNCTION public.mcp_oauth_purge()
RETURNS TABLE (codes_deleted INT, tokens_deleted INT)
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  c INT;
  t INT;
BEGIN
  DELETE FROM public.mcp_oauth_authorization_codes
  WHERE expires_at < now() - INTERVAL '1 day';
  GET DIAGNOSTICS c = ROW_COUNT;

  DELETE FROM public.mcp_oauth_tokens
  WHERE (expires_at < now() - INTERVAL '30 days')
     OR (revoked_at IS NOT NULL AND revoked_at < now() - INTERVAL '30 days');
  GET DIAGNOSTICS t = ROW_COUNT;

  RETURN QUERY SELECT c, t;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.mcp_oauth_purge() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mcp_oauth_purge() TO service_role;

COMMENT ON TABLE public.mcp_oauth_clients IS
  'OAuth 2.1 clients registered via RFC 7591 DCR, so Claude Cowork can add /api/mcp as a custom connector without hand-configuring a client id.';
COMMENT ON TABLE public.mcp_oauth_tokens IS
  'MCP OAuth access + refresh tokens. Only sha256 hashes are stored; service-role access only.';
