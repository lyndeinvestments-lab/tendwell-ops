-- Trellis task tracker (spec docs/superpowers/specs/2026-07-09-trellis-task-tracker-design.md).

-- 1. Widen trellis_task_snapshot read from admin-only to all staff so the
--    dashboard tile (admin, viewer) and /trellis-tasks can query it.
--    trellis_roster stays admin-only (personal emails).
drop policy if exists trellis_task_admin_read on public.trellis_task_snapshot;
drop policy if exists trellis_task_staff_read on public.trellis_task_snapshot;
create policy trellis_task_staff_read on public.trellis_task_snapshot
  for select to authenticated using (public.is_staff());

-- 2. Allow the hourly tasks-only cron to log itself.
alter table public.trellis_sync_log drop constraint if exists trellis_sync_log_trigger_check;
alter table public.trellis_sync_log add constraint trellis_sync_log_trigger_check
  check (trigger in ('manual','nightly','poller','hourly'));

-- 3. Grant the new 'trellis-tasks' view to admin + viewer in the data-driven
--    RBAC store (app_settings.role_permissions). No-op if the key is absent
--    (hardcoded ROLE_VIEWS fallback then applies).
do $$
declare
  v jsonb;
  r text;
begin
  select value into v from public.app_settings where key = 'role_permissions';
  if v is null then return; end if;
  foreach r in array array['admin','viewer'] loop
    if v ? r then
      if not ((v->r->'views') @> '"trellis-tasks"') then
        v := jsonb_set(v, array[r,'views'], (v->r->'views') || '"trellis-tasks"'::jsonb);
      end if;
      v := jsonb_set(v, array[r,'permissions','trellis-tasks'],
                     jsonb_build_object('view', true, 'edit', r = 'admin'));
    end if;
  end loop;
  update public.app_settings set value = v where key = 'role_permissions';
end $$;
