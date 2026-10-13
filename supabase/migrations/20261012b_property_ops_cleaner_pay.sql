-- property_ops: cleaner pay is read-only, and only for roles that see it in the app.
--
-- 20261008g_crew_financial_lockdown made property_ops the crew-safe view of
-- properties, and kept cleaner_pay in it on purpose (the Property List shows
-- it to supervisors). Two gaps, reported by the 2026-10-12 bounty sweep
-- (PR #635) and confirmed by impersonation:
--   1. every staff login, cleaners and inspectors included, could read the
--      pay rate on all 485 properties straight from the API;
--   2. property_ops is updatable, so any staff login (a vendor's supervisor
--      too) could CHANGE cleaner_pay, the rate vendor invoices are paid at.
--
-- Fix: cleaner_pay becomes a computed column, which Postgres treats as
-- read-only in an updatable view (every other column stays editable), and it
-- is NULL unless the caller can see money or has the Property List page.
-- Pay is edited only on raw `properties`, which is finance-only (20261008h).
-- Same columns, same order, same types (hence the numeric(10,2) cast): CREATE OR REPLACE keeps
-- operational_property_ops (select o.*) and the grants intact.

create or replace view public.property_ops as
select
  p.id, p.name, p.address, p.address_norm, p.stage_id,
  case
    when public.can_view_financials() or public.current_user_can_view('property-list') then p.cleaner_pay
  end::numeric(10,2) as cleaner_pay,
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

notify pgrst, 'reload schema';
