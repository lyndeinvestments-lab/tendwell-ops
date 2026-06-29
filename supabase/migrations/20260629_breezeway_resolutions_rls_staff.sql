-- Fix: breezeway_property_resolutions.bpr_read used USING (true) for the
-- `authenticated` role, so owner-portal users (authenticated in Supabase but in
-- property_owners, not app_users) could read every row via the REST API:
-- all Breezeway property_raw strings, their matched/ignored status, the mapped
-- Ops property_id, and the resolved_by staff identifier (CWE-284).
--
-- This table was created on 2026-06-28, AFTER the one-time
-- 20260626_scope_authenticated_rls_to_staff.sql DO-block ran, so it never got
-- swept onto the is_staff() standard. Bring it in line. (The bpr_write policy
-- already gates on current_user_role() = 'admin', so writes were never exposed
-- — this closes the read-side information leak only.)

alter policy bpr_read on public.breezeway_property_resolutions
  using (public.is_staff());
