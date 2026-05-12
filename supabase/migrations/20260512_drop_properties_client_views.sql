-- Drop the legacy properties.client column for real this time.
--
-- The original 20260512_drop_properties_client migration failed because
-- three views (operational_properties, pipeline_view, property_proforma)
-- still selected p.client. This migration drops and recreates each view
-- without that column, then drops the column on the underlying table.
-- (CREATE OR REPLACE VIEW cannot remove columns — only add — so we DROP
-- and CREATE explicitly.)
--
-- View bodies are otherwise identical to their pre-drop definitions
-- (captured from pg_views). No app code consumes the `client` field
-- from these views — verified by grep across client/src.

DROP VIEW IF EXISTS public.property_proforma;
DROP VIEW IF EXISTS public.pipeline_view;
DROP VIEW IF EXISTS public.operational_properties;

ALTER TABLE public.properties DROP COLUMN IF EXISTS client;

CREATE VIEW public.operational_properties AS
  SELECT p.id,
    p.name,
    p.address,
    p.stage_id,
    p.ce_charged,
    p.cleaner_pay,
    p.est_laundry,
    p.est_consumables,
    p.inspection_cost,
    p.trash_cost,
    p.total_estimated_cost,
    p.estimated_profit,
    p.profit_percentage,
    p.number_of_beds,
    p.guest_count,
    p.bedrooms,
    p.full_baths,
    p.half_baths,
    p.kitchens,
    p.hot_tub,
    p.pet_friendly,
    p.square_footage,
    p.estimated_deep_clean_cost,
    p.deep_clean_3x_ce,
    p.profit_deep_clean,
    p.price_per_sq_foot,
    p.ce_per_sq,
    p.suggested_pay,
    p.auto_code,
    p.door_code,
    p.other_codes,
    p.notes,
    p.wifi_info,
    p.bed_sizes_text,
    p.king_beds,
    p.queen_beds,
    p.full_beds,
    p.twin_beds,
    p.bath_towels,
    p.washcloths,
    p.hand_towels,
    p.bathmats,
    p.pool_towels,
    p.linen_notes,
    p.breezeway_name,
    p.breezeway_id,
    p.onboarding_date,
    p.offboarding_date,
    p.first_clean_date,
    p.cleaning_frequency,
    p.avg_cleans_per_month,
    p.monthly_revenue_estimate,
    p.monthly_cost_estimate,
    p.monthly_profit_estimate,
    p.created_at,
    p.updated_at,
    p.filter_size,
    p.last_filter_changed,
    p.next_filter_due,
    ps.name AS stage_name,
    ps.slug AS stage_slug,
    ps.color AS stage_color,
    p.linen_program,
    p.linen_program_cost
  FROM properties p
  JOIN pipeline_stages ps ON p.stage_id = ps.id
  WHERE ps.is_operational = true AND p.deleted_at IS NULL;

CREATE VIEW public.pipeline_view AS
  SELECT p.id,
    p.name,
    p.address,
    p.stage_id,
    p.ce_charged,
    p.cleaner_pay,
    p.est_laundry,
    p.est_consumables,
    p.inspection_cost,
    p.trash_cost,
    p.total_estimated_cost,
    p.estimated_profit,
    p.profit_percentage,
    p.number_of_beds,
    p.guest_count,
    p.bedrooms,
    p.full_baths,
    p.half_baths,
    p.kitchens,
    p.hot_tub,
    p.pet_friendly,
    p.square_footage,
    p.estimated_deep_clean_cost,
    p.deep_clean_3x_ce,
    p.profit_deep_clean,
    p.price_per_sq_foot,
    p.ce_per_sq,
    p.suggested_pay,
    p.auto_code,
    p.door_code,
    p.other_codes,
    p.notes,
    p.wifi_info,
    p.bed_sizes_text,
    p.king_beds,
    p.queen_beds,
    p.full_beds,
    p.twin_beds,
    p.bath_towels,
    p.washcloths,
    p.hand_towels,
    p.bathmats,
    p.pool_towels,
    p.linen_notes,
    p.breezeway_name,
    p.breezeway_id,
    p.onboarding_date,
    p.offboarding_date,
    p.first_clean_date,
    p.cleaning_frequency,
    p.avg_cleans_per_month,
    p.monthly_revenue_estimate,
    p.monthly_cost_estimate,
    p.monthly_profit_estimate,
    p.created_at,
    p.updated_at,
    p.filter_size,
    p.last_filter_changed,
    p.next_filter_due,
    ps.name AS stage_name,
    ps.slug AS stage_slug,
    ps.color AS stage_color,
    ps.display_order AS stage_order,
    ps.requires_fields
  FROM properties p
  JOIN pipeline_stages ps ON p.stage_id = ps.id
  ORDER BY ps.display_order, p.name;

CREATE VIEW public.property_proforma AS
  SELECT p.id,
    p.name,
    ps.name AS stage_name,
    p.ce_charged,
    p.total_estimated_cost,
    p.estimated_profit,
    p.profit_percentage,
    p.cleaning_frequency,
    p.avg_cleans_per_month,
    p.monthly_revenue_estimate,
    p.monthly_cost_estimate,
    p.monthly_profit_estimate,
    p.first_clean_date,
    (SELECT count(*) FROM cleaning_logs cl WHERE cl.property_id = p.id) AS total_cleans,
    (SELECT max(cl.clean_date) FROM cleaning_logs cl WHERE cl.property_id = p.id) AS last_clean_date
  FROM properties p
  JOIN pipeline_stages ps ON p.stage_id = ps.id;
