-- Crew data lockdown, phase 2 (2026-10-08). Apply only once the client that
-- reads the crew-safe views (PR "close the crew data leak") is deployed.
--
-- Crews (cleaning / inspector / supervisor) lose direct access to the raw
-- `properties` table and to `operational_properties` (both carry client
-- charges, profit and revenue estimates). They read and edit properties only
-- through `property_ops` / `operational_property_ops` (20261008g): same rows,
-- operational columns only; updates through property_ops still work because
-- it is a simple view. Finance staff (admin / operations / viewer — anyone
-- holding a money or client page) and the service role are unchanged.

alter policy properties_select_staff on public.properties using ((select public.can_view_financials()));
alter policy properties_update_staff on public.properties
  using ((select public.can_view_financials())) with check ((select public.can_view_financials()));
alter policy properties_insert_staff on public.properties with check ((select public.can_view_financials()));
alter policy properties_delete_staff on public.properties using ((select public.can_view_financials()));

do $$
declare
  def text := pg_get_viewdef('public.operational_properties'::regclass, true);
begin
  if position('is_staff_or_server()' in def) = 0 then
    raise exception 'operational_properties has no is_staff_or_server() gate to replace';
  end if;
  execute 'create or replace view public.operational_properties as ' || replace(def, 'is_staff_or_server()', 'can_view_financials()');
end $$;

notify pgrst, 'reload schema';
