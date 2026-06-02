-- Tighten access_audit_log, contact_interactions, and incoming_shipments
-- per the 3 open security PRs (#261, #262, #263) flagging the migrations
-- I wrote on days 3, 4, and 11 of the perf loop.
--
-- Three changes per affected table:
--   1) Split FOR ALL policy into SELECT/INSERT/(UPDATE) for authenticated
--      and DELETE for admin only — so no authenticated user can silently
--      erase audit / interaction / shipment records.
--   2) For attribution columns (revealed_by, created_by): add a BEFORE INSERT
--      trigger that overrides whatever the client supplied with the auth-jwt
--      email. Prevents forgery — client can't masquerade as another user.
--   3) For incoming_shipments (anon submissions): add length CHECK constraints
--      on the free-text columns to limit spam payload size.
--
-- Net effect on the UI: zero — the existing client code never writes the
-- revealed_by / created_by columns (the trigger now auto-populates them);
-- DELETE was never exposed in any UI to non-admin roles; the CHECK limits
-- are far above any realistic legitimate value (sender_name 200 chars,
-- description 2000 chars, etc.).

-- ─── access_audit_log ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "access_audit_log_authenticated" ON public.access_audit_log;

CREATE POLICY "access_audit_log_select_authenticated"
  ON public.access_audit_log
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "access_audit_log_insert_authenticated"
  ON public.access_audit_log
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "access_audit_log_admin_delete"
  ON public.access_audit_log
  FOR DELETE
  TO authenticated
  USING (current_user_role() = 'admin'::text);

-- Force revealed_by to the caller's auth-jwt email, ignoring any client value.
CREATE OR REPLACE FUNCTION public.access_audit_log_set_revealed_by()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.revealed_by := (select auth.jwt()) ->> 'email';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_access_audit_log_set_revealed_by ON public.access_audit_log;
CREATE TRIGGER trg_access_audit_log_set_revealed_by
  BEFORE INSERT ON public.access_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.access_audit_log_set_revealed_by();

-- ─── contact_interactions ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "contact_interactions_authenticated" ON public.contact_interactions;

CREATE POLICY "contact_interactions_select_authenticated"
  ON public.contact_interactions
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "contact_interactions_insert_authenticated"
  ON public.contact_interactions
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "contact_interactions_update_authenticated"
  ON public.contact_interactions
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "contact_interactions_admin_delete"
  ON public.contact_interactions
  FOR DELETE
  TO authenticated
  USING (current_user_role() = 'admin'::text);

-- Force created_by to the caller's auth-jwt email.
CREATE OR REPLACE FUNCTION public.contact_interactions_set_created_by()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.created_by := (select auth.jwt()) ->> 'email';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contact_interactions_set_created_by ON public.contact_interactions;
CREATE TRIGGER trg_contact_interactions_set_created_by
  BEFORE INSERT ON public.contact_interactions
  FOR EACH ROW EXECUTE FUNCTION public.contact_interactions_set_created_by();

-- ─── incoming_shipments ────────────────────────────────────────────────────
-- Keep the existing anon insert policy (public submission form) intact.
DROP POLICY IF EXISTS "incoming_shipments_auth_all" ON public.incoming_shipments;

CREATE POLICY "incoming_shipments_auth_select"
  ON public.incoming_shipments
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "incoming_shipments_auth_update"
  ON public.incoming_shipments
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "incoming_shipments_admin_delete"
  ON public.incoming_shipments
  FOR DELETE
  TO authenticated
  USING (current_user_role() = 'admin'::text);

-- Length caps on the free-text columns (above any realistic legitimate value).
ALTER TABLE public.incoming_shipments
  DROP CONSTRAINT IF EXISTS incoming_shipments_sender_name_len,
  ADD  CONSTRAINT incoming_shipments_sender_name_len   CHECK (char_length(sender_name)   <= 200);
ALTER TABLE public.incoming_shipments
  DROP CONSTRAINT IF EXISTS incoming_shipments_property_name_len,
  ADD  CONSTRAINT incoming_shipments_property_name_len CHECK (char_length(property_name) <= 200);
ALTER TABLE public.incoming_shipments
  DROP CONSTRAINT IF EXISTS incoming_shipments_description_len,
  ADD  CONSTRAINT incoming_shipments_description_len   CHECK (char_length(description)   <= 2000);
ALTER TABLE public.incoming_shipments
  DROP CONSTRAINT IF EXISTS incoming_shipments_tracking_len,
  ADD  CONSTRAINT incoming_shipments_tracking_len      CHECK (tracking_number IS NULL OR char_length(tracking_number) <= 100);
