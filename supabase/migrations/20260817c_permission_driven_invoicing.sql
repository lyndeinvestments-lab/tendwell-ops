-- Permission-driven access for the Invoicing area (2026-08-17)
--
-- Until now /invoicing was gated three separate ways, all hardcoded to
-- role = 'admin': the client route (AdminRoute), the api/invoices/* endpoints
-- (requireAdminBearer) and these table policies. Granting the `invoicing` view
-- in Settings → Roles & Permissions therefore did nothing except surface a
-- sidebar link that the route refused — the matrix looked authoritative but
-- wasn't.
--
-- This migration makes the RBAC store the source of truth for the DB layer by
-- adding two helpers that resolve a view/edit grant exactly the way the client
-- does, then re-pointing the four invoicing tables at them.
--
-- Resolution order (must stay in sync with resolveUserFromEmail in
-- client/src/lib/auth.tsx):
--   1. role 'admin'                      → always allowed
--   2. app_users.custom_views IS NOT NULL → per-user override wins outright;
--      edit comes from custom_permissions, or is admin-only when that is null
--   3. otherwise                          → app_settings.role_permissions[role]
--
-- Scope: the invoicing tables only. API Sync (trellis_*, qbo_classes) stays
-- admin-only, so those policies are untouched.

-- ─── Helpers ────────────────────────────────────────────────────────────────

create or replace function public.current_user_can_view(p_view text)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  with u as (
    select role, custom_views
    from public.app_users
    where google_email = public.current_auth_email()
    limit 1
  )
  select coalesce((
    select case
      when u.role = 'admin' then true
      when u.custom_views is not null then u.custom_views ? p_view
      else coalesce((
        select (s.value::jsonb -> u.role -> 'views') ? p_view
        from public.app_settings s
        where s.key = 'role_permissions'
      ), false)
    end
    from u
  ), false)
$$;

comment on function public.current_user_can_view(text) is
  'True when the calling staff user may VIEW the given view id, per app_settings.role_permissions (or their per-user custom_views override). Admins always true. Mirrors resolveUserFromEmail in client/src/lib/auth.tsx.';

create or replace function public.current_user_can_edit(p_view text)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  with u as (
    select role, custom_views, custom_permissions
    from public.app_users
    where google_email = public.current_auth_email()
    limit 1
  )
  select coalesce((
    select case
      when u.role = 'admin' then true
      -- A per-user view override with no matching permissions blob grants
      -- view-only (non-admins get edit = false), same as the client.
      when u.custom_views is not null then
        coalesce((u.custom_permissions -> p_view ->> 'edit')::boolean, false)
      else coalesce((
        select (s.value::jsonb -> u.role -> 'permissions' -> p_view ->> 'edit')::boolean
        from public.app_settings s
        where s.key = 'role_permissions'
      ), false)
    end
    from u
  ), false)
$$;

comment on function public.current_user_can_edit(text) is
  'True when the calling staff user may EDIT the given view id, per app_settings.role_permissions (or their per-user custom_permissions override). Admins always true. Mirrors resolveUserFromEmail in client/src/lib/auth.tsx.';

-- These are SECURITY DEFINER and read app_users/app_settings, so keep them off
-- the default PUBLIC grant (matches the hygiene pass on the owner-sync
-- trigger functions in 20260709_owner_contact_sync.sql).
revoke all on function public.current_user_can_view(text) from public;
revoke all on function public.current_user_can_edit(text) from public;
grant execute on function public.current_user_can_view(text) to authenticated, service_role;
grant execute on function public.current_user_can_edit(text) to authenticated, service_role;

-- ─── Invoicing tables: admin-only → matrix-driven ───────────────────────────
-- Read requires the `invoicing` view grant; writes require its edit grant.
-- Split per command (the old policies were a single FOR ALL) so a view-only
-- grant is genuinely read-only instead of implicitly allowing writes.

do $$
declare
  t text;
begin
  foreach t in array array['invoice_runs', 'invoice_lines', 'vendors', 'vendor_property_aliases'] loop
    execute format('drop policy if exists %I on public.%I', t || '_all_admin', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_invoicing', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_invoicing', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_invoicing', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_invoicing', t);

    execute format(
      'create policy %I on public.%I for select to authenticated using (public.current_user_can_view(%L))',
      t || '_select_invoicing', t, 'invoicing');
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.current_user_can_edit(%L))',
      t || '_insert_invoicing', t, 'invoicing');
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.current_user_can_edit(%L)) with check (public.current_user_can_edit(%L))',
      t || '_update_invoicing', t, 'invoicing', 'invoicing');
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.current_user_can_edit(%L))',
      t || '_delete_invoicing', t, 'invoicing');
  end loop;
end $$;
