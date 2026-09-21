-- Beds with no recorded size are priced as kings.
--
-- Previously an unsized bed fell back to a portfolio-blended per-set rate
-- (41.71), which sits below the king rate (48.02) and therefore under-quoted
-- any property that turned out to be all kings. King is the dearest size, so
-- assuming it means an unknown mix can only ever over-collect; filling in the
-- real sizes can only lower the figure.
--
-- The onboarding fee had a worse version of the same gap: it priced ONLY beds
-- with a recorded size, so a property with a bed count and no breakdown was
-- quoted $0 of bed linens and billed for its bathrooms alone. Govind Pentakota
-- 931 has 12 beds and was quoting nothing for any of them.
--
-- Mirrors bedsForPricing() in client/src/lib/linen-onboarding.ts, which is the
-- single place both the onboarding fee and this recurring cost derive beds.
-- The app_settings key `linen_blended_per_set` is retired here.
--
-- Trigger body is otherwise identical to 20260916_linen_recurring_cost_basis
-- (chain: 20260423f -> 20260616 -> 20260619 -> 20260803 -> 20260824 ->
-- 20260916_linen_recurring_cost_basis -> this). Keep in sync.

CREATE OR REPLACE FUNCTION public.recalc_property_formulas()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_inspection_cost numeric;
  v_effective_inspection numeric;
  v_trash_cost numeric;
  v_bathroom numeric;
  v_toilet_paper numeric;
  v_kitchen numeric;
  v_trash_bag numeric;
  v_hot_tub numeric;
  v_linen_program numeric;
  v_linen_king numeric;
  v_linen_queen numeric;
  v_linen_twin numeric;
  v_linen_sets_year numeric;
  v_linen_annual numeric;
  v_sized_beds numeric;
BEGIN
  SELECT COALESCE((SELECT value::numeric FROM app_settings WHERE key = 'cost_inspection'), 15) INTO v_inspection_cost;
  SELECT COALESCE((SELECT value::numeric FROM app_settings WHERE key = 'cost_trash'), 5) INTO v_trash_cost;
  SELECT COALESCE((SELECT value::numeric FROM app_settings WHERE key = 'amenity_bathroom'), 1.05) INTO v_bathroom;
  SELECT COALESCE((SELECT value::numeric FROM app_settings WHERE key = 'amenity_toilet_paper'), 0.78) INTO v_toilet_paper;
  SELECT COALESCE((SELECT value::numeric FROM app_settings WHERE key = 'amenity_kitchen'), 2.05) INTO v_kitchen;
  SELECT COALESCE((SELECT value::numeric FROM app_settings WHERE key = 'amenity_trash_bag'), 0.06) INTO v_trash_bag;
  SELECT COALESCE((SELECT value::numeric FROM app_settings WHERE key = 'amenity_hot_tub'), 0.88) INTO v_hot_tub;

  v_effective_inspection := CASE WHEN COALESCE(NEW.exempt_from_inspections, false) THEN 0 ELSE v_inspection_cost END;

  IF NEW.est_laundry IS NULL
     OR (TG_OP = 'INSERT' AND NEW.est_laundry = 0)
     OR (TG_OP = 'UPDATE'
         AND NEW.est_laundry IS NOT DISTINCT FROM OLD.est_laundry
         AND NEW.number_of_beds IS DISTINCT FROM OLD.number_of_beds)
  THEN
    NEW.est_laundry := ROUND(COALESCE(NEW.number_of_beds, 0) * 7.935, 2);
  END IF;

  IF NEW.est_consumables IS NULL
     OR (TG_OP = 'INSERT' AND NEW.est_consumables = 0)
     OR (TG_OP = 'UPDATE'
         AND NEW.est_consumables IS NOT DISTINCT FROM OLD.est_consumables
         AND (NEW.number_of_beds IS DISTINCT FROM OLD.number_of_beds
              OR NEW.full_baths IS DISTINCT FROM OLD.full_baths
              OR NEW.half_baths IS DISTINCT FROM OLD.half_baths
              OR NEW.kitchens IS DISTINCT FROM OLD.kitchens
              OR NEW.hot_tub IS DISTINCT FROM OLD.hot_tub))
  THEN
    NEW.est_consumables := ROUND(
      (COALESCE(NEW.full_baths, 0) + COALESCE(NEW.half_baths, 0)) * (v_bathroom + v_toilet_paper)
      + COALESCE(NEW.kitchens, 1) * v_kitchen
      + COALESCE(NEW.number_of_beds, 0) * v_trash_bag
      + CASE WHEN NEW.hot_tub THEN v_hot_tub ELSE 0 END
    , 2);
  END IF;

  NEW.inspection_cost := v_effective_inspection;
  NEW.trash_cost := v_trash_cost;

  -- Linen program: replacement sets per year at each bed size's per-set cost,
  -- spread over 12 months x 4 cleans. Full beds use queen bedding. Beds with
  -- no recorded size are priced as kings (the dearest size), so an unknown mix
  -- can only over-collect, never under-quote.
  SELECT COALESCE((SELECT value::numeric FROM app_settings WHERE key = 'linen_set_king'), 48.02) INTO v_linen_king;
  SELECT COALESCE((SELECT value::numeric FROM app_settings WHERE key = 'linen_set_queen'), 43.59) INTO v_linen_queen;
  SELECT COALESCE((SELECT value::numeric FROM app_settings WHERE key = 'linen_set_twin'), 29.21) INTO v_linen_twin;
  SELECT COALESCE((SELECT value::numeric FROM app_settings WHERE key = 'linen_recur_sets_year'), 2) INTO v_linen_sets_year;

  v_sized_beds := COALESCE(NEW.king_beds, 0) + COALESCE(NEW.queen_beds, 0)
                + COALESCE(NEW.full_beds, 0) + COALESCE(NEW.twin_beds, 0);

  IF v_sized_beds > 0 THEN
    v_linen_annual := COALESCE(NEW.king_beds, 0) * v_linen_king
                    + (COALESCE(NEW.queen_beds, 0) + COALESCE(NEW.full_beds, 0)) * v_linen_queen
                    + COALESCE(NEW.twin_beds, 0) * v_linen_twin;
  ELSE
    v_linen_annual := COALESCE(NEW.number_of_beds, 0) * v_linen_king;
  END IF;

  v_linen_program := CASE
    WHEN COALESCE(NEW.linen_program, false)
      THEN ROUND(v_linen_annual * v_linen_sets_year / 12.0 / 4.0, 2)
    ELSE 0
  END;
  NEW.linen_program_cost := v_linen_program;

  NEW.total_estimated_cost := ROUND(
    COALESCE(NEW.cleaner_pay, 0) + COALESCE(NEW.est_laundry, 0) + COALESCE(NEW.est_consumables, 0)
    + v_effective_inspection + v_trash_cost + v_linen_program
  , 2);

  NEW.estimated_profit := ROUND(COALESCE(NEW.ce_charged, 0) - NEW.total_estimated_cost, 2);

  IF COALESCE(NEW.ce_charged, 0) > 0 THEN
    NEW.profit_percentage := ROUND((NEW.estimated_profit / NEW.ce_charged * 100), 2);
  ELSE
    NEW.profit_percentage := 0;
  END IF;

  IF COALESCE(NEW.square_footage, 0) > 0 THEN
    NEW.estimated_deep_clean_cost := ROUND(NEW.square_footage * 0.30, 2);
    NEW.price_per_sq_foot := ROUND(COALESCE(NEW.ce_charged, 0) / NEW.square_footage, 4);
    NEW.ce_per_sq := NEW.price_per_sq_foot;
    NEW.suggested_pay := ROUND(NEW.square_footage * 0.07, 2);
  ELSE
    NEW.estimated_deep_clean_cost := 0;
    NEW.price_per_sq_foot := 0;
    NEW.ce_per_sq := 0;
    NEW.suggested_pay := 0;
  END IF;

  NEW.deep_clean_3x_ce := COALESCE(
    ROUND(NEW.custom_deep_clean_income, 2),
    ROUND(COALESCE(NEW.ce_charged, 0) * 3, 2)
  );
  NEW.profit_deep_clean := ROUND(NEW.deep_clean_3x_ce - COALESCE(NEW.estimated_deep_clean_cost, 0), 2);

  IF NEW.cleaning_frequency = 'weekly' THEN
    NEW.avg_cleans_per_month := 4.33;
  ELSIF NEW.cleaning_frequency = 'biweekly' THEN
    NEW.avg_cleans_per_month := 2.17;
  ELSIF NEW.cleaning_frequency = 'monthly' THEN
    NEW.avg_cleans_per_month := 1;
  ELSIF NEW.cleaning_frequency = 'as_needed' OR NEW.cleaning_frequency IS NULL THEN
    IF NEW.avg_cleans_per_month IS NULL THEN
      NEW.avg_cleans_per_month := 2;
    END IF;
  END IF;

  IF COALESCE(NEW.avg_cleans_per_month, 0) > 0 THEN
    NEW.monthly_revenue_estimate := ROUND(COALESCE(NEW.ce_charged, 0) * NEW.avg_cleans_per_month, 2);
    NEW.monthly_cost_estimate := ROUND(NEW.total_estimated_cost * NEW.avg_cleans_per_month, 2);
    NEW.monthly_profit_estimate := ROUND(NEW.estimated_profit * NEW.avg_cleans_per_month, 2);
  ELSE
    NEW.monthly_revenue_estimate := 0;
    NEW.monthly_cost_estimate := 0;
    NEW.monthly_profit_estimate := 0;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

-- Snapshot the rows this changes, then recompute them.
CREATE TABLE IF NOT EXISTS public.properties_linen_king_backup_20260916 AS
SELECT id, name, number_of_beds, king_beds, queen_beds, full_beds, twin_beds,
       linen_program, linen_program_cost, total_estimated_cost,
       estimated_profit, profit_percentage, updated_at
FROM public.properties
WHERE linen_program
  AND COALESCE(king_beds,0) + COALESCE(queen_beds,0)
    + COALESCE(full_beds,0) + COALESCE(twin_beds,0) = 0;

UPDATE public.properties SET linen_program = linen_program
WHERE linen_program
  AND COALESCE(king_beds,0) + COALESCE(queen_beds,0)
    + COALESCE(full_beds,0) + COALESCE(twin_beds,0) = 0;

-- Retired: unsized beds now use the king rate directly.
DELETE FROM public.app_settings WHERE key = 'linen_blended_per_set';
