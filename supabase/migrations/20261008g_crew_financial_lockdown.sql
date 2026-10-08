-- Crew data lockdown, phase 1 (2026-10-08).
--
-- Every RLS policy and definer view asked only "is staff?", so the 24 crew
-- logins (cleaning / inspector / supervisor — field pages only) could read
-- client charges, profit and revenue, client contact and payment details,
-- website leads, owner details — and app_settings.qbo_tokens, the live
-- QuickBooks OAuth tokens — straight from the database API, and could call
-- the CRM write functions. The UI only hid what had already been fetched.
--
-- Phase 1: who-may-see-money helpers; app_settings (credentials never leave
-- the server; money keys finance-only); CRM functions; every money/client
-- table and view crew pages do not read; plus two ADDITIVE crew-safe views
-- (property_ops, operational_property_ops) the client moves to.
-- Phase 2 (20261008h) then cuts crews off raw `properties` and
-- `operational_properties` once that client is deployed.
--
-- Rule going forward: a new table/view holding client money or client contact
-- data gates SELECT on (select public.can_view_financials()), not is_staff().

-- Who may see client money and client contact data.
--
-- Staff split into two kinds: people who run the business (admin, operations,
-- viewer — they hold at least one "money or client" page) and crews (cleaning,
-- inspector, supervisor — field pages only). Until now every RLS policy and
-- definer view asked only "is staff?", so a crew login could read client
-- charges, profit, revenue and client contact details straight from the API.
--
-- staff_has_financial_view(): SECURITY DEFINER (reads app_users/app_settings),
-- permission-driven exactly like current_user_can_view — granting a crew
-- member e.g. the Pipeline page in Settings → Roles also grants this.
create or replace function public.staff_has_financial_view()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  with fin as (
    select array['dashboard','pipeline','contacts','quote-sheet','cost-tracking','master-list','pro-forma',
                 'forecaster','revenue-report','financial-dashboard','north-star','report','invoicing',
                 'onboarding-queue','settings','activity','trellis-sync'] as views
  ), u as (
    select role, custom_views from public.app_users where google_email = public.current_auth_email() limit 1
  )
  select coalesce((
    select case
      when u.role = 'admin' then true
      when u.custom_views is not null then u.custom_views ?| (select views from fin)
      else coalesce((select (s.value::jsonb -> u.role -> 'views') ?| (select views from fin)
                     from public.app_settings s where s.key = 'role_permissions'), false)
    end
    from u
  ), false)
$$;

-- can_view_financials(): SECURITY INVOKER on purpose — current_user must be
-- the CALLER's role so the service role / postgres (API routes, cron, MCP)
-- always pass, while anon/authenticated sessions need the grant.
create or replace function public.can_view_financials()
returns boolean
language sql
stable
set search_path = public
as $$
  select current_user not in ('anon', 'authenticated') or public.staff_has_financial_view()
$$;

revoke all on function public.staff_has_financial_view() from public, anon;
grant execute on function public.staff_has_financial_view() to authenticated, service_role;
grant execute on function public.can_view_financials() to authenticated, service_role;

-- ─── app_settings ────────────────────────────────────────────────────────────
-- qbo_tokens: server only (api/qbo/* uses the service role), never a browser.
-- Crews see only the operational keys their pages read; finance staff see the
-- rest (pricing, costs, P&L, CRM thresholds). Writes stay admin-only.
drop policy if exists app_settings_select_authenticated on public.app_settings;
drop policy if exists app_settings_select_staff on public.app_settings;
create policy app_settings_select_staff on public.app_settings for select to authenticated
  using (
    key <> 'qbo_tokens'
    and public.is_staff()
    and (
      key = any (array['role_permissions', 'ac_filter_interval', 'auto_code', 'inspection_interval_days',
                       'linen_restock_multiplier', 'linen_recur_sets_year'])
      or (select public.can_view_financials())
    )
  );

-- ─── CRM functions ───────────────────────────────────────────────────────────
-- crm_create_quote_property / crm_set_client_stage / crm_log_* / crm_move_
-- property_stage all gate on this. Service-role callers (MCP, API) unchanged.
create or replace function public.crm_caller_allowed()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    coalesce(public.staff_has_financial_view(), false)
    or coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    or coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'), '') = 'service_role'
    or (current_setting('request.jwt.claims', true) is null and current_user in ('postgres', 'supabase_admin'))
$$;

-- ─── Money / client tables crews never need ──────────────────────────────────
do $$
declare
  t text;
begin
  -- Single "ALL is_staff()" policies → finance-only.
  foreach t in array array['contacts', 'organizations', 'contact_notes', 'amenity_costs', 'cleaning_history',
                           'north_star_metrics', 'north_star_values'] loop
    execute format('alter policy %I on public.%I using ((select public.can_view_financials())) with check ((select public.can_view_financials()))',
      (select policyname from pg_policies where schemaname = 'public' and tablename = t and cmd = 'ALL' and qual like '%is_staff()%' limit 1), t);
  end loop;
end $$;

alter policy onboarding_submissions_auth_all on public.onboarding_submissions
  using ((select public.can_view_financials())) with check ((select public.can_view_financials()));
alter policy owner_agreements_all_staff on public.owner_agreements
  using ((select public.can_view_financials())) with check ((select public.can_view_financials()));
alter policy owner_feedback_staff_all on public.owner_feedback
  using ((select public.can_view_financials())) with check ((select public.can_view_financials()));
alter policy owner_referrals_staff_all on public.owner_referrals
  using ((select public.can_view_financials())) with check ((select public.can_view_financials()));
alter policy owner_testimonials_staff_all on public.owner_testimonials
  using ((select public.can_view_financials())) with check ((select public.can_view_financials()));

alter policy contact_interactions_select_authenticated on public.contact_interactions using ((select public.can_view_financials()));
alter policy contact_interactions_insert_authenticated on public.contact_interactions with check ((select public.can_view_financials()));
alter policy contact_interactions_update_authenticated on public.contact_interactions
  using ((select public.can_view_financials())) with check ((select public.can_view_financials()));
alter policy client_stage_transitions_staff_select on public.client_stage_transitions using ((select public.can_view_financials()));
alter policy client_stage_transitions_staff_insert on public.client_stage_transitions with check ((select public.can_view_financials()));
alter policy monthly_financial_snapshot_select_authenticated on public.monthly_financial_snapshot using ((select public.can_view_financials()));
alter policy proforma_months_read on public.proforma_months using ((select public.can_view_financials()));
alter policy proforma_months_insert on public.proforma_months with check ((select public.can_view_financials()));
alter policy proforma_months_update on public.proforma_months
  using ((select public.can_view_financials())) with check ((select public.can_view_financials()));
alter policy proforma_months_delete on public.proforma_months using ((select public.can_view_financials()));
alter policy qbo_pl_months_staff_select on public.qbo_pl_months using ((select public.can_view_financials()));
alter policy qbo_class_pl_months_staff_select on public.qbo_class_pl_months using ((select public.can_view_financials()));
alter policy website_leads_staff_select on public.website_leads using ((select public.can_view_financials()));
alter policy trellis_reservation_snapshot_staff_select on public.trellis_reservation_snapshot using ((select public.can_view_financials()));
alter policy property_owners_select on public.property_owners
  using ((select public.can_view_financials()) or email = public.current_auth_email());

-- Crews WRITE these (logActivity / logPropertyEdit on every edit) but must not
-- READ them back: the edit log carries old/new client charges.
drop policy if exists activity_log_authenticated on public.activity_log;
create policy activity_log_staff_insert on public.activity_log for insert to authenticated with check (public.is_staff());
create policy activity_log_finance_select on public.activity_log for select to authenticated using ((select public.can_view_financials()));
create policy activity_log_finance_update on public.activity_log for update to authenticated
  using ((select public.can_view_financials())) with check ((select public.can_view_financials()));
create policy activity_log_finance_delete on public.activity_log for delete to authenticated using ((select public.can_view_financials()));

drop policy if exists property_edit_log_authenticated on public.property_edit_log;
create policy property_edit_log_staff_insert on public.property_edit_log for insert to authenticated with check (public.is_staff());
create policy property_edit_log_finance_select on public.property_edit_log for select to authenticated using ((select public.can_view_financials()));
create policy property_edit_log_finance_update on public.property_edit_log for update to authenticated
  using ((select public.can_view_financials())) with check ((select public.can_view_financials()));
create policy property_edit_log_finance_delete on public.property_edit_log for delete to authenticated using ((select public.can_view_financials()));

-- ─── Money views: staff gate → finance gate ──────────────────────────────────
-- Definer views wrapped in `WHERE is_staff_or_server()` (20261007 security
-- pass). Same definition, stricter gate; can_view_financials() also passes the
-- service role, so cron/API reads are unchanged.
do $$
declare
  v text;
  def text;
begin
  foreach v in array array['pipeline_view', 'property_proforma', 'property_month_financials',
                           'financial_monthly_cleans', 'financial_task_load'] loop
    def := pg_get_viewdef(('public.' || v)::regclass, true);
    if position('is_staff_or_server()' in def) = 0 then
      raise exception 'view % has no is_staff_or_server() gate to replace', v;
    end if;
    execute format('create or replace view public.%I as %s', v, replace(def, 'is_staff_or_server()', 'can_view_financials()'));
  end loop;
end $$;

-- ─── Crew-safe views (additive) ──────────────────────────────────────────────
-- property_ops: `properties` minus every money / client / CRM column. A simple
-- single-table view, so PostgREST can UPDATE through it — crews keep editing
-- door codes, AC filters and linen pars here once phase 2 removes their
-- direct `properties` access. Definer view gated like the others.
create or replace view public.property_ops as
select
  p.id, p.name, p.address, p.address_norm, p.stage_id, p.cleaner_pay,
  p.number_of_beds, p.guest_count, p.bedrooms, p.full_baths, p.half_baths, p.kitchens,
  p.hot_tub, p.pool, p.pet_friendly, p.square_footage,
  p.auto_code, p.has_auto_code, p.door_code, p.other_codes, p.wifi_info, p.notes,
  p.bed_sizes_text, p.king_beds, p.queen_beds, p.full_beds, p.twin_beds,
  p.bath_towels, p.washcloths, p.hand_towels, p.bathmats, p.pool_towels, p.linen_notes,
  p.linen_program, p.target_par_sets, p.linen_onboarding_sets, p.linen_onboarding_comforters,
  p.breezeway_name, p.breezeway_id, p.trellis_id,
  p.onboarding_date, p.offboarding_date, p.first_clean_date, p.offboarded_at,
  p.cleaning_frequency, p.avg_cleans_per_month,
  p.filter_size, p.last_filter_changed, p.next_filter_due,
  p.check_in_time, p.check_out_time, p.exempt_from_inspections,
  p.ical_url, p.listing_url,
  p.created_at, p.updated_at, p.archived_at, p.deleted_at
from public.properties p
where public.is_staff_or_server();

-- operational_property_ops: operational_properties without the money (the
-- Property List, Linen, Access Codes and AC Filters pages read this).
create or replace view public.operational_property_ops as
select o.*, ps.name as stage_name, ps.slug as stage_slug, ps.color as stage_color
from public.property_ops o
join public.pipeline_stages ps on ps.id = o.stage_id
where ps.is_operational = true and o.deleted_at is null;

revoke all on public.property_ops, public.operational_property_ops from anon, public;
grant select, update on public.property_ops to authenticated;
grant select on public.operational_property_ops to authenticated;
grant select, update on public.property_ops to service_role;
grant select on public.operational_property_ops to service_role;

notify pgrst, 'reload schema';
