-- ═══════════════════════════════════════════════════════════════════════════════
-- Invoicing hardening (post-review follow-up to 20260814_vendor_invoices.sql)
-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Atomic QBO invoice-number allocation — the read-then-update in export.ts
--    could hand two concurrent exports the same number. Single-statement
--    UPDATE ... RETURNING closes the race; unique index makes any residual
--    duplicate a hard error instead of a silent QBO import collision.
-- 2. RLS tightened from is_staff() to admin-only — the /invoicing UI is
--    AdminRoute-gated and endpoints use the service role, but the tables held
--    cleaner-pay/client-billing amounts readable by any staff session via the
--    REST API. Matches the api_keys precedent (current_user_role() = 'admin').

-- ─── 1. Atomic sequence ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.next_qbo_invoice_no()
RETURNS INT
LANGUAGE sql
AS $$
  UPDATE app_settings
     SET value = ((value::int) + 1)::text
   WHERE key = 'invoicing_qbo_next_number'
  RETURNING (value::int) - 1;
$$;

REVOKE ALL ON FUNCTION public.next_qbo_invoice_no() FROM public;
-- Service role bypasses grants; no authenticated/anon execute on purpose.

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_runs_qbo_no_unique
  ON invoice_runs (qbo_invoice_no) WHERE qbo_invoice_no IS NOT NULL;

-- ─── 2. Admin-only RLS ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "vendors_all_staff" ON vendors;
CREATE POLICY "vendors_all_admin"
  ON vendors FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "vendor_property_aliases_all_staff" ON vendor_property_aliases;
CREATE POLICY "vendor_property_aliases_all_admin"
  ON vendor_property_aliases FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "invoice_runs_all_staff" ON invoice_runs;
CREATE POLICY "invoice_runs_all_admin"
  ON invoice_runs FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "invoice_lines_all_staff" ON invoice_lines;
CREATE POLICY "invoice_lines_all_admin"
  ON invoice_lines FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "vendor_invoices_staff_select" ON storage.objects;
CREATE POLICY "vendor_invoices_admin_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'vendor-invoices' AND public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "vendor_invoices_staff_insert" ON storage.objects;
CREATE POLICY "vendor_invoices_admin_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'vendor-invoices' AND public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "vendor_invoices_staff_update" ON storage.objects;
CREATE POLICY "vendor_invoices_admin_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'vendor-invoices' AND public.current_user_role() = 'admin')
  WITH CHECK (bucket_id = 'vendor-invoices' AND public.current_user_role() = 'admin');
