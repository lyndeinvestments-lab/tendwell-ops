-- Optional "Linen Program" charge per property.
-- Per-clean linen replacement fee when the flag is true:
--   linen_program_cost = (number_of_beds * 300) / 12 / 4  =  beds * 6.25
-- Rolls into total_estimated_cost (and therefore profit / profit_percentage)
-- only when linen_program = true. Properties without the flag keep their
-- existing totals unchanged.

ALTER TABLE properties ADD COLUMN IF NOT EXISTS linen_program BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS linen_program_cost NUMERIC(10,2) NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION recalc_property_formulas()
RETURNS TRIGGER AS $$
DECLARE
  v_inspection_cost numeric;
  v_trash_cost numeric;
  v_bathroom numeric;
  v_toilet_paper numeric;
  v_kitchen numeric;
  v_trash_bag numeric;
  v_hot_tub numeric;
  v_linen_program numeric;
BEGIN
  SELECT COALESCE((SELECT value::numeric FROM app_settings WHERE key = 'cost_inspection'), 15) INTO v_inspection_cost;
  SELECT COALESCE((SELECT value::numeric FROM app_settings WHERE key = 'cost_trash'), 5) INTO v_trash_cost;
  SELECT COALESCE((SELECT value::numeric FROM app_settings WHERE key = 'amenity_bathroom'), 1.05) INTO v_bathroom;
  SELECT COALESCE((SELECT value::numeric FROM app_settings WHERE key = 'amenity_toilet_paper'), 0.78) INTO v_toilet_paper;
  SELECT COALESCE((SELECT value::numeric FROM app_settings WHERE key = 'amenity_kitchen'), 2.05) INTO v_kitchen;
  SELECT COALESCE((SELECT value::numeric FROM app_settings WHERE key = 'amenity_trash_bag'), 0.06) INTO v_trash_bag;
  SELECT COALESCE((SELECT value::numeric FROM app_settings WHERE key = 'amenity_hot_tub'), 0.88) INTO v_hot_tub;

  IF NEW.est_laundry IS NULL THEN
    NEW.est_laundry := ROUND(COALESCE(NEW.number_of_beds, 0) * 7.935, 2);
  END IF;

  IF NEW.est_consumables IS NULL THEN
    NEW.est_consumables := ROUND(
      (COALESCE(NEW.full_baths, 0) + COALESCE(NEW.half_baths, 0)) * (v_bathroom + v_toilet_paper)
      + COALESCE(NEW.kitchens, 1) * v_kitchen
      + COALESCE(NEW.number_of_beds, 0) * v_trash_bag
      + CASE WHEN NEW.hot_tub THEN v_hot_tub ELSE 0 END
    , 2);
  END IF;

  NEW.inspection_cost := v_inspection_cost;
  NEW.trash_cost := v_trash_cost;

  -- LINEN PROGRAM: beds × 300 / 12 / 4  =  beds × 6.25
  v_linen_program := CASE
    WHEN COALESCE(NEW.linen_program, false)
      THEN ROUND(COALESCE(NEW.number_of_beds, 0) * 300.0 / 12.0 / 4.0, 2)
    ELSE 0
  END;
  NEW.linen_program_cost := v_linen_program;

  NEW.total_estimated_cost := ROUND(
    COALESCE(NEW.cleaner_pay, 0) + COALESCE(NEW.est_laundry, 0) + COALESCE(NEW.est_consumables, 0)
    + v_inspection_cost + v_trash_cost + v_linen_program
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

  NEW.deep_clean_3x_ce := ROUND(COALESCE(NEW.ce_charged, 0) * 3, 2);
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
$$ LANGUAGE plpgsql;
