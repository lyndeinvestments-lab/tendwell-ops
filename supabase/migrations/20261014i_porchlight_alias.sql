-- 20261014i — record of the Porchlight Retreat alias fix (data only, idempotent).
--
-- Applied live during planning on 2026-10-14; this file is the record.
-- "Porchlight Retreat" is a second Haven (workspace B) Trellis record
-- (52447150-cadd-4810-8645-571a50afc731, Hostaway 588230) for Ops #577
-- "Craig Sheflin 2746 (SCounty)". The alias makes the snapshot triggers
-- rewrite that id to #577's primary trellis_id, and the existing snapshot
-- rows are re-pointed the same way link_trellis_property() does.

insert into public.property_aliases (property_id, alias, trellis_id, note, created_by)
select 577, 'Porchlight Retreat', '52447150-cadd-4810-8645-571a50afc731'::uuid,
       'Second Haven Trellis record for 2746 Easy St (Hostaway 588230 external name; internal name Craig Sheflin 2746 (SCounty))',
       'Jordan via Claude 2026-10-14'
 where exists (select 1 from public.properties where id = 577)
   and not exists (select 1 from public.property_aliases where trellis_id = '52447150-cadd-4810-8645-571a50afc731'::uuid);

update public.trellis_task_snapshot t
   set trellis_property_id = p.trellis_id::uuid
  from public.properties p
 where p.id = 577
   and p.trellis_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   and t.trellis_property_id = '52447150-cadd-4810-8645-571a50afc731'::uuid;

update public.trellis_reservation_snapshot r
   set trellis_property_id = p.trellis_id
  from public.properties p
 where p.id = 577
   and p.trellis_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   and r.trellis_property_id = '52447150-cadd-4810-8645-571a50afc731';

update public.trellis_review_snapshot v
   set trellis_property_id = p.trellis_id::uuid
  from public.properties p
 where p.id = 577
   and p.trellis_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   and v.trellis_property_id = '52447150-cadd-4810-8645-571a50afc731'::uuid;
