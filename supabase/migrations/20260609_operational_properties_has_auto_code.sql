-- Expose the new has_auto_code flag through the operational_properties view so
-- the surfaces that read from the view (cost-tracking, access-codes) can use it
-- instead of the legacy per-property auto_code text. New view columns must be
-- appended at the end for CREATE OR REPLACE VIEW.
create or replace view operational_properties as
 SELECT p.id, p.name, p.address, p.stage_id, p.ce_charged, p.cleaner_pay,
    p.est_laundry, p.est_consumables, p.inspection_cost, p.trash_cost,
    p.total_estimated_cost, p.estimated_profit, p.profit_percentage,
    p.number_of_beds, p.guest_count, p.bedrooms, p.full_baths, p.half_baths,
    p.kitchens, p.hot_tub, p.pet_friendly, p.square_footage,
    p.estimated_deep_clean_cost, p.deep_clean_3x_ce, p.profit_deep_clean,
    p.price_per_sq_foot, p.ce_per_sq, p.suggested_pay, p.auto_code, p.door_code,
    p.other_codes, p.notes, p.wifi_info, p.bed_sizes_text, p.king_beds,
    p.queen_beds, p.full_beds, p.twin_beds, p.bath_towels, p.washcloths,
    p.hand_towels, p.bathmats, p.pool_towels, p.linen_notes, p.breezeway_name,
    p.breezeway_id, p.onboarding_date, p.offboarding_date, p.first_clean_date,
    p.cleaning_frequency, p.avg_cleans_per_month, p.monthly_revenue_estimate,
    p.monthly_cost_estimate, p.monthly_profit_estimate, p.created_at,
    p.updated_at, p.filter_size, p.last_filter_changed, p.next_filter_due,
    ps.name AS stage_name, ps.slug AS stage_slug, ps.color AS stage_color,
    p.linen_program, p.linen_program_cost,
    p.has_auto_code
   FROM properties p
     JOIN pipeline_stages ps ON p.stage_id = ps.id
  WHERE ps.is_operational = true AND p.deleted_at IS NULL;
