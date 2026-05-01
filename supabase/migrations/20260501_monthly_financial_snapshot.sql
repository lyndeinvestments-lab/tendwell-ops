-- Phase 2: monthly financial snapshot — variance ledger.
-- Captures the live estimate (from breezeway_tasks × per-property rates)
-- alongside actuals (from proforma_months or qbo_pl_data) for every month
-- we have any data for. Variance is precomputed = actual - estimate.
--
-- One row per month. Re-reconciliation overwrites — the snapshot is a
-- materialized view of the current state of estimate vs actual, not an
-- append-only log. Historical changes ARE audited via last_reconciled_at,
-- and per-property breakdown (jsonb) is preserved for Phase 3 calibration
-- work without needing a separate per-property snapshot table.

CREATE TABLE IF NOT EXISTS monthly_financial_snapshot (
  month                          date PRIMARY KEY,
  -- Estimate (rolled up from breezeway_tasks × operational_properties rates)
  estimate_revenue               numeric NOT NULL DEFAULT 0,
  estimate_cogs                  numeric NOT NULL DEFAULT 0,
  estimate_opex                  numeric NOT NULL DEFAULT 0,
  estimate_profit                numeric NOT NULL DEFAULT 0,
  estimate_cleans_count          integer NOT NULL DEFAULT 0,
  estimate_deep_cleans_count     integer NOT NULL DEFAULT 0,
  estimate_active_properties     integer NOT NULL DEFAULT 0,
  estimate_per_property          jsonb   NOT NULL DEFAULT '[]'::jsonb,
  -- Actuals — proforma_months wins, qbo_pl_data is fallback
  actual_source                  text,           -- 'proforma' | 'qbo' | NULL
  actual_revenue                 numeric,
  actual_cogs                    numeric,
  actual_opex                    numeric,
  actual_profit                  numeric,
  -- Variance (= actual - estimate). NULL when actuals haven't landed yet.
  variance_revenue               numeric,
  variance_cogs                  numeric,
  variance_opex                  numeric,
  variance_profit                numeric,
  -- Meta
  first_captured_at              timestamptz NOT NULL DEFAULT now(),
  last_reconciled_at             timestamptz NOT NULL DEFAULT now(),
  notes                          text
);

CREATE INDEX IF NOT EXISTS idx_mfs_month_desc ON monthly_financial_snapshot (month DESC);

ALTER TABLE monthly_financial_snapshot ENABLE ROW LEVEL SECURITY;

CREATE POLICY "monthly_financial_snapshot_select_authenticated"
  ON monthly_financial_snapshot FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "monthly_financial_snapshot_admin_writes"
  ON monthly_financial_snapshot FOR ALL
  TO authenticated
  USING      (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');

-- ─────────────────────────────────────────────────────────────────────────
-- compute_monthly_estimate(target_month)
-- Returns one row of estimate aggregates for the given month, computed
-- from breezeway_tasks × operational_properties rates. Stable / read-only.
-- Also returns a jsonb array of per-property contributions for Phase 3.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION compute_monthly_estimate(target_month date)
RETURNS TABLE(
  est_revenue        numeric,
  est_cogs           numeric,
  est_opex           numeric,
  est_profit         numeric,
  cleans_count       integer,
  deep_cleans_count  integer,
  active_properties  integer,
  per_property       jsonb
)
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  WITH tasks AS (
    SELECT
      bt.property_id,
      COUNT(*) FILTER (WHERE bt.is_clean)      AS cleans,
      COUNT(*) FILTER (WHERE bt.is_deep_clean) AS deep_cleans
    FROM breezeway_tasks bt
    WHERE bt.due_date >= target_month
      AND bt.due_date <  (target_month + INTERVAL '1 month')::date
      AND bt.property_id IS NOT NULL
    GROUP BY bt.property_id
  ),
  rolled AS (
    SELECT
      t.property_id,
      p.name AS property_name,
      t.cleans,
      t.deep_cleans,
      (t.cleans      * COALESCE(op.ce_charged, 0)
       + t.deep_cleans * COALESCE(op.deep_clean_3x_ce, op.ce_charged * 3, 0))    AS revenue,
      (t.cleans      * COALESCE(op.total_estimated_cost, 0)
       + t.deep_cleans * COALESCE(op.estimated_deep_clean_cost, op.total_estimated_cost, 0))
                                                                                  AS cogs
    FROM tasks t
    LEFT JOIN operational_properties op ON op.id = t.property_id
    LEFT JOIN properties             p  ON p.id  = t.property_id
  )
  SELECT
    COALESCE(SUM(revenue), 0)::numeric                                AS est_revenue,
    COALESCE(SUM(cogs), 0)::numeric                                   AS est_cogs,
    0::numeric                                                        AS est_opex,
    (COALESCE(SUM(revenue), 0) - COALESCE(SUM(cogs), 0))::numeric     AS est_profit,
    COALESCE(SUM(cleans), 0)::integer                                 AS cleans_count,
    COALESCE(SUM(deep_cleans), 0)::integer                            AS deep_cleans_count,
    COUNT(DISTINCT property_id)::integer                              AS active_properties,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
         'property_id',   r.property_id,
         'property_name', r.property_name,
         'cleans',        r.cleans,
         'deep_cleans',   r.deep_cleans,
         'revenue',       r.revenue,
         'cogs',          r.cogs
       ) ORDER BY r.revenue DESC)
       FROM rolled r WHERE r.property_id IS NOT NULL),
      '[]'::jsonb
    )                                                                 AS per_property
  FROM rolled;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- reconcile_monthly_snapshot(target_month)
-- Computes the estimate and merges it with the best available actuals
-- (proforma_months > qbo_pl_data > nothing) into monthly_financial_snapshot.
-- Idempotent — safe to call repeatedly. Updates last_reconciled_at.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION reconcile_monthly_snapshot(target_month date)
RETURNS monthly_financial_snapshot
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  est                record;
  pf_row             proforma_months%ROWTYPE;
  qbo_text           text;
  qbo_jsonb          jsonb;
  qbo_monthly        jsonb;
  qbo_month_entry    jsonb;
  qbo_revenue        numeric;
  qbo_cogs           numeric;
  qbo_opex           numeric;
  qbo_net            numeric;
  actual_src         text;
  actual_rev         numeric;
  actual_cog         numeric;
  actual_op          numeric;
  actual_pft         numeric;
  result             monthly_financial_snapshot;
  month_yyyymm       text;
  month_short        text;
  month_long         text;
BEGIN
  SELECT * INTO est FROM compute_monthly_estimate(target_month);

  month_yyyymm := to_char(target_month, 'YYYY-MM');
  month_long   := trim(to_char(target_month, 'FMMonth YYYY'));
  month_short  := to_char(target_month, 'Mon YYYY');

  -- Try proforma_months first (manually-curated truth)
  SELECT * INTO pf_row FROM proforma_months WHERE month = month_yyyymm;
  IF FOUND
     AND ((COALESCE(pf_row.cleaning_fee,0) + COALESCE(pf_row.services,0)
           + COALESCE(pf_row.onboarding_revenue,0) + COALESCE(pf_row.other_income,0)) > 0
          OR (COALESCE(pf_row.contractor_pay,0) + COALESCE(pf_row.laundry,0)
              + COALESCE(pf_row.supplies,0) + COALESCE(pf_row.inspections,0)
              + COALESCE(pf_row.trash,0)) > 0)
  THEN
    actual_src := 'proforma';
    actual_rev := COALESCE(pf_row.cleaning_fee,0) + COALESCE(pf_row.services,0)
                + COALESCE(pf_row.onboarding_revenue,0) + COALESCE(pf_row.other_income,0);
    actual_cog := COALESCE(pf_row.contractor_pay,0) + COALESCE(pf_row.laundry,0)
                + COALESCE(pf_row.leadership,0)     + COALESCE(pf_row.supplies,0)
                + COALESCE(pf_row.inspections,0)    + COALESCE(pf_row.trash,0)
                + COALESCE(pf_row.other_cogs,0);
    actual_op  := COALESCE(pf_row.opex, 0);
    actual_pft := actual_rev - actual_cog - actual_op;
  ELSE
    -- Fall back to QBO monthly blob
    SELECT value INTO qbo_text FROM app_settings WHERE key = 'qbo_pl_data';
    IF qbo_text IS NOT NULL THEN
      BEGIN
        qbo_jsonb := qbo_text::jsonb;
      EXCEPTION WHEN others THEN
        qbo_jsonb := NULL;
      END;
      IF qbo_jsonb IS NOT NULL THEN
        qbo_monthly := qbo_jsonb->'monthly';
        IF qbo_monthly IS NOT NULL THEN
          qbo_month_entry := COALESCE(
            qbo_monthly->month_yyyymm,
            qbo_monthly->month_short,
            qbo_monthly->month_long
          );
          IF qbo_month_entry IS NOT NULL THEN
            qbo_revenue := COALESCE(
              (qbo_month_entry->>'totalIncome')::numeric,
              (qbo_month_entry->>'income')::numeric,
              0
            );
            qbo_cogs    := COALESCE(
              (qbo_month_entry->>'totalCOGS')::numeric,
              (qbo_month_entry->>'cogs')::numeric,
              0
            );
            qbo_opex    := COALESCE(
              (qbo_month_entry->>'totalExpenses')::numeric,
              (qbo_month_entry->>'expenses')::numeric,
              0
            );
            qbo_net     := COALESCE(
              (qbo_month_entry->>'netIncome')::numeric,
              qbo_revenue - qbo_cogs - qbo_opex
            );
            -- Topline magnitude check — match the forecaster's $1 epsilon
            IF (ABS(qbo_revenue) + ABS(qbo_cogs) + ABS(qbo_opex)) >= 1 THEN
              actual_src := 'qbo';
              actual_rev := qbo_revenue;
              actual_cog := qbo_cogs;
              actual_op  := qbo_opex;
              actual_pft := qbo_net;
            END IF;
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  INSERT INTO monthly_financial_snapshot (
    month,
    estimate_revenue, estimate_cogs, estimate_opex, estimate_profit,
    estimate_cleans_count, estimate_deep_cleans_count, estimate_active_properties,
    estimate_per_property,
    actual_source, actual_revenue, actual_cogs, actual_opex, actual_profit,
    variance_revenue, variance_cogs, variance_opex, variance_profit,
    last_reconciled_at
  )
  VALUES (
    target_month,
    est.est_revenue, est.est_cogs, est.est_opex, est.est_profit,
    est.cleans_count, est.deep_cleans_count, est.active_properties,
    est.per_property,
    actual_src, actual_rev, actual_cog, actual_op, actual_pft,
    CASE WHEN actual_rev IS NOT NULL THEN actual_rev - est.est_revenue END,
    CASE WHEN actual_cog IS NOT NULL THEN actual_cog - est.est_cogs    END,
    CASE WHEN actual_op  IS NOT NULL THEN actual_op  - est.est_opex    END,
    CASE WHEN actual_pft IS NOT NULL THEN actual_pft - est.est_profit  END,
    now()
  )
  ON CONFLICT (month) DO UPDATE SET
    estimate_revenue            = EXCLUDED.estimate_revenue,
    estimate_cogs               = EXCLUDED.estimate_cogs,
    estimate_opex               = EXCLUDED.estimate_opex,
    estimate_profit             = EXCLUDED.estimate_profit,
    estimate_cleans_count       = EXCLUDED.estimate_cleans_count,
    estimate_deep_cleans_count  = EXCLUDED.estimate_deep_cleans_count,
    estimate_active_properties  = EXCLUDED.estimate_active_properties,
    estimate_per_property       = EXCLUDED.estimate_per_property,
    actual_source               = EXCLUDED.actual_source,
    actual_revenue              = EXCLUDED.actual_revenue,
    actual_cogs                 = EXCLUDED.actual_cogs,
    actual_opex                 = EXCLUDED.actual_opex,
    actual_profit               = EXCLUDED.actual_profit,
    variance_revenue            = EXCLUDED.variance_revenue,
    variance_cogs               = EXCLUDED.variance_cogs,
    variance_opex               = EXCLUDED.variance_opex,
    variance_profit             = EXCLUDED.variance_profit,
    last_reconciled_at          = now()
  RETURNING * INTO result;

  RETURN result;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- reconcile_recent_snapshots(months_back integer)
-- Reconciles the trailing N months + current month + next month (so
-- estimates for upcoming months stay fresh as cleans get scheduled).
-- Default: 13 months back (covers a year of variance trend).
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION reconcile_recent_snapshots(months_back integer DEFAULT 13)
RETURNS TABLE(month date, has_estimate boolean, has_actual boolean, actual_source text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  m            date;
  start_month  date;
  end_month    date;
BEGIN
  start_month := date_trunc('month', now() - (months_back || ' months')::interval)::date;
  end_month   := date_trunc('month', now() + INTERVAL '1 month')::date;
  m := start_month;
  WHILE m <= end_month LOOP
    PERFORM reconcile_monthly_snapshot(m);
    m := (m + INTERVAL '1 month')::date;
  END LOOP;

  RETURN QUERY
    SELECT s.month,
           (s.estimate_revenue + s.estimate_cogs) > 0,
           s.actual_revenue IS NOT NULL,
           s.actual_source
      FROM monthly_financial_snapshot s
     WHERE s.month BETWEEN start_month AND end_month
     ORDER BY s.month;
END;
$$;
