-- WS4: "Which clean is this inspection rating?" hint for the inspection form.
--
-- The inspections_attribute_clean trigger (20261014d) links an inspection to
-- the last completed clean at the property within 14 days before the
-- inspection date, via inspection_clean_match() (service role only). The
-- inspection form needs the same answer BEFORE saving, so it can:
--   * show "Rating the clean on <date> by <cleaner> (from Trellis)",
--   * prefill the cleaner / last-cleaned date on a new row, and
--   * write rated_clean_task_id itself, so the trigger does not re-fill a
--     cleaner the user deliberately cleared (the trigger only acts while
--     rated_clean_task_id is null).
--
-- Read-only, staff with the `inspections` view only. Same matching logic as
-- the trigger (it calls inspection_clean_match), plus display fields.

create or replace function public.inspection_rated_clean_hint(p_property_id bigint, p_anchor date)
returns table (
  trellis_task_id uuid,
  clean_date date,
  clean_kind text,
  clean_title text,
  is_tendwell boolean,
  cleaner_id uuid,
  cleaner_name text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not (public.is_staff() and public.current_user_can_view('inspections')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_property_id is null or p_anchor is null then
    return;
  end if;

  return query
    select m.trellis_task_id,
           m.clean_date,
           t.clean_kind,
           t.title,
           m.is_tendwell,
           m.cleaner_id,
           cl.full_name
      from public.inspection_clean_match(p_property_id, p_anchor) m
      left join public.trellis_task_snapshot t on t.trellis_task_id = m.trellis_task_id
      left join public.cleaners cl on cl.id = m.cleaner_id
     where m.trellis_task_id is not null;
end
$$;

revoke all on function public.inspection_rated_clean_hint(bigint, date) from public, anon;
grant execute on function public.inspection_rated_clean_hint(bigint, date) to authenticated, service_role;

comment on function public.inspection_rated_clean_hint(bigint, date) is
  'WS4: the Trellis clean an inspection on p_anchor at p_property_id would rate (same rule as inspections_attribute_clean). Staff with the inspections view only.';
