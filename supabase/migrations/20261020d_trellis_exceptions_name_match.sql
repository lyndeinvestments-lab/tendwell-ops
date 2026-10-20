-- "In Trellis, not in Ops" hid a Trellis record whenever an Ops property had
-- the same normalized name, even when that property was linked to a DIFFERENT
-- Trellis record. Renaming an Ops property after a sale (3742 Heritage Hills:
-- Dylan Robinson -> Glen Demeraski, new Trellis record a927c16a) would then hide
-- the new owner's record while nothing routed its tasks (routing is by id and
-- alias only, never by name). A same-name match now only hides a record when
-- that property has no Trellis link yet (the reconciliation tab suggests it) or
-- is linked to this very record. At apply time this surfaces one row: a
-- duplicate "HPM-2276 Headrick Lead" record with no Tendwell tasks.
-- Columns, gating and the alias checks are unchanged.

create or replace view public.trellis_exceptions as
 SELECT trellis_id,
    name,
    workspace,
    status,
    tendwell_task_count
   FROM ( SELECT e.trellis_id,
            e.name,
            e.workspace,
            e.status,
            e.tendwell_task_count
           FROM trellis_property_enriched e
          WHERE current_user_role() = 'admin'::text AND e.is_tendwell_property AND NOT (EXISTS ( SELECT 1
                   FROM properties pr
                  WHERE pr.trellis_id = e.trellis_id::text)) AND NOT (EXISTS ( SELECT 1
                   FROM property_aliases a
                  WHERE a.trellis_id = e.trellis_id)) AND NOT (EXISTS ( SELECT 1
                   FROM properties pr
                  WHERE pr.deleted_at IS NULL AND tendwell_normalize_name(pr.name) = tendwell_normalize_name(e.name)
                    AND (pr.trellis_id IS NULL OR pr.trellis_id = e.trellis_id::text))) AND NOT (EXISTS ( SELECT 1
                   FROM property_aliases a
                  WHERE tendwell_normalize_name(a.alias) = tendwell_normalize_name(e.name)))) _gated
  WHERE is_staff_or_server();
