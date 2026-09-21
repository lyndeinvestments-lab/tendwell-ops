-- Recurring linen program cost: derive it from real replacement cost.
--
-- `recalc_property_formulas()` is the source of truth for the persisted
-- financial columns (linen_program_cost, total_estimated_cost,
-- estimated_profit, profit_percentage, monthly_*). It hardcoded a flat
-- `number_of_beds * 300 / 12 / 4` for linens, which no longer matches how the
-- app prices them.
--
-- The new basis, mirroring calcLinenRecurringPerClean() in
-- client/src/lib/linen-onboarding.ts exactly:
--
--   annual    = sets_per_year x (each bed size's per-set cost)
--   per clean = annual / 12 months / 4 cleans
--
-- The 12 and the 4 are unchanged. Beds with no recorded size fall back to a
-- portfolio-blended per-set rate. All rates come from app_settings, so a Dzee
-- price change never needs another migration.
--
-- This LOWERS linen cost and therefore RAISES stored profit margins. Across
-- the 30 properties on the program the total moves from $1,162.50 to $313.95
-- per clean. The backfill at the bottom recomputes every affected row in one
-- shot so dashboards never show a mix of old and new figures.

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
  v_linen_blended numeric;
  v_linen_sets_year numeric;
  v_linen_annual numeric;
BEGIN
  SELECT COALESCE((SELECT value::numeric FROM app_settings WHERE key = 'cost_inspection'), 15) INTO v_inspection_cost;
  SELECT COALESCE((SELECT value::numeric FROM app_settings WHERE key = 'cost_trash'), 5) INTO v_trash_cost;
  SELECT COALESCE((SELECT value::numeric FROM app_settings WHERE key = 'amenity_bathroom'), 1.05) INTO v_bathroom;
  SELECT COALESCE((SELECT value::numeric FROM app_settings WHERE key = 'amenity_toilet_paper'), 0.78) INTO v_toilet_paper;
  SELECT COALESCE((SELECT value::numeric FROM app_settings WHERE key = 'amenity_kitchen'), 2.05) INTO v_kitchen;
  SELECT COALESCE((SELECT value::numeric FROM app_settings WHERE key = 'amenity_trash_bag'), 0.06) INTO v_trash_bag;
  SELECT COALESCE((SELECT value::numeric FROM app_settings WHERE key = 'amenity_hot_tub'), 0.88) INTO v_hot_tub;

  v_effective_inspection := CASE WHEN COALESCE(NEW.exempt_from_inspections, false) THEN 0 ELSE v_inspection_cost END;

  -- Est Laundry: auto-fill when unset, or when beds changed and the caller
  -- didn't also explicitly set a new laundry value in this same statement.
  IF NEW.est_laundry IS NULL
     OR (TG_OP = 'INSERT' AND NEW.est_laundry = 0)
     OR (TG_OP = 'UPDATE'
         AND NEW.est_laundry IS NOT DISTINCT FROM OLD.est_laundry
         AND NEW.number_of_beds IS DISTINCT FROM OLD.number_of_beds)
  THEN
    NEW.est_laundry := ROUND(COALESCE(NEW.number_of_beds, 0) * 7.935, 2);
  END IF;

  -- Est Consumables: same guard, extended to every input the formula reads
  -- (beds, baths, kitchens, hot tub).
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
  -- spread over 12 months x 4 cleans. Full beds use queen bedding. Properties
  -- with a bed count but no size breakdown use the blended rate.
  SELECT COALESCE((SELECT value::numeric FROM app_settings WHERE key = 'linen_set_king'), 48.02) INTO v_linen_king;
  SELECT COALESCE((SELECT value::numeric FROM app_settings WHERE key = 'linen_set_queen'), 43.59) INTO v_linen_queen;
  SELECT COALESCE((SELECT value::numeric FROM app_settings WHERE key = 'linen_set_twin'), 29.21) INTO v_linen_twin;
  SELECT COALESCE((SELECT value::numeric FROM app_settings WHERE key = 'linen_blended_per_set'), 41.71) INTO v_linen_blended;
  SELECT COALESCE((SELECT value::numeric FROM app_settings WHERE key = 'linen_recur_sets_year'), 2) INTO v_linen_sets_year;

  IF COALESCE(NEW.king_beds, 0) + COALESCE(NEW.queen_beds, 0)
     + COALESCE(NEW.full_beds, 0) + COALESCE(NEW.twin_beds, 0) > 0 THEN
    v_linen_annual := COALESCE(NEW.king_beds, 0) * v_linen_king
                    + (COALESCE(NEW.queen_beds, 0) + COALESCE(NEW.full_beds, 0)) * v_linen_queen
                    + COALESCE(NEW.twin_beds, 0) * v_linen_twin;
  ELSE
    v_linen_annual := COALESCE(NEW.number_of_beds, 0) * v_linen_blended;
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

  -- Deep clean income: the manual override wins; otherwise the 3x CE default.
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

-- ---------------------------------------------------------------------------
-- Backfill: recompute every property on the linen program in one shot, so
-- stored margins never sit in a half-old/half-new state. Snapshot first.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.properties_linen_recalc_backup_20260916 AS
SELECT id, name, number_of_beds, king_beds, queen_beds, full_beds, twin_beds,
       linen_program, linen_program_cost, total_estimated_cost,
       estimated_profit, profit_percentage,
       monthly_cost_estimate, monthly_profit_estimate, updated_at
FROM public.properties
WHERE linen_program;

-- A no-op UPDATE is enough: the BEFORE trigger recomputes the whole row.
UPDATE public.properties SET linen_program = linen_program WHERE linen_program;
