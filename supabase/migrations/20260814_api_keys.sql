-- ═══════════════════════════════════════════════════════════════════════════════
-- API keys: in-app, scoped credentials for external integrations
-- ═══════════════════════════════════════════════════════════════════════════════
-- Lets an admin mint named API keys in Settings → API Keys, choose exactly
-- which scopes (areas/operations) each key may use, copy the value once, and
-- revoke it later. Keys authenticate the server-side, API-key-gated endpoints
-- (today: /api/issues, /api/issues/[id]) via the `x-api-key` header.
--
-- Security model:
--   • Only a SHA-256 *hash* of the key is stored (hex). The plaintext value is
--     shown to the admin exactly once, at creation time, and never again.
--   • `key_prefix` is the first few chars (incl. the `twk_` prefix) kept in the
--     clear so the UI can identify a key in a list without revealing it.
--   • `scopes` is the allow-list of operations the key may perform. The server
--     rejects any request whose required scope isn't present.
--   • The table is admin-only from the client (RLS). The service role (used by
--     the server endpoints to verify a presented key) bypasses RLS.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  key_prefix   text NOT NULL,
  key_hash     text NOT NULL UNIQUE,
  scopes       text[] NOT NULL DEFAULT '{}',
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz,
  expires_at   timestamptz
);

-- Fast lookup by hash on every authenticated API request (unique already
-- creates an index, but be explicit for revoked/active filtering too).
CREATE INDEX IF NOT EXISTS api_keys_active_idx
  ON public.api_keys (key_hash)
  WHERE revoked_at IS NULL;

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

-- Admin-only management from authenticated clients. The service role bypasses
-- RLS entirely, so the server can still verify presented keys.
DROP POLICY IF EXISTS "api_keys_select_admin" ON public.api_keys;
CREATE POLICY "api_keys_select_admin"
  ON public.api_keys FOR SELECT TO authenticated
  USING (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "api_keys_insert_admin" ON public.api_keys;
CREATE POLICY "api_keys_insert_admin"
  ON public.api_keys FOR INSERT TO authenticated
  WITH CHECK (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "api_keys_update_admin" ON public.api_keys;
CREATE POLICY "api_keys_update_admin"
  ON public.api_keys FOR UPDATE TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "api_keys_delete_admin" ON public.api_keys;
CREATE POLICY "api_keys_delete_admin"
  ON public.api_keys FOR DELETE TO authenticated
  USING (public.current_user_role() = 'admin');
