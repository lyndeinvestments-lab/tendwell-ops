-- Supabase grants anon/authenticated EXECUTE on public functions by default, so
-- the earlier REVOKE ... FROM PUBLIC did not actually remove anon. These owner
-- RPCs self-guard on current_owner_id() (anon gets an exception, no data), but
-- anon has no business calling them -- revoke explicitly to match intent.
REVOKE EXECUTE ON FUNCTION public.get_owner_shipments() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_owner_quotes() FROM anon;
REVOKE EXECUTE ON FUNCTION public.owner_respond_to_quote(bigint, text) FROM anon;

-- Pin search_path on the owner_* updated_at trigger functions
-- (advisor: function_search_path_mutable). Bodies only use now() (pg_catalog).
ALTER FUNCTION public.owner_referrals_touch() SET search_path = '';
ALTER FUNCTION public.owner_testimonials_touch() SET search_path = '';
ALTER FUNCTION public.owner_feedback_touch() SET search_path = '';
