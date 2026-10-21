-- 20261021c — One clean count for every financial page.
--
-- Before the clean_source_cutover, financial_monthly_cleans counted raw
-- Breezeway rows (count(*): no per-property-per-day dedupe, any status,
-- deep cleans skipped) over a rolling current_date - 1 year window, so the
-- Overview and Forecast showed 1,410 September cleans while the P&L
-- (property_monthly_cleans) showed 1,176, and the oldest month was cut in
-- half. compute_monthly_estimate's pre-cutover branch had the same raw-row
-- count. Both now read financial_clean_days (20261021a), the same distinct
-- property-day rules as property_monthly_cleans, month-aligned over the last
-- ~15 months. Columns, types and grants are unchanged.

create or replace view public.financial_monthly_cleans as
select month, cleans
from (
  select to_char(d, 'YYYY-MM') as month, count(*)::bigint as cleans
  from public.financial_clean_days
  group by to_char(d, 'YYYY-MM')
  order by 1
) _gated
where (select public.can_view_financials());

CREATE OR REPLACE FUNCTION public.compute_monthly_estimate(target_month date)
 RETURNS TABLE(est_revenue numeric, est_cogs numeric, est_opex numeric, est_profit numeric, cleans_count integer, deep_cleans_count integer, active_properties integer, per_property jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH cut AS (
    SELECT public.clean_source_cutover() AS c
  ),
  bz_rows AS (
    SELECT bt.property_id, bt.is_clean, bt.is_deep_clean
    FROM breezeway_tasks bt
    WHERE bt.due_date >= target_month
      AND bt.due_date <  (target_month + INTERVAL '1 month')::date
      AND bt.property_id IS NOT NULL
  ),
  since AS (
    SELECT m.property_id, min(t.scheduled_date) AS trellis_since
    FROM trellis_task_snapshot t
    JOIN trellis_ops_property_map m ON m.trellis_id = t.trellis_property_id
    GROUP BY m.property_id
  ),
  bz_mode AS (
    SELECT DISTINCT b.property_id
    FROM bz_rows b
    LEFT JOIN since s ON s.property_id = b.property_id
    WHERE (b.is_clean OR b.is_deep_clean)
      AND (s.trellis_since IS NULL OR s.trellis_since > date_trunc('month', target_month)::date)
  ),
  tr_days AS (
    SELECT m.property_id, t.scheduled_date AS d, bool_or(t.clean_kind = 'deep') AS deep
    FROM trellis_task_snapshot t
    JOIN trellis_ops_property_map m ON m.trellis_id = t.trellis_property_id
    WHERE t.clean_kind IS NOT NULL
      AND coalesce(t.is_tendwell, false)
      AND (t.status = 'COMPLETED' OR t.scheduled_date >= current_date)
      AND t.scheduled_date >= target_month
      AND t.scheduled_date <  (target_month + INTERVAL '1 month')::date
    GROUP BY m.property_id, t.scheduled_date
  ),
  tasks AS (
    SELECT
      fcd.property_id,
      COUNT(*) FILTER (WHERE NOT fcd.deep) AS cleans,
      COUNT(*) FILTER (WHERE fcd.deep)     AS deep_cleans
    FROM financial_clean_days fcd, cut
    WHERE target_month < cut.c
      AND fcd.d >= target_month
      AND fcd.d <  (target_month + INTERVAL '1 month')::date
    GROUP BY fcd.property_id
    UNION ALL
    SELECT
      d.property_id,
      COUNT(*) FILTER (WHERE NOT d.deep) AS cleans,
      COUNT(*) FILTER (WHERE d.deep)     AS deep_cleans
    FROM tr_days d, cut
    WHERE target_month >= cut.c
      AND d.property_id NOT IN (SELECT property_id FROM bz_mode)
    GROUP BY d.property_id
    UNION ALL
    SELECT
      bt.property_id,
      COUNT(*) FILTER (WHERE bt.is_clean)      AS cleans,
      COUNT(*) FILTER (WHERE bt.is_deep_clean) AS deep_cleans
    FROM bz_rows bt, cut
    WHERE target_month >= cut.c
      AND bt.property_id IN (SELECT property_id FROM bz_mode)
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
$function$;
